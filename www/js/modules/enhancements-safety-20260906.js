/* Protección adicional para la fecha general de entrega.
 * En una orden existente NO sobrescribe las fechas individuales si el usuario
 * abrió Editar y guardó sin tocar el nuevo campo general.
 */
if (!window.__smDateSafety0906) {
  window.__smDateSafety0906 = true;
  queueMicrotask(() => {
    document.addEventListener('change', e => {
      if (e.target && e.target.id === 'orden-fecha-entrega-general') {
        e.target.dataset.smChanged = '1';
      }
    }, true);

    const original = window.saveOrden;
    if (typeof original !== 'function' || original.__smDateSafety) return;
    const wrapper = function(...args) {
      const fecha = document.getElementById('orden-fecha-entrega-general');
      const editando = !!document.getElementById('orden-id')?.value;
      if (editando && fecha && fecha.dataset.smChanged !== '1') {
        const valor = fecha.value;
        fecha.value = '';
        try { return original.apply(this, args); }
        finally { fecha.value = valor; }
      }
      return original.apply(this, args);
    };
    wrapper.__smDateSafety = true;
    window.saveOrden = wrapper;
  });
}
