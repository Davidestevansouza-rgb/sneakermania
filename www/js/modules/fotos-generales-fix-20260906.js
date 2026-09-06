if (!window.__smFotosGeneralesFix0906) {
  window.__smFotosGeneralesFix0906 = true;
  queueMicrotask(instalar);
  setTimeout(instalar, 500);
}

function modalOrdenVisible() {
  const modal = document.getElementById('modal-orden');
  if (!modal) return false;
  const cs = getComputedStyle(modal);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
}

function refrescarOrdenAbierta(id) {
  if (!id || !modalOrdenVisible()) return;
  if (typeof window.openOrdenModal !== 'function') return;
  const scroll = document.querySelector('#modal-orden .modal-content')?.scrollTop || 0;
  try {
    window.openOrdenModal(id);
    requestAnimationFrame(() => {
      const c = document.querySelector('#modal-orden .modal-content');
      if (c) c.scrollTop = scroll;
    });
  } catch (e) {
    console.error('No se pudo refrescar las fotos generales:', e);
  }
}

function envolverSaveOrden() {
  const original = window.saveOrden;
  if (typeof original !== 'function' || original.__smFotosGeneralesSaveV3) return;

  const w = async function(...args) {
    const idAntes = document.getElementById('orden-id')?.value || '';
    const estabaAbierto = modalOrdenVisible();
    const r = await original.apply(this, args);
    const idDespues = document.getElementById('orden-id')?.value || r || idAntes;

    // El guardado original ya sube y persiste las fotos. El problema real era
    // que su variable interna de fotos existentes quedaba desactualizada hasta
    // volver a abrir la orden. Si el modal sigue abierto, lo refrescamos una vez
    // desde el state ya guardado, exactamente igual que al salir y volver a entrar.
    if (estabaAbierto && modalOrdenVisible() && idDespues) {
      setTimeout(() => refrescarOrdenAbierta(idDespues), 0);
    }
    return r;
  };

  w.__smFotosGeneralesSaveV3 = true;
  window.saveOrden = w;
}

function instalar() {
  envolverSaveOrden();
}
