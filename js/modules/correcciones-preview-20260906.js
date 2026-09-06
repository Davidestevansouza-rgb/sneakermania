import { state, persist } from '../state.js';
import * as db from '../db.js';
import { fmtDate } from '../ui.js';

/* Correcciones observadas en Preview/iPhone. Aisladas de main y sin cambios de esquema. */
if (!window.__smPreviewFix0906) { window.__smPreviewFix0906 = true; queueMicrotask(instalar); }

function css(){
  if(document.getElementById('sm-preview-fix-css')) return;
  const s=document.createElement('style'); s.id='sm-preview-fix-css'; s.textContent=`
  .sm-native-photo .sm-pop{display:none!important}.sm-native-photo{position:static!important}
  #orden-registro-general>div[style*="display:flex"]{gap:16px!important;align-items:flex-start!important;flex-wrap:wrap!important}
  #orden-registro-general>div[style*="display:flex"]>div{flex:1 1 220px!important;min-width:0!important}
  #orden-fotos-generales-preview{display:flex!important;gap:8px!important;flex-wrap:wrap!important;margin:8px 0!important;position:static!important}
  #orden-fotos-generales-preview img{position:static!important;max-width:82px!important;max-height:82px!important;object-fit:cover!important}
  #sm-frange,#sm-prange{gap:14px!important}.sm-tools{overflow:hidden!important}.sm-tools .field{min-width:0!important}
  #tab-produccion .sm-pop{display:none!important}
  .sm-audit{font-size:12px;margin:8px 2px 0;color:var(--muted,#666);line-height:1.5}
  body.sm-modal-lock{overflow:hidden!important;position:fixed!important;width:100%!important;left:0!important;right:0!important}
  @media(max-width:700px){
    #sm-frange,#sm-prange{display:grid!important;grid-template-columns:1fr 1fr!important;gap:12px!important;width:100%!important}
    #sm-frange .field,#sm-prange .field{width:100%!important;min-width:0!important}
    #sm-frange input,#sm-prange input,#sm-prange select{width:100%!important;max-width:100%!important;box-sizing:border-box!important}
    #orden-registro-general>div[style*="display:flex"]{display:grid!important;grid-template-columns:1fr!important}
  }`;
  document.head.appendChild(s);
}

function hacerNativo(menu){
  if(!menu||menu.dataset.native==='1') return; menu.dataset.native='1'; menu.classList.add('sm-native-photo');
  const trigger=menu.querySelector('button'); if(!trigger) return;
  const scope=menu.closest('.articulo-row,.co-par-row,#orden-registro-general,#tab-produccion')||menu.parentElement;
  const inputs=[...scope.querySelectorAll('input[type=file]')];
  const input=inputs.find(i=>!i.hasAttribute('capture'))||inputs[0]; if(!input) return;
  input.removeAttribute('capture'); input.setAttribute('accept','image/*');
  trigger.onclick=e=>{e.preventDefault();e.stopPropagation();input.click();};
}

function fotosNativas(){ document.querySelectorAll('.sm-general,.sm-item,.sm-nco,#tab-produccion .sm-menu').forEach(hacerNativo); }

function galeriaLimpiar(){
  const box=document.getElementById('sm-gbrand'); if(!box||box.querySelector('.sm-clear-brand')) return;
  const buscar=[...box.querySelectorAll('button')].find(b=>/buscar/i.test(b.textContent||'')); if(!buscar) return;
  const b=document.createElement('button'); b.type='button'; b.className='btn btn-ghost btn-sm sm-clear-brand'; b.textContent='Limpiar';
  b.onclick=()=>{const i=box.querySelector('input'); if(i)i.value=''; const out=box.querySelector('.sm-brand-results')||box.lastElementChild; if(out)out.innerHTML='';};
  buscar.after(b);
}

function produccionOrden(){
  const tab=document.getElementById('tab-produccion'); if(!tab) return;
  const codigo=document.getElementById('prod-codigo'); const blanco=document.getElementById('prod-blanqueamiento');
  const info=[...tab.querySelectorAll('div')].find(x=>/^Información de la orden$/i.test((x.textContent||'').trim()))?.parentElement;
  if(info&&codigo){const f=codigo.closest('.field')||codigo.parentElement; f?.after(info); info.querySelectorAll('button,label').forEach(x=>{if(/Agregar foto/i.test(x.textContent||''))x.style.display='none';});}
  const obs=document.getElementById('prod-observacion')?.closest('.field')||document.getElementById('prod-observacion')?.parentElement;
  const fotos=[...tab.querySelectorAll('div')].find(x=>/Fotos \(obligatorio/i.test(x.textContent||'')&&x.querySelector('.sm-menu'));
  const bw=blanco?.closest('.field')||blanco?.parentElement;
  if(obs&&bw) bw.after(obs); if(fotos&&obs) obs.after(fotos);
  fotosNativas();
}

function iaFoto(){
  const tab=document.getElementById('tab-ia'); if(!tab||tab.querySelector('.sm-ia-unica')) return;
  const botones=[...tab.querySelectorAll('button,label')].filter(x=>/Tomar foto|Elegir de la galería/i.test(x.textContent||'')); if(botones.length<2)return;
  const inputs=[...tab.querySelectorAll('input[type=file]')]; const input=inputs.find(i=>!i.hasAttribute('capture'))||inputs[0]; if(!input)return;
  input.removeAttribute('capture'); input.accept='image/*'; botones.forEach(b=>b.style.display='none');
  const b=document.createElement('button');b.type='button';b.className='btn btn-ghost sm-ia-unica';b.textContent='📷 Agregar foto';b.onclick=()=>input.click();botones[0].parentElement?.appendChild(b);
}

function timeline(){
  document.querySelectorAll('.timeline-step').forEach((x,i)=>{if(i<4)x.style.display='none';});
  document.querySelectorAll('button').forEach(b=>{if(/Avisar:.*listos para recoger/i.test(b.textContent||'')){
    const modal=b.closest('.modal,.modal-card')||document; const texto=modal.textContent||''; b.style.display=/Biblioteca/.test(texto)&&!/Marcar completado\s*$/m.test(texto)?'':'none';
  }});
}

let sy=0;
function modalLock(){
  const abierto=[...document.querySelectorAll('.modal')].some(m=>getComputedStyle(m).display!=='none'&&m.getBoundingClientRect().height>0);
  if(abierto&&!document.body.classList.contains('sm-modal-lock')){sy=window.scrollY;document.body.style.top=`-${sy}px`;document.body.classList.add('sm-modal-lock');}
  if(!abierto&&document.body.classList.contains('sm-modal-lock')){document.body.classList.remove('sm-modal-lock');document.body.style.top='';window.scrollTo(0,sy);}
}

async function guardarAuditoria(id, eraNueva){
  const o=(state.ordenes||[]).find(x=>x.id===id); if(!o)return;
  o.extra=o.extra||{}; const nombre=state.session?.user||state.session?.nombre||'Usuario';
  if(eraNueva&&!o.extra.registradoPor)o.extra.registradoPor=nombre;
  if(!eraNueva&&nombre!==o.extra.registradoPor)o.extra.editadoPor=nombre;
  if(o.extra.editadoPor===o.extra.registradoPor)delete o.extra.editadoPor;
  await persist(); try{await db.saveOrden(o);}catch(e){console.error('Auditoría de orden:',e);}
}
function auditoriaCards(){
  (state.ordenes||[]).forEach(o=>{const reg=o.extra?.registradoPor;if(!reg)return;document.querySelectorAll('.order-card,.orden-card').forEach(c=>{if(!new RegExp('#\\s*'+o.numero+'\\b').test(c.textContent||'')||c.querySelector('.sm-audit'))return;const d=document.createElement('div');d.className='sm-audit';d.innerHTML='Registrado por: <strong>'+reg+'</strong>'+(o.extra?.editadoPor&&o.extra.editadoPor!==reg?'<br>Editado por: <strong>'+o.extra.editadoPor+'</strong>':'');c.appendChild(d);});});
}

function refrescar(){css();fotosNativas();galeriaLimpiar();produccionOrden();iaFoto();timeline();auditoriaCards();modalLock();}
function wrap(nombre,after){const f=window[nombre];if(typeof f!=='function'||f.__smPreviewFix)return;const w=function(...a){const r=f.apply(this,a);if(r&&typeof r.then==='function')return r.then(v=>{setTimeout(()=>after(v,a),0);return v;});setTimeout(()=>after(r,a),0);return r;};w.__smPreviewFix=true;window[nombre]=w;}
function instalar(){
  css();
  ['openOrdenModal','agregarFilaItemOrden','openNuevoClienteOrdenModal','agregarFilaParCO','renderProduccion','renderGaleria','renderIA','viewOrdenDetalle','renderOrdenes','switchTab'].forEach(n=>wrap(n,refrescar));
  const f=window.saveOrden;if(typeof f==='function'&&!f.__smAudit){const w=async function(...a){const eraNueva=!document.getElementById('orden-id')?.value;const id=await f.apply(this,a);if(id)await guardarAuditoria(id,eraNueva);refrescar();return id;};w.__smAudit=true;window.saveOrden=w;}
  document.addEventListener('click',()=>setTimeout(refrescar,0),true); document.addEventListener('change',()=>setTimeout(refrescar,0),true);
  refrescar();
}
