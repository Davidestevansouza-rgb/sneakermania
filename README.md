# Sistema SeS — Gestión de Lavandería de Calzado (Fase 1)

Aplicación web para la gestión integral de una lavandería de calzado:
clientes, órdenes de servicio, control de calidad con fotos y firmas,
finanzas, facturación, inventario, reportes, agenda, notificaciones y
administración de empleados.

Esta es la **Fase 1**: la aplicación monolítica original se reorganizó en
**módulos ES nativos** (sin frameworks ni bundlers) y ahora usa un backend
real en **Supabase** (base de datos PostgreSQL + Auth + RLS). El diseño
visual original se conserva **exactamente igual**.

---

## 1. Requisitos

- Un navegador moderno (Chrome, Firefox, Edge o Safari recientes).
- Python 3 (o cualquier servidor de archivos estáticos) para servir la app.
- Un proyecto de **Supabase** con las migraciones aplicadas (ver más abajo).

> La app usa **módulos ES nativos** (`<script type="module">`), por lo que
> **debe servirse por HTTP**. Abrir `index.html` con doble clic (`file://`)
> no funciona por las restricciones CORS de los módulos.

---

## 2. Ejecutar la aplicación

Desde la carpeta del proyecto:

```bash
cd sneakermania
python3 -m http.server 8000
```

Luego abre en el navegador:

```
http://localhost:8000/index.html
```

---

## 3. Configuración de credenciales

Las credenciales de Supabase ya vienen configuradas por defecto en
`js/config.js` (URL del proyecto + **clave pública anon**). La clave anon es
pública por diseño; la seguridad real la aplican las políticas **RLS** en la
base de datos.

Para usar **otro** proyecto de Supabase sin editar el código, inyecta las
variables **antes** de cargar la app, agregando este script en `index.html`
justo antes de `<script type="module" src="js/app.js">`:

```html
<script>
  window.SNEAKERMANIA_ENV = {
    SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
    SUPABASE_ANON_KEY: "TU_ANON_KEY_PUBLICA"
  };
</script>
```

Consulta `.env.example` para ver las variables disponibles.

> ⚠️ **Nunca** publiques la `service_role` key en el navegador: expondría
> toda la base de datos saltándose RLS.

---

## 4. Base de datos: aplicar migraciones

En el **SQL Editor** del panel de Supabase, ejecuta las migraciones en este
orden estricto:

1. `supabase/migrations/001_create_tables.sql` — crea las 11 tablas
   (tenants, users, clientes, ordenes, gastos, inventario, facturas,
   notificaciones, agenda, actividad y configuración del tenant).
2. `supabase/migrations/002_rls_policies.sql` — activa Row Level Security y
   define las políticas de acceso por `tenant_id`.
3. `supabase/migrations/003_indexes.sql` — crea los índices de rendimiento.

---

## 5. Crear el primer acceso (tenant + usuario)

La tabla `users` está vinculada por clave foránea a `auth.users`, por lo que
para iniciar sesión necesitas: (a) un **tenant**, (b) una **cuenta de Auth** y
(c) una **fila en `users`** que las relacione.

1. **Crear un tenant.** En el SQL Editor:

   ```sql
   insert into tenants (id, nombre)
   values (gen_random_uuid(), 'Sistema SeS')
   returning id;
   ```
   Copia el `id` devuelto (lo usarás como `tenant_id`).

2. **Crear la cuenta de acceso.** En *Authentication → Users → Add user*,
   crea un usuario con **correo y contraseña** (marca el correo como
   confirmado). Copia el `User UID` generado.

3. **Enlazar el usuario al tenant.** En el SQL Editor, usando el `User UID` y
   el `tenant_id` del paso 1:

   ```sql
   insert into users (id, tenant_id, nombre, email, rol, activo)
   values (
     'USER_UID_DE_AUTH',
     'TENANT_ID_DEL_PASO_1',
     'María Gómez',
     'maria@ses.mx',
     'Administrador',
     true
   );
   ```

4. **Iniciar sesión** en la app con ese **correo y contraseña**. El campo
   "Usuario" de la pantalla de login se usa como **correo electrónico**.

---

## 6. Estructura del proyecto

```
sneakermania/
├── index.html                # Estructura HTML (diseño original intacto)
├── styles/
│   ├── main.css              # CSS original completo
│   └── fixes.css             # Ajustes (variables --amber, estado de conexión)
├── js/
│   ├── config.js             # Credenciales + cliente Supabase
│   ├── sanitize.js           # escHtml/escAttr (protección XSS)
│   ├── state.js              # Estado en memoria + semilla
│   ├── auth.js               # Login/logout con Supabase Auth + permisos por rol
│   ├── db.js                 # Acceso a datos + cola offline
│   ├── storage.js            # Caché local (localStorage)
│   ├── ui.js                 # Utilidades de interfaz (toast, bitácora, formato)
│   ├── logo.js               # Logotipo embebido (data URI)
│   ├── app.js                # Punto de entrada, navegación e inicialización
│   └── modules/              # Un módulo por sección funcional
│       ├── dashboard.js  clientes.js  ordenes.js  ia.js  galeria.js
│       ├── finanzas.js   facturas.js  inventario.js  reportes.js
│       └── agenda.js  notificaciones.js  empleados.js  configuracion.js
├── supabase/migrations/      # 001 tablas · 002 RLS · 003 índices
├── .env.example
└── README.md
```

---

## 7. Novedades y correcciones de la Fase 1

- **Modularización** en ES Modules nativos (sin frameworks ni bundlers).
- **Backend real** en Supabase (PostgreSQL + Auth + RLS por tenant).
- **Autenticación real** con `signInWithPassword` y sesión persistente.
- **Corrección de XSS**: todo el contenido dinámico se escapa con
  `escHtml` / `escAttr`.
- **IDs con `crypto.randomUUID()`** en lugar de `Date.now()` (evita colisiones).
- **Variables `--amber` / `--amber-tint`** que faltaban en el CSS.
- **Modo sin conexión**: las escrituras se encolan en `localStorage` y se
  sincronizan automáticamente al reconectar; el estado se muestra en la barra
  superior (indicador de conexión).
- **Nuevo módulo "Empleados"** (solo Administrador) para gestionar usuarios.
- **"Seguridad" renombrado a "Configuración"**, ahora con los datos del
  negocio (nombre, WhatsApp, correo, prefijo de factura, plantilla de mensaje).

---

## 8. Fase 2 — ✅ COMPLETADA

### Funcionalidades implementadas

1. **Supabase Storage para archivos multimedia**:
   - Bucket `fotos` configurado con RLS por tenant
   - Firmas digitales subidas como PNG (campos: `firma_ingreso`, `firma_retiro`, `firma_recepcionista`)
   - Galería de fotos migrada de base64 a URLs de Storage (`ordenes.extra.fotos[]`)
   - Módulo `storage-manager.js` para uploads centralizados
   - Documentación completa: `supabase/STORAGE_SETUP.md`

2. **Edge Function para IA segura**:
   - `analyze-shoe` procesa imágenes con Claude API (Anthropic)
   - API Key protegida en servidor (nunca expuesta al cliente)
   - Análisis completo: marca, modelo, color, material, estado, tratamiento
   - Guía de despliegue: `supabase/functions/DEPLOYMENT.md`

3. **Módulo IA completamente funcional**:
   - Integración con Edge Function
   - Sube fotos a Storage antes del análisis
   - Confianza del reconocimiento (0-100%)
   - Edición manual de resultados
   - Asociación automática a órdenes

4. **Sistema de notificaciones automáticas**:
   - Calculadas automáticamente (entregas, atrasos, stock, pagos)
   - Persistidas en tabla `notificaciones` con RLS
   - Auto-sync cada 60 segundos
   - Indicador de campana con contador
   - Descarte individual por notificación

5. **Agenda con Supabase Realtime**:
   - Actualizaciones en tiempo real de órdenes
   - Suscripción automática al iniciar sesión
   - Notificaciones discretas de cambios
   - Canal dedicado con filtro por tenant

6. **Timeline y Control de Calidad sincronizados**:
   - 10 pasos de seguimiento persistidos en DB
   - Checklist de 8 puntos de calidad
   - Campos dedicados: `timeline_index`, `timeline_dates`, `control_calidad`
   - Retrocompatibilidad con datos legacy

7. **Sistema de cobros completo**:
   - QR dinámico con datos de la orden
   - Efectivo con tracking por método
   - Corrección de pagos (solo administradores)
   - Campos separados: `pagado_qr`, `pagado_efectivo`, `pagado_tarjeta`

### Configuración requerida

**Supabase Storage:**
```bash
# 1. Crear bucket 'fotos' en Supabase Dashboard (público)
# 2. Ejecutar políticas RLS: ver supabase/STORAGE_SETUP.md
```

**Edge Function:**
```bash
# 1. Instalar Supabase CLI
brew install supabase/tap/supabase

# 2. Obtener API Key de Claude en https://console.anthropic.com/
# 3. Configurar secret
supabase secrets set ANTHROPIC_API_KEY=tu-api-key

# 4. Desplegar
supabase functions deploy analyze-shoe
```

Ver documentación completa en `supabase/functions/DEPLOYMENT.md`

---

## 9. Pendiente para Fase 3

- **Alta automática de cuentas de empleados:** Crear cuenta en `auth.users` y enviar email de invitación al agregar un empleado
- **Reportes con filtros por fecha y exportación a PDF**
- **Gráficas de ingresos/gastos con Chart.js**
- **Facturación con correlativo legal y validación de RFC**
