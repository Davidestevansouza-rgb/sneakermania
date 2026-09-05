import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ALERT_EMAIL = "davidestevansouza@gmail.com";
const MONITOR_SECRET = Deno.env.get("MONITOR_SECRET");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-monitor-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function getResendApiKey(admin: ReturnType<typeof createClient>): Promise<string | null> {
  const envKey = Deno.env.get("RESEND_API_KEY");
  if (envKey) return envKey;
  try {
    const { data, error } = await admin
      .from("app_config")
      .select("value")
      .eq("key", "RESEND_API_KEY")
      .single();
    if (error) { console.error("Error leyendo RESEND_API_KEY desde DB:", error.message); return null; }
    return data?.value || null;
  } catch (e) {
    console.error("Excepcion leyendo RESEND_API_KEY:", e);
    return null;
  }
}

async function sendAlert(apiKey: string, subject: string, htmlBody: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "SneakerMania Monitor <onboarding@resend.dev>",
      to: [ALERT_EMAIL],
      subject,
      html: htmlBody,
    }),
  });
  if (!res.ok) console.error("Error Resend HTTP", res.status);
  return res.ok;
}

function alertHtml(titulo: string, detalles: string[], nivel: "critico" | "advertencia" | "info" = "advertencia") {
  const color = nivel === "critico" ? "#dc2626" : nivel === "advertencia" ? "#d97706" : "#2563eb";
  const emoji = nivel === "critico" ? "🚨" : nivel === "advertencia" ? "⚠️" : "ℹ️";
  const now = new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" });
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><div style="background:${color};color:#fff;padding:16px 20px;border-radius:8px 8px 0 0"><h2 style="margin:0">${emoji} SneakerMania - ${esc(titulo)}</h2><p style="margin:4px 0 0;opacity:.85;font-size:14px">${esc(now)} (Bolivia)</p></div><div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 8px 8px"><ul style="padding-left:18px;margin:0;line-height:1.8">${detalles.map(d => `<li style="margin-bottom:6px">${esc(d)}</li>`).join("")}</ul><hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"><p style="font-size:12px;color:#6b7280;margin:0">Sistema SneakerMania - Monitoreo Automático</p></div></div>`;
}

function weeklyReportHtml(stats: Record<string, unknown>) {
  const now = new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" });
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><div style="background:#1e40af;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0"><h2 style="margin:0">📊 SneakerMania - Reporte Semanal</h2><p style="margin:4px 0 0;opacity:.85;font-size:14px">${esc(now)} (Bolivia)</p></div><div style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;padding:20px;border-radius:0 0 8px 8px"><table style="width:100%;border-collapse:collapse"><tr style="background:#e5e7eb"><th style="padding:8px;text-align:left">Métrica</th><th style="padding:8px;text-align:right">Valor</th></tr><tr><td style="padding:8px;border-top:1px solid #e5e7eb">Base de datos</td><td style="padding:8px;border-top:1px solid #e5e7eb;text-align:right">${esc(stats.dbSizeMB)} MB / 500 MB</td></tr><tr><td style="padding:8px;border-top:1px solid #e5e7eb">R2 Storage</td><td style="padding:8px;border-top:1px solid #e5e7eb;text-align:right">${esc(stats.r2Note)}</td></tr><tr><td style="padding:8px;border-top:1px solid #e5e7eb">Intentos fallidos (7 días)</td><td style="padding:8px;border-top:1px solid #e5e7eb;text-align:right">${esc(stats.failedLogins)}</td></tr><tr><td style="padding:8px;border-top:1px solid #e5e7eb">Errores críticos (7 días)</td><td style="padding:8px;border-top:1px solid #e5e7eb;text-align:right">${esc(stats.criticalErrors)}</td></tr></table><hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"><p style="font-size:12px;color:#6b7280;margin:0">Reporte automático semanal de SneakerMania</p></div></div>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Monitor no configurado" }, 503);

  const authHeader = req.headers.get("authorization") || "";
  const isServiceRole = authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  const suppliedSecret = req.headers.get("x-monitor-secret") || "";
  const validMonitorSecret = !!MONITOR_SECRET && suppliedSecret.length > 0 && suppliedSecret === MONITOR_SECRET;
  if (!isServiceRole && !validMonitorSecret) {
    return json({ error: MONITOR_SECRET ? "No autorizado" : "Monitor externo no configurado" }, MONITOR_SECRET ? 401 : 503);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const body = await req.json().catch(() => ({}));
  const isWeekly = body.tipo === "semanal";
  const rawR2 = Number(body.r2UsedGB);
  const r2UsedGB: number | null = Number.isFinite(rawR2) && rawR2 >= 0 && rawR2 <= 100000 ? rawR2 : null;

  const resendApiKey = await getResendApiKey(admin);
  if (!resendApiKey) return json({ error: "RESEND_API_KEY no configurada" }, 503);

  const alerts: string[] = [];
  let dbSizeMB = 0;
  let failedLogins = 0;
  let criticalErrors = 0;

  try {
    const { data: dbSizeData, error: dbErr } = await admin.rpc("get_db_size_mb");
    if (!dbErr && dbSizeData !== null) {
      dbSizeMB = Number(dbSizeData);
      if (dbSizeMB > 450) alerts.push(`🚨 CRÍTICO: Base de datos usa ${dbSizeMB.toFixed(0)} MB de 500 MB`);
      else if (dbSizeMB > 350) alerts.push(`⚠️ ADVERTENCIA: Base de datos usa ${dbSizeMB.toFixed(0)} MB de 500 MB`);
    }
  } catch (e) { console.error("Error DB size:", e); }

  try {
    const since = new Date(Date.now() - (isWeekly ? 7 * 24 * 60 * 60 * 1000 : 10 * 60 * 1000)).toISOString();
    const { data: authLogs, error: authErr } = await admin.from("auth_monitoring_log").select("ip_address, count").gte("created_at", since);
    if (!authErr && authLogs) {
      failedLogins = authLogs.reduce((sum: number, r: { count: number }) => sum + (Number(r.count) || 1), 0);
      for (const log of authLogs.filter((r: { count: number }) => Number(r.count) > 4)) {
        alerts.push(`🚨 ACCESO SOSPECHOSO: IP ${String(log.ip_address).slice(0, 80)} intentó ingresar ${Number(log.count)} veces.`);
      }
    }
  } catch (e) { console.error("Error auth logs:", e); }

  const R2_LIMIT_GB = 10;
  if (r2UsedGB !== null) {
    const pct = (r2UsedGB / R2_LIMIT_GB) * 100;
    if (pct >= 90) alerts.push(`🚨 CRÍTICO: R2 Storage usa ${r2UsedGB.toFixed(2)} GB de ${R2_LIMIT_GB} GB (${pct.toFixed(0)}%)`);
    else if (pct >= 75) alerts.push(`⚠️ ADVERTENCIA: R2 Storage usa ${r2UsedGB.toFixed(2)} GB de ${R2_LIMIT_GB} GB (${pct.toFixed(0)}%)`);
  }

  try {
    const since24h = new Date(Date.now() - (isWeekly ? 7 : 1) * 24 * 60 * 60 * 1000).toISOString();
    const { data: errores, error: errErr } = await admin.from("system_error_log").select("message, created_at, severity").gte("created_at", since24h).eq("severity", "critical").order("created_at", { ascending: false }).limit(5);
    if (!errErr && errores) {
      criticalErrors = errores.length;
      if (errores.length > 0) {
        alerts.push(`⚠️ ${errores.length} errores críticos en ${isWeekly ? "7 días" : "24 horas"}.`);
        for (const err of errores.slice(0, 3)) alerts.push(`→ ${String(err.message || "Error sin detalle").slice(0, 500)}`);
      }
    }
  } catch (e) { console.error("Error system logs:", e); }

  let emailSent = false;
  if (isWeekly) {
    emailSent = await sendAlert(resendApiKey, "📊 Reporte Semanal SneakerMania", weeklyReportHtml({ dbSizeMB: dbSizeMB.toFixed(1), r2Note: r2UsedGB !== null ? `${r2UsedGB.toFixed(2)} GB de ${R2_LIMIT_GB} GB` : "N/A", failedLogins, criticalErrors }));
  } else if (alerts.length > 0) {
    const nivel = alerts.some(a => a.includes("CRÍTICO")) ? "critico" : "advertencia";
    emailSent = await sendAlert(resendApiKey, `${nivel === "critico" ? "🚨 ALERTA CRÍTICA" : "⚠️ Alerta"} SneakerMania`, alertHtml("Alertas del Sistema", alerts, nivel));
  }

  return json({ ok: true, tipo: isWeekly ? "semanal" : "diario", alertsFound: alerts.length, emailSent, r2MeasurementProvided: r2UsedGB !== null });
});
