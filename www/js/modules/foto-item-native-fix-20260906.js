/* Selector nativo de foto para artículos dentro de Nueva/Editar orden.
 * iPhone: un solo toque real sobre el input file abre el selector nativo.
 * No usa input.click() programático porque Safari puede requerir varios toques.
 * Reutiliza onFotoFilaItem() original para persistencia.
 */
if (!window.__smFotoItemNativeFix0906v2) {
  window.__smFotoItemNativeFix0906v2 = true;
  instalarFotoItemNativeFix();
}

function convertirFila(row) {
  if (!row || row.dataset.smNativePhotoV2 === '1') return;
  const menu = row.querySelector('.sm-item');
  if (!menu) return;

  row.dataset.smNativePhotoV2 = '1';
  menu.style.display = 'none';

  const label = document.createElement('label');
  label.className = 'btn btn-ghost btn-sm sm-item-native-label';
  label.textContent = '📷 Agregar foto';
  label.style.position = 'relative';
  label.style.overflow = 'hidden';
  label.style.cursor = 'pointer';

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.className = 'sm-item-native-picker';
  input.removeAttribute('capture');
  input.style.position = 'absolute';
  input.style.inset = '0';
  input.style.width = '100%';
  input.style.height = '100%';
  input.style.opacity = '0';
  input.style.cursor = 'pointer';
  input.style.fontSize = '100px';

  input.addEventListener('change', () => {
    if (!input.files || !input.files.length) return;
    if (typeof window.onFotoFilaItem === 'function') window.onFotoFilaItem(input);
  });

  label.appendChild(input);
  menu.parentNode.insertBefore(label, menu.nextSibling);
}

function convertirTodas() {
  document.querySelectorAll('#orden-items-list .articulo-row').forEach(convertirFila);
}

function instalarFotoItemNativeFix() {
  const style = document.createElement('style');
  style.id = 'sm-foto-item-native-fix-0906-v2';
  style.textContent = `
    #orden-items-list .sm-item{display:none!important}
    #orden-items-list .sm-item-native-label{display:inline-flex!important;align-items:center;justify-content:center;min-height:44px;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    #orden-items-list .sm-item-native-label input[type=file]{display:block!important}
  `;
  if (!document.getElementById(style.id)) document.head.appendChild(style);

  convertirTodas();
  const host = document.getElementById('orden-items-list');
  if (host) {
    const obs = new MutationObserver(() => convertirTodas());
    obs.observe(host, { childList:true, subtree:true });
  }

  ['openOrdenModal','agregarFilaItemOrden','sincronizarCantidadPares'].forEach(nombre => {
    const original = window[nombre];
    if (typeof original !== 'function' || original.__smNativePhotoV2) return;
    const w = function(...args) {
      const r = original.apply(this,args);
      Promise.resolve(r).finally(() => requestAnimationFrame(convertirTodas));
      return r;
    };
    w.__smNativePhotoV2 = true;
    window[nombre] = w;
  });
}
