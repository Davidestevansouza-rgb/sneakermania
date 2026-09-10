/* Selector nativo de foto para artículos dentro de Nueva/Editar orden.
 * iPhone: un solo toque real sobre el input file abre el selector nativo.
 * Android: abre directamente la cámara trasera mediante capture=environment.
 * No usa input.click() programático porque Safari puede requerir varios toques.
 * Reutiliza onFotoFilaItem() original para persistencia y añade vista previa inmediata.
 */
if (!window.__smFotoItemNativeFix0906v4) {
  window.__smFotoItemNativeFix0906v4 = true;
  instalarFotoItemNativeFix();
}

function asegurarPreview(row, label) {
  let preview = row.querySelector('.sm-item-native-preview');
  if (preview) return preview;
  preview = document.createElement('div');
  preview.className = 'sm-item-native-preview';
  preview.innerHTML = '<img alt="Vista previa de la foto"><span>Foto lista para guardar</span>';
  label.insertAdjacentElement('beforebegin', preview);
  return preview;
}

function mostrarPreview(row, label, file) {
  if (!file) return;
  const preview = asegurarPreview(row, label);
  const img = preview.querySelector('img');
  const anterior = preview.dataset.objectUrl || '';
  if (anterior) {
    try { URL.revokeObjectURL(anterior); } catch (_) {}
  }
  const url = URL.createObjectURL(file);
  preview.dataset.objectUrl = url;
  img.src = url;
  preview.style.display = 'flex';
}

function convertirFila(row) {
  if (!row || row.dataset.smNativePhotoV4 === '1') return;
  const menu = row.querySelector('.sm-item');
  if (!menu) return;

  row.dataset.smNativePhotoV4 = '1';
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
  if (/Android/i.test(navigator.userAgent || '')) input.setAttribute('capture', 'environment');
  else input.removeAttribute('capture');
  input.style.position = 'absolute';
  input.style.inset = '0';
  input.style.width = '100%';
  input.style.height = '100%';
  input.style.opacity = '0';
  input.style.cursor = 'pointer';
  input.style.fontSize = '100px';

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    // Guardamos una referencia adicional en la propia fila. El flujo original
    // sigue usando onFotoFilaItem(); esta referencia sirve como verificación
    // posterior al guardar para asegurar que un artículo NUEVO no pierda su foto.
    row.__smPendingItemPhoto = file;
    mostrarPreview(row, label, file);
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
  style.id = 'sm-foto-item-native-fix-0906-v4';
  style.textContent = `
    #orden-items-list .sm-item{display:none!important}
    #orden-items-list .sm-item-native-label{display:inline-flex!important;align-items:center;justify-content:center;min-height:44px;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    #orden-items-list .sm-item-native-label input[type=file]{display:block!important}
    #orden-items-list .sm-item-native-preview{display:none;align-items:center;gap:10px;margin:10px 0}
    #orden-items-list .sm-item-native-preview img{width:86px;height:86px;object-fit:cover;border-radius:10px;border:1px solid var(--line,#ddd)}
    #orden-items-list .sm-item-native-preview span{font-size:12px;font-weight:700;color:var(--muted,#666)}
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
    if (typeof original !== 'function' || original.__smNativePhotoV4) return;
    const w = function(...args) {
      const r = original.apply(this,args);
      Promise.resolve(r).finally(() => requestAnimationFrame(convertirTodas));
      return r;
    };
    w.__smNativePhotoV4 = true;
    window[nombre] = w;
  });
}
