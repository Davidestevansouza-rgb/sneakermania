/* Selector nativo de foto para artículos dentro de Nueva/Editar orden.
 * Intercepta el botón agregado por enhancements-20260906 y abre directamente
 * un <input type=file accept=image/*> SIN capture. En iPhone esto muestra el
 * selector nativo: Fototeca / Tomar foto / Seleccionar archivo.
 * No cambia guardado ni persistencia: reutiliza onFotoFilaItem() original.
 */
if (!window.__smFotoItemNativeFix0906) {
  window.__smFotoItemNativeFix0906 = true;
  instalarFotoItemNativeFix();
}

function asegurarInputNativo(row) {
  let input = row.querySelector('input.sm-item-native-picker');
  if (input) return input;
  input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.className = 'sm-item-native-picker';
  input.style.position = 'absolute';
  input.style.width = '1px';
  input.style.height = '1px';
  input.style.opacity = '0';
  input.style.pointerEvents = 'none';
  input.style.left = '-9999px';
  input.removeAttribute('capture');
  input.addEventListener('change', () => {
    if (!input.files || !input.files.length) return;
    if (typeof window.onFotoFilaItem === 'function') {
      window.onFotoFilaItem(input);
    }
  });
  row.appendChild(input);
  return input;
}

function instalarFotoItemNativeFix() {
  const style = document.createElement('style');
  style.id = 'sm-foto-item-native-fix-0906';
  style.textContent = `
    #orden-items-list .sm-item .sm-pop{display:none!important}
  `;
  if (!document.getElementById(style.id)) document.head.appendChild(style);

  document.addEventListener('click', e => {
    const btn = e.target?.closest?.('#orden-items-list .sm-item > button');
    if (!btn) return;
    const row = btn.closest('.articulo-row');
    if (!row) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const input = asegurarInputNativo(row);
    input.value = '';
    input.click();
  }, true);
}
