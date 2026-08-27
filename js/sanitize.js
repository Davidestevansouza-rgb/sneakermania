/* ============================================================
   SANITIZACIÓN — Prevención de XSS
   ============================================================
   Escapa texto proveniente del usuario antes de insertarlo con
   innerHTML. Corrige la vulnerabilidad detectada en el informe
   técnico: los datos de clientes/órdenes se inyectaban sin escapar.
   ============================================================ */

/**
 * Escapa caracteres HTML peligrosos para insertar texto de forma segura.
 * @param {*} value - valor a escapar (se convierte a string).
 * @returns {string} texto seguro para innerHTML.
 */
export function escHtml(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapa un valor para usarlo dentro de un atributo HTML entre comillas
 * dobles (por ejemplo value="...").
 * @param {*} value
 * @returns {string}
 */
export function escAttr(value) {
  return escHtml(value);
}
