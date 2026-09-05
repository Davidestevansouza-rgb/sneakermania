import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const R2_ENDPOINT = Deno.env.get("R2_ENDPOINT");
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = Deno.env.get("R2_BUCKET") || "sneakermania-fotos";
const ALERT_EMAIL = "davidestevansouza@gmail.com";
const R2_LIMIT_GB = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-monitor-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
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

async function getConfig(admin: ReturnType<typeof createClient>) {
  const keys = ["MONITOR_CRON_SECRET", "RESEND_API_KEY"];
  const { data, error } = await admin.from("app_config").select("key,value").in("key", keys);
  if (error) throw error;
  const cfg: Record<string,string> = {};
  for (const r of data || []) if (r?.key && r?.value) cfg[r.key] = r.value;
  return cfg;
}

async function calculateR2UsageGB(): Promise<number | null> {
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  const aws = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  let totalBytes = 0;
  let token = "";
  let pages = 0;
  do {
    const base = `${R2_ENDPOINT.replace(/\/+$/, "")}/${R2_BUCKET}?list-type=2&max-keys=1000`;
    const url = token ? `${base}&continuation-token=${encodeURIComponent(token)}` : base;
    const resp = await aws.fetch(url, { method: "GET" });
    if (!resp.ok) throw new Error(`R2 list HTTP ${resp.status}`);
    const xml = await resp.text();
    for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) totalBytes += Number(m[1]) || 0;
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    token = next ? next[1].replaceAll("&amp;", "&") : "";
    pages++;
    if (pages > 10000) throw new Error("R2 listing excedió límite de seguridad");
  } while (token);
  return totalBytes / (1024 * 1024 * 1024);
}

async function sendAlert(apiKey: string, subject: string, htmlBody: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "SneakerMania Monitor <onboarding@resend.dev>", to: [ALERT_EMAIL], subject, html: htmlBody }),
  });
  if (!res.ok) console.error("Resend HTTP", res.status);
  return res.ok;
}

function alertHtml(detalles: string[], nivel: "critico" | "advertencia") {
  const color = nivel === "critico" ? "#dc2626" : "#d97706";
  const now = new Date().toLocaleString("es-BO", { timeZone: "America/La_Paz" });
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><div style="background:${color};color:#fff;padding:16px 20px"><h2 style="margin:0">${nivel === "critico" ? "🚨" : "⚠️"} SneakerMania</h2><p>${esc(now)} (Bolivia)</p></div><div style="padding:20px;border:1px solid #e5e7eb"><ul>${detalles.map(d => `<li>${esc(d)}</li>`).join("")}</ul></div></div>`;
}

function weeklyHtml(stats: { dbSizeMB:number; r2UsedGB:number|null; failedLogins:number; criticalErrors:number }) {
  const r2 = stats.r2UsedGB == null ? "N/A" : `${stats.r2UsedGB.toFixed(3)} GB / ${R2_LIMIT_GB} GB`;
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2>📊 Reporte Semanal — SneakerMania</h2><table style="width:100%;border-collapse:collapse"><tr><td>Base de datos</td><td>${esc(stats.dbSizeMB.toFixed(1))} MB / 500 MB</td></tr><tr><td>R2 Storage</td><td>${esc(r2)}</td></tr><tr><td>Intentos fallidos (7 días)</td><td>${stats.failedLogins}</td></tr><tr><td>Errores críticos (7 días)</td><td>${stats.criticalErrors}</td></tr></table></div>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "Monitor no configurado" }, 503);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const cfg = await getConfig(admin);
    const expectedSecret = cfg.MONITOR_CRON_SECRET;
    const authHeader = req.headers.get("authorization") || "";
    const isServiceRole = authHeader === `Bearer ${SERVICE_ROLE_KEY}`;
    const got = req.headers.get("x-monitor-secret") || "";
    if (!isServiceRole && (!expectedSecret || got !== expectedSecret)) return json({ error: expectedSecret ? "No autorizado" : "Monitor no configurado" }, expectedSecret ? 401 : 503);

    const body = await req.json().catch(() => ({}));
    const isWeekly = body.tipo === "semanal";
    const alerts: string[] = [];
    let dbSizeMB = 0;
    let failedLogins = 0;
    let criticalErrors = 0;

    const { data: dbSizeData, error: dbErr } = await admin.rpc("get_db_size_mb");
    if (!dbErr && dbSizeData !== null) {
      dbSizeMB = Number(dbSizeData) || 0;
      if (dbSizeMB > 450) alerts.push(`CRÍTICO: Base de datos usa ${dbSizeMB.toFixed(0)} MB de 500 MB`);
      else if (dbSizeMB > 350) alerts.push(`ADVERTENCIA: Base de datos usa ${dbSizeMB.toFixed(0)} MB de 500 MB`);
    }

    let r2UsedGB: number | null = null;
    try {
      r2UsedGB = await calculateR2UsageGB();
      if (r2UsedGB !== null) {
        const pct = (r2UsedGB / R2_LIMIT_GB) * 100;
        if (pct >= 90) alerts.push(`CRÍTICO: R2 usa ${r2UsedGB.toFixed(2)} GB de ${R2_LIMIT_GB} GB (${pct.toFixed(0)}%)`);
        else if (pct >= 75) alerts.push(`ADVERTENCIA: R2 usa ${r2UsedGB.toFixed(2)} GB de ${R2_LIMIT_GB} GB (${pct.toFixed(0)}%)`);
      }
    } catch (e) {
      console.error("R2 monitor:", e);
      alerts.push("ADVERTENCIA: no se pudo medir R2 Storage");
    }

    const since = new Date(Date.now() - (isWeekly ? 7 * 24 * 60 * 60 * 1000 : 10 * 60 * 1000)).toISOString();
    const { data: authLogs } = await admin.from("auth_monitoring_log").select("ip_address,count").gte("created_at", since);
    if (authLogs) {
      failedLogins = authLogs.reduce((sum:number, r:any) => sum + (Number(r.count) || 1), 0);
      for (const r of authLogs.filter((x:any) => Number(x.count) > 4)) alerts.push(`ACCESO SOSPECHOSO: ${Number(r.count)} intentos desde una misma IP`);
    }

    const sinceErrors = new Date(Date.now() - (isWeekly ? 7 : 1) * 24 * 60 * 60 * 1000).toISOString();
    const { data: errors } = await admin.from("system_error_log").select("message").gte("created_at", sinceErrors).eq("severity", "critical").order("created_at", { ascending:false }).limit(5);
    criticalErrors = errors?.length || 0;
    if (criticalErrors) {
      alerts.push(`${criticalErrors} errores críticos detectados`);
      for (const e of (errors || []).slice(0,3)) alerts.push(`→ ${String(e.message || "Error sin detalle").slice(0,300)}`);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY") || cfg.RESEND_API_KEY || null;
    let emailSent = false;
    if (resendKey) {
      if (isWeekly) emailSent = await sendAlert(resendKey, "📊 Reporte Semanal SneakerMania", weeklyHtml({ dbSizeMB, r2UsedGB, failedLogins, criticalErrors }));
      else if (alerts.length) emailSent = await sendAlert(resendKey, alerts.some(a => a.startsWith("CRÍTICO")) ? "🚨 Alerta crítica SneakerMania" : "⚠️ Alerta SneakerMania", alertHtml(alerts, alerts.some(a => a.startsWith("CRÍTICO")) ? "critico" : "advertencia"));
    }

    return json({ ok:true, tipo:isWeekly?"semanal":"diario", alertsFound:alerts.length, emailSent, dbSizeMB:Number(dbSizeMB.toFixed(2)), r2UsedGB:r2UsedGB == null ? null : Number(r2UsedGB.toFixed(4)) });
  } catch (e) {
    console.error("monitor-alertas:", e);
    return json({ error:"Error interno del monitor" }, 500);
  }
});
