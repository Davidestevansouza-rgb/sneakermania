/* Corrección puntual: el menú de "Agregar foto" de artículos quedaba detrás del modal en iPhone.
 * No cambia guardado ni categorías de fotos; solo asegura que el selector quede visible/clicable.
 */
if (!window.__smItemPhotoMenuFix0906) {
  window.__smItemPhotoMenuFix0906 = true;
  const style = document.createElement('style');
  style.id = 'sm-item-photo-menu-fix';
  style.textContent = `
    #modal-orden .sm-menu{position:relative!important;z-index:2147483000!important}
    #modal-orden .sm-pop{z-index:2147483640!important}
    @media(max-width:700px){
      #modal-orden .sm-pop{
        position:fixed!important;
        left:16px!important;
        right:16px!important;
        top:auto!important;
        bottom:88px!important;
        width:auto!important;
        max-height:55vh!important;
        overflow:auto!important;
      }
    }
  `;
  document.head.appendChild(style);
}
