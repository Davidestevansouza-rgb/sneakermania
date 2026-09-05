// Cloudflare Worker: SneakerMania Monitor
// Cron: "0 11 * * *" (8 AM hora Bolivia = 11 UTC)

const SUPABASE_EDGE_URL = "https://ypgyfgbftfvouobmsync.supabase.co/functions/v1/monitor-alertas";
const PAGES_URL = "https://sneakermania.pages.dev/";
const ALERT_EMAIL = "davidestevansouza@gmail.com";
const R2_LIMIT_GB = 10;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/monitor") return new Response("SneakerMania Monitor", { status: 200 });

    if (!env.MONITOR_SECRET) return new Response("Monitor no configurado", { status: 503 });
    const supplied = request.headers.get("x-monitor-secret") || "";
    if (supplied !== env.MONITOR_SECRET) return new Response("No autorizado", { status: 401 });

    const result = await runMonitor(env);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
};

async function runMonitor(env) {
  if (!env.MONITOR_SECRET) throw new Error("MONITOR_SECRET no configurado en Cloudflare Worker");

  const results = { timestamp: new Date().toISOString(), checks: {} };

  // 1. Medición real de R2: recorre todas las páginas del bucket.
  let r2UsedGB = null;
  try {
    if (!env.R2_BUCKET) throw new Error("Binding R2_BUCKET no configurado");
    let totalBytes = 0;
    let cursor;
    do {
      const listed = await env.R2_BUCKET.list({ limit: 1000, ...(cursor ? { cursor } : {}) });
      for (const obj of listed.objects || []) totalBytes += Number(obj.size) || 0;
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);

    r2UsedGB = totalBytes / (1024 * 1024 * 1024);
    results.checks.r2 = {
      usedGB: r2UsedGB,
      pct: Number(((r2UsedGB / R2_LIMIT_GB) * 100).toFixed(1))
    };
  } catch (e) {
    console.error("Error calculando R2:", e);
    results.checks.r2 = { error: String(e?.message || e) };
  }

  // 2. Verificación real de Cloudflare Pages.
  try {
    const pageResp = await fetch(PAGES_URL, { method: "HEAD", redirect: "follow" });
    results.checks.pages = { ok: pageResp.ok, status: pageResp.status };
  } catch (e) {
    results.checks.pages = { ok: false, error: String(e?.message || e) };
  }

  // 3. Supabase monitor. El secreto solo vive en variables cifradas del Worker.
  try {
    const resp = await fetch(SUPABASE_EDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-monitor-secret": env.MONITOR_SECRET,
      },
      body: JSON.stringify({ r2UsedGB }),
    });
    const data = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
    results.checks.supabase = { ok: resp.ok, status: resp.status, ...data };
    results.emailSent = data.emailSent === true;
    if (!resp.ok) throw new Error(`Supabase monitor HTTP ${resp.status}`);
  } catch (e) {
    console.error("Error llamando Edge Function:", e);
    if (!results.checks.supabase) results.checks.supabase = { ok: false, error: String(e?.message || e) };

    // Alerta independiente si Supabase no responde.
    if (env.RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "SneakerMania Monitor <onboarding@resend.dev>",
          to: [ALERT_EMAIL],
          subject: "🚨 SneakerMania — Error de monitoreo",
          html: `<p>El Worker no pudo completar el chequeo de Supabase.</p><p>Fecha: ${new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" })}</p>`
        })
      }).catch(() => {});
    }
  }

  // 4. Resumen semanal (lunes UTC; Bolivia no cruza de día a las 8 AM).
  if (new Date().getUTCDay() === 1 && env.RESEND_API_KEY) {
    await sendWeeklySummary(env.RESEND_API_KEY, results).catch((e) => console.error("Resumen semanal:", e));
  }

  return results;
}

async function sendWeeklySummary(apiKey, results) {
  const r2 = results.checks.r2;
  const sup = results.checks.supabase;
  const pages = results.checks.pages;
  const html = `
  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <h2>📊 Resumen Semanal — SneakerMania</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px">☁️ R2 Storage</td><td style="padding:8px">${r2 && !r2.error ? `${Number(r2.usedGB).toFixed(3)} GB / ${R2_LIMIT_GB} GB (${r2.pct}%)` : "⚠️ No disponible"}</td></tr>
      <tr><td style="padding:8px">🗄️ Supabase</td><td style="padding:8px">${sup?.ok ? "✅ Funcionando" : "⚠️ Verificar"}</td></tr>
      <tr><td style="padding:8px">🚀 Cloudflare Pages</td><td style="padding:8px">${pages?.ok ? `✅ HTTP ${pages.status}` : "⚠️ Verificar"}</td></tr>
    </table>
  </div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "SneakerMania Monitor <onboarding@resend.dev>",
      to: [ALERT_EMAIL],
      subject: "📊 Resumen Semanal — SneakerMania",
      html
    })
  });
  if (!resp.ok) throw new Error(`Resend HTTP ${resp.status}`);
}
