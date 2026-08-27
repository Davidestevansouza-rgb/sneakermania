# -*- coding: utf-8 -*-
"""
ALTA DE CLIENTES — Sistema SeS (VERSION DIAGNOSTICO 2)
Sin pre-check roto. Muestra el error REAL.
"""
import json
import urllib.request
import urllib.error

SUPABASE_URL = "https://ypgyfgbftfvouobmsync.supabase.co"
SERVICE_KEY  = "sb_secret_N3fzzlAMkUACwsDW--VZag_wCWM3_tr"
SITIO_WEB    = "https://charming-gaufre-2a49f0.netlify.app"

MONEDAS = {
    "1": ("Bolivia", "BO", "BOB", "Bs"),
    "2": ("Mexico", "MX", "MXN", "$"),
    "3": ("Argentina", "AR", "ARS", "$"),
    "4": ("Colombia", "CO", "COP", "$"),
    "5": ("Peru", "PE", "PEN", "S/"),
    "6": ("Chile", "CL", "CLP", "$"),
    "7": ("Estados Unidos", "US", "USD", "$"),
}


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
        print("  [DEBUG HTTP {}] {}".format(e.code, detail))
        raise RuntimeError("[HTTP {}] {}".format(e.code, detail))


def preguntar(texto, obligatorio=True):
    while True:
        v = input(texto).strip()
        if v or not obligatorio:
            return v
        print("  -> Este dato es obligatorio.\n")


def main():
    print("=" * 55)
    print("   ALTA DE CLIENTE NUEVO - Sistema SeS (DIAGNOSTICO 2)")
    print("=" * 55)
    print()

    negocio = preguntar("Nombre del negocio del cliente: ")
    email = preguntar("Correo del administrador: ").lower()
    while True:
        passwd = preguntar("Contrasena inicial (min 6 caracteres): ")
        if len(passwd) >= 6:
            break
        print("  -> La contrasena debe tener al menos 6 caracteres.\n")

    print("\nPais / moneda:")
    for k, v in MONEDAS.items():
        print("  {}) {}  ({})".format(k, v[0], v[2]))
    opcion = preguntar("Elige una opcion [1-7]: ", obligatorio=False) or "1"
    pais_nombre, pais, moneda, simbolo = MONEDAS.get(opcion, MONEDAS["1"])

    print("\nCreando cliente, espera...\n")

    tenant_id = None
    auth_id = None
    try:
        # 1) Tenant
        print("[1/4] Creando tenant...")
        t = api("/rest/v1/tenants", "POST", {
            "nombre": negocio, "email": email, "pais": pais,
            "moneda": moneda, "plan": "free", "activo": True,
        })
        tenant_id = t[0]["id"]
        print("  -> OK, tenant_id = " + str(tenant_id))

        # 2) Usuario en Auth
        print("[2/4] Creando usuario en Auth...")
        a = api("/auth/v1/admin/users", "POST", {
            "email": email, "password": passwd, "email_confirm": True,
        })
        auth_id = a["id"]
        print("  -> OK, auth_id = " + str(auth_id))

        # 3) Fila en public.users
        print("[3/4] Insertando en public.users...")
        api("/rest/v1/users", "POST", {
            "id": auth_id, "tenant_id": tenant_id, "nombre": "Administrador",
            "email": email, "rol": "Administrador", "activo": True,
        })
        print("  -> OK")

        # 4) Configuracion
        print("[4/4] Creando configuracion_tenant...")
        api("/rest/v1/configuracion_tenant", "POST", {
            "tenant_id": tenant_id, "nombre_negocio": negocio,
            "moneda": moneda, "simbolo_moneda": simbolo,
            "prefijo_factura": "F-", "siguiente_factura": 1, "siguiente_orden": 1,
        })
        print("  -> OK")

        print("\n" + "=" * 55)
        print("   CLIENTE CREADO CON EXITO")
        print("=" * 55)
        print("\n   Sitio web :  " + SITIO_WEB)
        print("   Usuario   :  " + email)
        print("   Contrasena:  " + passwd)
        print("=" * 55)

    except Exception as e:
        print("\nERROR: no se pudo crear el cliente.")
        print("Motivo REAL: " + str(e))
        # Limpiar si algo se creo a medias
        try:
            if auth_id:
                api("/auth/v1/admin/users/" + auth_id, "DELETE")
                print("  -> auth user borrado (limpieza)")
        except Exception:
            pass
        try:
            if tenant_id:
                api("/rest/v1/tenants?id=eq." + tenant_id, "DELETE")
                print("  -> tenant borrado (limpieza)")
        except Exception:
            pass

    print("\n")
    input("Presiona ENTER para cerrar...")


if __name__ == "__main__":
    main()