# Guía para completar Sistema SeS tú mismo (sin costo de tokens)

Esta guía cubre las tareas que **puedes hacer solo** siguiendo pasos. Están ordenadas de más fácil a más difícil.

---

## ✅ YA HECHO por el asistente
- Base de datos completa (tablas + RLS + índices + tu usuario admin) → ejecutaste `SETUP_COMPLETO.sql`
- Login real con Supabase Auth
- **Reportes con filtro de fechas + resumen financiero + exportación a PDF** (ya funciona)

---

## 1. Activar FOTOS y FIRMAS (Storage) — Dificultad: ⭐ Fácil

Las fotos y firmas necesitan un "bucket" de almacenamiento en Supabase.

**Pasos:**
1. Entra a tu proyecto en Supabase → menú izquierdo **Storage**
2. Clic en **"New bucket"**
3. Nombre exacto: `fotos`
4. Marca la opción **"Public bucket"** (público) → **Save**
5. Ahora ve a **SQL Editor** → New query, y pega el contenido del archivo:
   `supabase/STORAGE_SETUP.md` (la sección de políticas RLS, están listas para copiar/pegar)
6. Ejecuta (Run).

Listo. Ahora las fotos de calzado y las firmas se guardarán en Storage.

---

## 2. Activar la IA (reconocimiento de calzado) — Dificultad: ⭐⭐ Moderada

Requiere instalar una herramienta y una clave de Claude (Anthropic).

**Pasos (todos en tu terminal Windows):**
1. Instala Supabase CLI. La forma más fácil en Windows con `npm`:
   ```
   npm install -g supabase
   ```
   (Si no tienes Node.js, descárgalo de https://nodejs.org)

2. Consigue tu clave de Claude:
   - Entra a https://console.anthropic.com/
   - Crea cuenta → **API Keys** → **Create Key** → copia la clave (empieza con `sk-ant-...`)

3. En la terminal, dentro de la carpeta del proyecto:
   ```
   supabase login
   supabase link --project-ref ypgyfgbftfvouobmsync
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-TU-CLAVE
   supabase functions deploy analyze-shoe
   ```

Toda la guía detallada está en: `supabase/functions/DEPLOYMENT.md`

---

## 3. Gráficas de ingresos/gastos (Chart.js) — Dificultad: ⭐⭐ Moderada

El dashboard ya tiene un espacio para gráficas (`<div class="charts-row">`).

**Pasos:**
1. En `index.html`, en la sección `<head>` (junto a las otras líneas `<script src=...>`), agrega:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
   ```
2. Dentro del `<div class="charts-row">` agrega un canvas:
   ```html
   <canvas id="chart-ingresos" height="120"></canvas>
   ```
3. En `js/modules/dashboard.js`, al final de `renderDashboard()`, agrega algo como:
   ```javascript
   const ctx = document.getElementById('chart-ingresos');
   if (ctx && window.Chart) {
     if (window._chartIng) window._chartIng.destroy();
     window._chartIng = new Chart(ctx, {
       type: 'bar',
       data: {
         labels: ['Ingresos', 'Gastos'],
         datasets: [{ data: [
           state.ordenes.reduce((s,o)=>s+(Number(o.pagado)||0),0),
           state.gastos.reduce((s,g)=>s+(Number(g.monto)||0),0)
         ], backgroundColor: ['#16a34a','#dc2626'] }]
       },
       options: { plugins: { legend: { display: false } } }
     });
   }
   ```

---

## ⚠️ Lo que NO deberías intentar solo (necesita programación real)

### 4. Alta automática de empleados con email de invitación
Requiere la API Admin de Supabase (crear cuenta Auth desde el servidor) y un servicio de email. Es código de backend delicado.
**Alternativa manual que SÍ puedes hacer hoy:** crea cada empleado a mano igual que creaste tu admin:
- Supabase → Authentication → Add user (email + contraseña)
- Copia el User UID
- SQL Editor:
  ```sql
  INSERT INTO users (id, tenant_id, nombre, email, rol, activo)
  VALUES ('USER_UID', 'd5bf622d-c046-435d-ad48-cc8d65b2f66f', 'Nombre', 'correo@ses.mx', 'Empleado', true);
  ```

### 5. Facturación legal (correlativo + validación fiscal)
Depende del país y de las reglas fiscales (SAT en México, SIN en Bolivia, etc.). Es normativa compleja. La app ya emite facturas simples en PDF; la facturación *fiscal legal* debe hacerla un desarrollador que conozca tu régimen tributario.

---

## Resumen de tu situación
- **La app YA funciona para operar tu lavandería y cobrar.**
- Con los pasos 1, 2 y 3 de arriba (que puedes hacer solo) queda al ~95%.
- Las tareas 4 y 5 son opcionales / avanzadas y no bloquean que generes dinero.
