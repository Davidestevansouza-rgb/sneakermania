import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ALERT_EMAIL = "davidestevansouza@gmail.com";
const MONITOR_SECRET = Deno.env.get("MONITOR_SECRET") || "sneakermania-monitor-2024";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-monitor-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function sendAlert(subject: string, htmlBody: string): Promise<boolean> {
  if (!RESEND_API_KEY) { console.error("RESEND_API_KEY no configurada"); return false; }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "SneakerMania Monitor <onboarding@resend.dev>",
      to: [ALERT_EMAIL],
      subject,
      html: htmlBody,
    }),
  });
  const ok = res.ok;
  if (!ok) console.error("Error Resend:", await res.text());
  return ok;
}

function alertHtml(titulo: string, detalles: string[], nivel: "critico" | "advertencia" | "info" = "advertencia") {
  const color = nivel === "critico" ? "#dc2626" : nivel === "advertencia" ? "#d97706" : "#2563eb";
  const emoji = nivel === "critico" ? "🚨" : nivel === "advertencia" ? "⚠️" : "ℹ️";
  return `
  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
    <div style="background:${color};color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">${emoji} SneakerMania — ${titulo}</h2>
      <p style="margin:4px 0 0;opacity:.85;font-size:14px">${new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" })} (Bolivia)</p>
    </div>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 8px 8px">
      <ul style="padding-left:18px;margin:0;line-height:1.8">
        ${detalles.map(d => `<li style="margin-bottom:6px">${d}</li>`).join("")}
      </ul>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
      <p style="font-size:12px;color:#6b7280;margin:0">Sistema SneakerMania • Monitoreo Automático • <a href="https://sneakermania.pages.dev" style="color:#2563eb">Ver aplicación</a></p>
    </div>
  </div>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Verificar secret de autenticación del monitor
  const secret = req.headers.get("x-monitor-secret") || "";
  // También permitir llamadas internas de Supabase (sin secret)
  const isInternalCall = req.headers.get("authorization")?.includes(SUPABASE_SERVICE_ROLE_KEY || "");
  if (!isInternalCall && secret !== MONITOR_SECRET) {
    return json({ error: "No autorizado" }, 401);
  }

  const admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const alerts: string[] = [];
  const body = await req.json().catch(() => ({}));

  // ── 1. Verificar tamaño de la base de datos ──────────────────────────────
  try {
    const { data: dbSizeData, error: dbErr } = await admin.rpc("get_db_size_mb");
    if (!dbErr && dbSizeData !== null) {
      const sizeMB = Number(dbSizeData);
      if (sizeMB > 450) {
        alerts.push(`🚨 CRÍTICO: Base de datos Supabase usa ${sizeMB.toFixed(0)} MB de 500 MB (${(sizeMB/5).toFixed(0)}%). ¡Límite gratuito casi alcanzado!`);
      } else if (sizeMB > 350) {
        alerts.push(`⚠️ ADVERTENCIA: Base de datos Supabase usa ${sizeMB.toFixed(0)} MB de 500 MB (${(sizeMB/5).toFixed(0)}%).`);
      }
    }
  } catch (e) { console.error("Error verificando DB size:", e); }

  // ── 2. Verificar intentos de login sospechosos ───────────────────────────
  try {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: authLogs, error: authErr } = await admin
      .from("auth_monitoring_log")
      .select("ip_address, count")
      .gte("created_at", since)
      .gt("count", 4);

    if (!authErr && authLogs && authLogs.length > 0) {
      for (const log of authLogs) {
        alerts.push(`🚨 ACCESO SOSPECHOSO: IP <strong>${log.ip_address}</strong> intentó ingresar <strong>${log.count} veces</strong> en 10 minutos.`);
      }
    }
  } catch (e) { console.error("Error verificando auth logs:", e); }

  // ── 3. Verificar R2 storage (parámetro recibido del Worker) ─────────────
  const r2UsedGB: number | null = typeof body.r2UsedGB === "number" ? body.r2UsedGB : null;
  const R2_LIMIT_GB = 10; // Límite gratuito de R2
  if (r2UsedGB !== null) {
    const r2Pct = (r2UsedGB / R2_LIMIT_GB) * 100;
    if (r2Pct >= 90) {
      alerts.push(`🚨 CRÍTICO: R2 Storage usa ${r2UsedGB.toFixed(2)} GB de ${R2_LIMIT_GB} GB (${r2Pct.toFixed(0)}%). ¡Se va a llenar!`);
    } else if (r2Pct >= 75) {
      alerts.push(`⚠️ ADVERTENCIA: R2 Storage usa ${r2UsedGB.toFixed(2)} GB de ${R2_LIMIT_GB} GB (${r2Pct.toFixed(0)}%).`);
    }
  }

  // ── 4. Verificar errores recientes del sistema ───────────────────────────
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: errores, error: errErr } = await admin
      .from("system_error_log")
      .select("message, created_at, severity")
      .gte("created_at", since24h)
      .eq("severity", "critical")
      .order("created_at", { ascending: false })
      .limit(5);

    if (!errErr && errores && errores.length > 0) {
      alerts.push(`⚠️ ${errores.length} errores críticos del sistema en las últimas 24 horas.`);
      for (const err of errores.slice(0, 3)) {
        alerts.push(`&nbsp;&nbsp;→ ${err.message} (${new Date(err.created_at).toLocaleString("es-BO", { timeZone: "America/La_Paz" })})`);
      }
    }
  } catch (e) { console.error("Error verificando system logs:", e); }

  // ── 5. Enviar email si hay alertas ───────────────────────────────────────
  let emailSent = false;
  if (alerts.length > 0) {
    const nivel = alerts.some(a => a.includes("CRÍTICO")) ? "critico" : "advertencia";
    emailSent = await sendAlert(
      `Alerta del Sistema — ${new Date().toLocaleDateString("es-BO", { timeZone: "America/La_Paz" })}`,
      alertHtml("Alertas del Sistema", alerts, nivel)
    );
  }

  return json({
    ok: true,
    alertsFound: alerts.length,
    emailSent,
    checks: { dbSize: true, authAnomalies: true, r2Storage: r2UsedGB !== null, systemErrors: true }
  });
});
