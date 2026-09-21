# Plan de optimización PostgREST / Egress — 2026-09-21

## Objetivo
Reducir de forma fuerte el Egress de PostgREST sin borrar datos, sin ocultar información histórica y sin cambiar permisos funcionales.

## Principio
Permiso para acceder a información no implica precargar toda la base. Cada pantalla debe cargar solo lo necesario y consultar datos antiguos bajo demanda.

## Matriz por rol

| Rol | Inicio de sesión | Bajo demanda |
|---|---|---|
| Administrador | perfil, configuración, inventario, notificaciones activas, datos mínimos de dashboard, 20 órdenes recientes + sus artículos necesarios | órdenes antiguas/búsqueda global, siguientes 30 órdenes, fotos de la orden abierta, histórico Producción por fecha, Biblioteca, reportes/finanzas/configuración según pantalla |
| Supervisor | perfil, configuración, inventario, notificaciones activas, datos mínimos de dashboard, 20 órdenes recientes + sus artículos necesarios | órdenes antiguas/búsqueda global, siguientes 30 órdenes, fotos de la orden abierta, histórico Producción por fecha, Biblioteca, Agenda |
| Empleado | perfil, configuración mínima, inventario, Producción de hoy, 20 órdenes recientes necesarias para Galería | artículo exacto al escribir código en Producción, registro existente exacto por código+servicio, búsqueda global de Galería, siguientes 30 carpetas, Agenda al abrir |

## Pantallas

### Órdenes
- 20 órdenes iniciales.
- Carga automática de 30 más al llegar al final.
- La búsqueda nunca se limita a lo ya cargado: consulta toda la base.
- Abrir una orden antigua carga esa orden y sus artículos.
- Ninguna orden se elimina ni queda inaccesible por la paginación.

### Galería
- 20 carpetas iniciales.
- Carga automática de 30 más.
- Búsqueda global por código/par, cliente, marca, modelo y talla.
- Las referencias completas de fotos se cargan para la orden/carpeta necesaria, no para todo el histórico.
- R2 sigue siendo la fuente de las imágenes; no se modifica ni borra ninguna foto.

### Producción
- Vista normal: registros de hoy.
- Al escribir un código antiguo, consulta exacta de `orden_items` si no está en memoria.
- Antes de registrar, consulta exacta de `registro_pares` por código+servicio para preservar anti-duplicados y propietario.
- Histórico: se consulta por fecha/rango, no se precarga todo al iniciar.

### Biblioteca
- Lo que está actualmente en Biblioteca debe seguir visible.
- Los artículos históricos/antiguos se consultan cuando se busca por código/orden o fecha.
- Casos antiguos forman parte de las pruebas de regresión.

### Agenda
- No requiere precarga global al login.
- Se cargan los datos necesarios al abrir Agenda.

### Dashboard
- Debe usar datos mínimos/resumen, no depender de descargar `ordenes.extra` ni todos los artículos/fotos.

## Pruebas obligatorias antes de merge

1. Login por Administrador, Supervisor y Empleado sin errores.
2. Empleado encuentra un artículo reciente y uno antiguo por código en Producción.
3. Anti-duplicado código+servicio sigue detectando registros de otros días/usuarios.
4. Registro nuevo de Producción sigue vinculando foto a R2/Galería y actualizando artículo.
5. Órdenes muestra 20 iniciales y agrega 30 sin duplicados ni saltos.
6. Búsqueda encuentra una orden antigua aunque no esté cargada en la primera página.
7. Galería muestra 20 carpetas, agrega 30 y puede abrir una carpeta antigua por búsqueda.
8. Fotos antiguas y recientes siguen resolviendo URLs R2.
9. Biblioteca conserva artículos físicos actuales y permite localizar casos antiguos.
10. Agenda conserva hoy/atrasados/programados.
11. RLS/tenant isolation se mantiene.
12. root/ y www/ quedan sincronizados.
13. No se modifica ni borra ningún dato de producción durante estas pruebas.
14. Medición final: comparar bytes estimados de carga inicial por rol contra el diseño anterior (~4.54 MB JSON bruto).

## Casos de control tomados antes de modificar código
- Conteo al corte: 419 órdenes, 1.159 artículos, 379 clientes, 1.920 registros de Producción.
- Biblioteca antigua: 5-1 / B2, 8-6 / H3, 21-1 / A8, 35-1 / R1, 36-2 / R2, 40-1 / H6, 43-1 / A8, 44-3 / N2.
- Órdenes antiguas con fotos: #229, #242, #362, #369, #410.
- Producción del día incluye registros de Bruno, Miguel Menacho, Nikolas, Rodrigo y Ydderf.

Estos controles deben seguir localizables después de la optimización.
