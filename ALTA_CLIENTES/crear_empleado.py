# -*- coding: utf-8 -*-
"""
=============================================================
  ALTA DE EMPLEADOS / SUPERVISORES - Sistema SeS
  (uso privado del dueño)
=============================================================
Crea la cuenta de acceso de un empleado o supervisor para un
cliente (negocio) ya existente. Elige el negocio de una lista,
pones los datos y listo: el empleado ya puede entrar.

Ejecutalo con doble clic en "Crear Empleado.bat"
=============================================================
"""
import json
import urllib.request
import urllib.error

# ===== CONFIGURACION PRIVADA (no compartir este archivo) =====
SUPABASE_URL = "https://ypgyfgbftfvouobmsync.supabase.co"
SERVICE_KEY  = "sb_secret_N3fzzlAMkUACwsDW--VZag_wCWM3_tr"
SITIO_WEB    = "https://charming-gaufre-2a49f0.netlify.app"
# =============================================================


def api(path, method="GET", body=None):
    url = SUPABASE_URL + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", SERVICE_KEY)
    req.add_header("Authorization", "Bearer " + SERVICE_KEY)
    req.add_header("Content-Type", "application/json")
    req.add_header("Prefer", "return=representation")
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode("utf-8")
            return json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8")
        try:
            j = json.loads(detail)
            msg = j.get("message") or j.get("msg") or j.get("error_description") or j.get("error") or detail
        except Exception:
            msg = detail
        raise RuntimeError(msg)


def preguntar(texto, obligatorio=True):
    while True:
        v = input(texto).strip()
        if v or not obligatorio:
            return v
        print("  -> Este dato es obligatorio.\n")


def main():
    print("=" * 55)
    print("   ALTA DE EMPLEADO / SUPERVISOR  -  Sistema SeS")
    print("=" * 55)
    print()

    # 1) Elegir el negocio (tenant)
    print("Cargando negocios...\n")
    tenants = api("/rest/v1/tenants?select=id,nombre,email&order=nombre")
    if not tenants:
        print("No hay negocios registrados. Crea primero un cliente.")
        input("\nPresiona ENTER para cerrar...")
        return

    print("Negocios (clientes):")
    for i, t in enumerate(tenants, 1):
        print("  {}) {}  ({})".format(i, t["nombre"], t.get("email") or "sin correo"))
    while True:
        sel = preguntar("\nElige el negocio [numero]: ")
        try:
            idx = int(sel) - 1
            if 0 <= idx < len(tenants):
                break
        except ValueError:
            pass
        print("  -> Numero invalido.\n")
    tenant = tenants[idx]
    tenant_id = tenant["id"]

    # 2) Datos del empleado
    print("\nNegocio elegido: " + tenant["nombre"])
    nombre = preguntar("Nombre del empleado: ")
    email  = preguntar("Correo del empleado: ").lower()
    while True:
        passwd = preguntar("Contrasena inicial (min 6 caracteres): ")
        if len(passwd) >= 6:
            break
        print("  -> La contrasena debe tener al menos 6 caracteres.\n")

    print("\nRol:")
    print("  1) Empleado    (sin finanzas)")
    print("  2) Supervisor  (sin finanzas)")
    r = preguntar("Elige [1-2]: ", obligatorio=False) or "1"
    rol = "Supervisor" if r == "2" else "Empleado"

    print("\nCreando " + rol + ", espera...\n")

    auth_id = None
    try:
        # 3) Crear cuenta de acceso (auth)
        a = api("/auth/v1/admin/users", "POST", {
            "email": email, "password": passwd, "email_confirm": True,
        })
        auth_id = a["id"]

        # 4) Fila en users con el rol
        api("/rest/v1/users", "POST", {
            "id": auth_id, "tenant_id": tenant_id, "nombre": nombre,
            "email": email, "rol": rol, "activo": True,
        })

        print("=" * 55)
        print("   " + rol.upper() + " CREADO CON EXITO")
        print("=" * 55)
        print("\nEntrega estos datos al empleado:\n")
        print("   Sitio web : " + SITIO_WEB)
        print("   Usuario   : " + email)
        print("   Contrasena: " + passwd)
        print("\nNegocio: " + tenant["nombre"])
        print("Rol    : " + rol + "  (no ve finanzas)")
        print("=" * 55)

    except Exception as e:
        try:
            if auth_id:
                api("/auth/v1/admin/users/" + auth_id, "DELETE")
        except Exception:
            pass
        msg = str(e)
        if "already been registered" in msg or "already exists" in msg or "duplicate" in msg:
            msg = "Ese correo ya esta registrado. Usa otro correo."
        print("ERROR: no se pudo crear el empleado.")
        print("Motivo: " + msg)

    print("\n")
    input("Presiona ENTER para cerrar...")


if __name__ == "__main__":
    main()
