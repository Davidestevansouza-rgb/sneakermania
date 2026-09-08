/* Correcciones funcionales finales observadas en Preview. */
if (!window.__smFunctionalFix0906) { window.__smFunctionalFix0906 = true; queueMicrotask(instalar); }
function instalar(){
  if(!document.getElementById('sm-functional-fix-css')){
    const s=document.createElement('style');s.id='sm-functional-fix-css';s.textContent='#modal-orden-detalle .timeline-list .timeline-item:nth-child(-n+4){display:none!important}';document.head.appendChild(s);
  }
  const original=window.saveOrden;
  if(typeof original==='function'&&!original.__smAutoWaFoto){
    const w=async function(...args){
      const nueva=!document.getElementById('orden-id')?.value;
      const id=await original.apply(this,args);
      if(nueva&&id&&typeof window.enviarWhatsAppOrden==='function'){
        setTimeout(()=>window.enviarWhatsAppOrden(id),120);
      }
      return id;
    };
    w.__smAutoWaFoto=true;window.saveOrden=w;
  }
}
