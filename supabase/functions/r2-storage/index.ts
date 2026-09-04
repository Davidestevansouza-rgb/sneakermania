import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AwsClient } from "npm:aws4fetch@1.0.20";
import { createClient } from "npm:@supabase/supabase-js@2";

const R2_ENDPOINT = Deno.env.get("R2_ENDPOINT");
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = Deno.env.get("R2_BUCKET") || "sneakermania-fotos";
const R2_PUBLIC_URL = Deno.env.get("R2_PUBLIC_URL");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIGNED_URL_SECONDS = 600;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }); }
function limpiarPath(path: string): string { return path.replace(/^\/+/, "").replace(/\.\.+\/?/g, ""); }
function primerSegmento(path: string): string { return limpiarPath(path).split("/")[0] || ""; }
async function tenantAutorizado(req: Request): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Intento 1: JWT de usuario de Supabase Auth (flujo estándar)
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (!userErr && userData?.user) {
    const { data: userRow, error: rowErr } = await admin.from("users").select("tenant_id").eq("id", userData.user.id).single();
    if (!rowErr && userRow?.tenant_id) return userRow.tenant_id as string;
  }

  // Intento 2: la app usa auth propia con PIN (no Supabase Auth),
  // por lo que el token es la anon key (no un JWT de usuario).
  // En ese caso se acepta si el header x-tenant-id contiene un UUID
  // válido que corresponde a un tenant existente en la BD.
  const tenantHeader = (req.headers.get("x-tenant-id") || "").trim();
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (tenantHeader && UUID_RE.test(tenantHeader)) {
    const { data, error } = await admin.from("tenants").select("id").eq("id", tenantHeader).single();
    if (!error && data?.id) return data.id as string;
  }

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PUBLIC_URL) return jsonResponse({ error: "El servidor no tiene configurado el almacenamiento (R2)." }, 500);
  const tenant = await tenantAutorizado(req);
  if (!tenant) return jsonResponse({ error: "No autorizado" }, 401);
  const aws = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });

  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const path = form.get("path");
      if (!(file instanceof File) || typeof path !== "string" || !path) return jsonResponse({ error: "Faltan datos: file y path son requeridos" }, 400);
      if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) return jsonResponse({ error: "Archivo demasiado grande o vacío" }, 413);
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) return jsonResponse({ error: "Tipo de imagen no permitido" }, 415);
      const cleanPath = limpiarPath(path);
      if (primerSegmento(cleanPath) !== tenant) return jsonResponse({ error: "No autorizado para escribir en ese path" }, 403);
      if (cleanPath.length > 500 || /[\r\n]/.test(cleanPath)) return jsonResponse({ error: "Path inválido" }, 400);
      const body = await file.arrayBuffer();
      const putUrl = `${R2_ENDPOINT.replace(/\/+$/, "")}/${R2_BUCKET}/${cleanPath}`;
      const uploadResp = await aws.fetch(putUrl, { method: "PUT", body, headers: { "Content-Type": file.type } });
      if (!uploadResp.ok) return jsonResponse({ error: "No se pudo subir el archivo a R2" }, 502);
      return jsonResponse({ url: `${R2_PUBLIC_URL.replace(/\/+$/, "")}/${cleanPath}`, path: cleanPath });
    }

    const payload = await req.json().catch(() => ({}));
    const action = payload.action;

    if (action === "signed-url") {
      if (typeof payload.path !== "string" || !payload.path) return jsonResponse({ error: "Falta 'path'" }, 400);
      const cleanPath = limpiarPath(payload.path);
      if (primerSegmento(cleanPath) !== tenant) return jsonResponse({ error: "No autorizado para leer ese path" }, 403);
      if (cleanPath.length > 500 || /[\r\n]/.test(cleanPath)) return jsonResponse({ error: "Path inválido" }, 400);
      const requested = Number(payload.expires);
      const expires = Number.isFinite(requested) ? Math.max(60, Math.min(MAX_SIGNED_URL_SECONDS, Math.floor(requested))) : 600;
      const objectUrl = `${R2_ENDPOINT.replace(/\/+$/, "")}/${R2_BUCKET}/${cleanPath}`;
      const signed = await aws.sign(new Request(objectUrl, { method: "GET" }), { aws: { signQuery: true, expires } });
      return jsonResponse({ url: signed.url, path: cleanPath, expiresIn: expires });
    }

    if (action === "delete") {
      if (typeof payload.path !== "string" || !payload.path) return jsonResponse({ error: "Falta 'path'" }, 400);
      const cleanPath = limpiarPath(payload.path);
      if (primerSegmento(cleanPath) !== tenant) return jsonResponse({ error: "No autorizado para borrar ese path" }, 403);
      const resp = await aws.fetch(`${R2_ENDPOINT.replace(/\/+$/, "")}/${R2_BUCKET}/${cleanPath}`, { method: "DELETE" });
      if (!resp.ok && resp.status !== 404) return jsonResponse({ error: "No se pudo borrar el archivo" }, 502);
      return jsonResponse({ ok: true });
    }
    if (action === "list") {
      const prefix = typeof payload.prefix === "string" ? limpiarPath(payload.prefix) : "";
      if (!prefix || primerSegmento(prefix) !== tenant) return jsonResponse({ error: "No autorizado para listar ese prefijo" }, 403);
      const resp = await aws.fetch(`${R2_ENDPOINT.replace(/\/+$/, "")}/${R2_BUCKET}?list-type=2&prefix=${encodeURIComponent(prefix + "/")}`, { method: "GET" });
      if (!resp.ok) return jsonResponse({ error: "No se pudo listar los archivos" }, 502);
      const xml = await resp.text();
      const nombres = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
      return jsonResponse({ files: nombres.map(key => ({ name: key.split("/").pop(), path: key, url: `${R2_PUBLIC_URL.replace(/\/+$/, "")}/${key}` })) });
    }
    return jsonResponse({ error: "Acción no reconocida" }, 400);
  } catch (e) {
    console.error("Error en r2-storage:", e);
    return jsonResponse({ error: "Error interno del servidor" }, 500);
  }
});
