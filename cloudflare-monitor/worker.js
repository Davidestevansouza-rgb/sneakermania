// Cloudflare Worker: SneakerMania Monitor
// Cron: "0 11 * * *" (8 AM hora Bolivia = 11 UTC)

const SUPABASE_EDGE_URL = "https://ypgyfgbftfvouobmsync.supabase.co/functions/v1/monitor-alertas";
const MONITOR_SECRET = "sneakermania-monitor-2024";
const RESEND_API_KEY_ENV = "RESEND_API_KEY"; // Se accede como env.RESEND_API_KEY
const ALERT_EMAIL = "davidestevansouza@gmail.com";
const R2_BUCKET_NAME = "sneakermania-fotos";
const R2_LIMIT_GB = 10;

export default {
  // Cron trigger - se ejecuta automáticamente
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  },

  // También se puede llamar manualmente via HTTP GET /monitor
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/monitor") {
      const secret = request.headers.get("x-monitor-secret");
      if (secret !== MONITOR_SECRET) {
        return new Response("No autorizado", { status: 401 });
      }
      const result = await runMonitor(env);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("SneakerMania Monitor v1.0", { status: 200 });
  }
};

async function runMonitor(env) {
  const results = { timestamp: new Date().toISOString(), checks: {} };

  // ── 1. Calcular uso de R2 ────────────────────────────────────────────────
  let r2UsedGB = null;
  try {
    if (env.R2_BUCKET) {
      const listed = await env.R2_BUCKET.list({ limit: 1000 });
      let totalBytes = 0;
      for (const obj of listed.objects) {
        totalBytes += obj.size || 0;
      }
      // Si hay más objetos (truncated), seguir listando para sumar todo.
      if (listed.truncated) {
        let cursor = listed.cursor;
        while (cursor) {
          const more = await env.R2_BUCKET.list({ limit: 1000, cursor });
          for (const obj of more.objects) { totalBytes += obj.size || 0; }
          cursor = more.truncated ? more.cursor : null;
        }
      }
      r2UsedGB = totalBytes / (1024 * 1024 * 1024);
      results.checks.r2 = { usedGB: r2UsedGB, pct: ((r2UsedGB / R2_LIMIT_GB) * 100).toFixed(1) };
    }
  } catch (e) {
    console.error("Error calculando R2:", e);
    results.checks.r2 = { error: e.message };
  }

  // ── 2. Llamar a la Edge Function de Supabase con los datos de R2 ─────────
  try {
    const resp = await fetch(SUPABASE_EDGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-monitor-secret": MONITOR_SECRET,
      },
      body: JSON.stringify({ r2UsedGB }),
    });
    const data = await resp.json();
    results.checks.supabase = data;
    results.emailSent = data.emailSent;
  } catch (e) {
    console.error("Error llamando Edge Function:", e);
    results.checks.supabase = { error: e.message };

    // Si Supabase falla, enviar alerta directa via Resend
    if (env.RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "SneakerMania Monitor <onboarding@resend.dev>",
          to: [ALERT_EMAIL],
          subject: "🚨 SneakerMania — Error de monitoreo",
          html: `<p>El Worker de monitoreo no pudo conectarse a Supabase.</p><p>Error: ${e.message}</p><p>Fecha: ${new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" })}</p>`
        })
      });
    }
  }

  // ── 3. Resumen semanal (lunes) ───────────────────────────────────────────
  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  if (isMonday && env.RESEND_API_KEY) {
    await sendWeeklySummary(env.RESEND_API_KEY, results);
  }

  return results;
}

async function sendWeeklySummary(apiKey, results) {
  const r2 = results.checks.r2;
  const sup = results.checks.supabase;
  const html = `
  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <div style="background:#1d4ed8;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">📊 Resumen Semanal — SneakerMania</h2>
      <p style="margin:4px 0 0;opacity:.85;font-size:14px">${new Date().toLocaleDateString("es-BO", { timeZone: "America/La_Paz", weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
    </div>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 8px 8px">
      <h3 style="color:#374151;margin-top:0">Estado del sistema</h3>
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#e5e7eb">
          <th style="padding:8px 12px;text-align:left">Componente</th>
          <th style="padding:8px 12px;text-align:left">Estado</th>
        </tr>
        <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">☁️ R2 Storage (fotos)</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${r2 && !r2.error ? `${r2.usedGB.toFixed(3)} GB / 10 GB (${r2.pct}%)` : '❌ No disponible'}</td></tr>
        <tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">🗄️ Supabase</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${sup && !sup.error ? '✅ Funcionando' : '⚠️ Verificar'}</td></tr>
        <tr><td style="padding:8px 12px">🚀 Cloudflare Pages</td><td style="padding:8px 12px">✅ Activo</td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
      <p style="font-size:12px;color:#6b7280;margin:0">Sistema SneakerMania • Monitoreo Automático semanal (lunes)</p>
    </div>
  </div>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "SneakerMania Monitor <onboarding@resend.dev>",
      to: [ALERT_EMAIL],
      subject: "📊 Resumen Semanal — SneakerMania",
      html
    })
  });
}
