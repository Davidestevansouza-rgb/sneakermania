import { state, persist } from '../state.js';
import * as db from '../db.js';

if (!window.__smStable0906) {
  window.__smStable0906 = true;
  queueMicrotask(init);
}

function addCSS(){
  if(document.getElementById('sm-stable-css')) return;
  const s=document.createElement('style');
  s.id='sm-stable-css';
  s.textContent=`
    .sm-pop{display:none!important}
    #tab-produccion .sm-u{order:1!important}
    #tab-produccion .sm-d{order:2!important}
    #tab-produccion .sm-c{order:3!important}
    #tab-produccion #prod-info-articulo-wrap{order:4!important}
    #tab-produccion .sm-s{order:5!important}
    #tab-produccion .sm-w{order:6!important}
    #tab-produccion .sm-obs-final{order:7!important}
    #tab-produccion .sm-photo-final{order:8!important}
    #tab-produccion input,#tab-produccion select,#tab-produccion textarea{width:100%;max-width:100%;min-width:0;box-sizing:border-box}
    #orden-fotos-generales-preview{display:flex!important;flex-wrap:wrap!important;gap:8px!important;position:static!important;margin-top:8px!important}
    #orden-fotos-generales-preview img{position:static!important;width:82px!important;height:82px!important;object-fit:cover!important}
    #sm-frange,#sm-prange{gap:12px!important;overflow:visible!important}
    .timeline-list .timeline-item:nth-child(-n+4){display:none!important}
    @media(max-width:700px){
      #sm-frange,#sm-prange{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:12px!important;width:100%!important;box-sizing:border-box!important}
      #sm-frange .field,#sm-prange .field{width:100%!important;min-width:0!important}
      #sm-frange input,#sm-prange input,#sm-prange select{width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important}
      #orden-registro-general>div[style*="display:flex"]{display:grid!important;grid-template-columns:1fr!important;gap:14px!important}
      #orden-registro-general>div[style*="display:flex"]>div{width:100%!important;min-width:0!important;max-width:100%!important}
      .modal-backdrop .modal{max-width:calc(100vw - 24px)!important;overflow-x:hidden!important;box-sizing:border-box!important}
      .modal-backdrop .modal input,.modal-backdrop .modal select,.modal-backdrop .modal textarea{max-width:100%!important;box-sizing:border-box!important}
    }
  `;
  document.head.appendChild(s);
}

function nativeMenu(menu,input){
  if(!menu||!input) return;
  input.removeAttribute('capture'); input.setAttribute('accept','image/*');
  const pop=menu.querySelector('.sm-pop'); if(pop) pop.style.display='none';
  const btn=menu.querySelector('button');
  if(btn && !btn.dataset.smNativeDirect){
    btn.dataset.smNativeDirect='1';
    btn.onclick=e=>{e.preventDefault();e.stopPropagation();input.click();};
  }
}

function fixPhotoButtons(){
  const general=document.querySelector('#orden-registro-general .sm-general');
  nativeMenu(general,document.getElementById('orden-foto-general-galeria')||general?.querySelector('input[type=file]'));
  document.querySelectorAll('#orden-items-list .sm-item').forEach(m=>nativeMenu(m,m.querySelector('input[type=file]')));
  document.querySelectorAll('.sm-nco').forEach(m=>nativeMenu(m,m.querySelector('input[type=file]')));
  const prod=document.querySelector('#tab-produccion .sm-prodfoto');
  nativeMenu(prod,document.getElementById('prod-foto-galeria')||prod?.querySelector('input[type=file]'));

  const ia=document.getElementById('ia-dropzone-empty');
  const iaInput=document.getElementById('ia-file-input-galeria');
  if(ia&&iaInput){
    iaInput.removeAttribute('capture'); iaInput.setAttribute('accept','image/*');
    ia.querySelectorAll('button,label').forEach(x=>{if(/Tomar foto|Elegir de la galería/i.test(x.textContent||''))x.style.display='none';});
    let b=ia.querySelector('.sm-ia-final');
    if(!b){b=document.createElement('button');b.type='button';b.className='btn btn-ghost sm-ia-final';b.textContent='📷 Agregar foto';b.onclick=e=>{e.preventDefault();iaInput.click();};ia.appendChild(b);}
  }
}

function fixGallery(){
  const box=document.getElementById('sm-gbrand'); const out=document.getElementById('sm-gresults');
  if(!box||!out) return;
  box.querySelectorAll('.sm-clear-brand,.sm-def-clear-gallery').forEach(x=>x.remove());
  if(box.querySelector('.sm-stable-clear')) return;
  const buscar=[...box.querySelectorAll('button')].find(b=>/^Buscar$/i.test((b.textContent||'').trim()));
  if(!buscar) return;
  const b=document.createElement('button');b.type='button';b.className='btn btn-ghost btn-sm sm-stable-clear';b.textContent='Limpiar';
  b.onclick=()=>{const i=box.querySelector('input');if(i)i.value='';out.innerHTML='';};
  buscar.after(b);
}

function fixProduction(){
  const u=document.getElementById('prod-empleado')?.closest('.field');
  const d=document.getElementById('prod-fecha')?.closest('.field');
  const c=document.getElementById('prod-codigo')?.closest('.field');
  const info=document.getElementById('prod-info-articulo-wrap');
  const s=document.getElementById('prod-servicio')?.closest('.field');
  const w=document.getElementById('prod-blanqueamiento')?.closest('.field');
  const obs=document.getElementById('prod-observacion')?.closest('.field');
  const cam=document.getElementById('prod-foto-camera'); const gal=document.getElementById('prod-foto-galeria');
  const photo=gal?.closest('.field')||cam?.closest('.field');
  u?.classList.add('sm-u'); d?.classList.add('sm-d'); c?.classList.add('sm-c'); s?.classList.add('sm-s'); w?.classList.add('sm-w');
  obs?.classList.add('sm-obs-final'); photo?.classList.add('sm-photo-final');
  if(u)u.style.order='1'; if(d)d.style.order='2'; if(c)c.style.order='3'; if(info)info.style.order='4'; if(s)s.style.order='5'; if(w)w.style.order='6'; if(obs)obs.style.order='7'; if(photo)photo.style.order='8';
  if(info) info.querySelectorAll('button,label').forEach(x=>{if(/Agregar foto/i.test(x.textContent||''))x.style.display='none';});
  fixPhotoButtons();
}

function fixRanges(){
  ['sm-frange','sm-prange'].forEach(id=>{const el=document.getElementById(id);if(!el)return;el.querySelectorAll('input,select').forEach(x=>{x.style.minWidth='0';x.style.maxWidth='100%';x.style.width='100%';x.style.boxSizing='border-box';});});
}

function fixTimeline(){
  const cont=document.getElementById('seguimiento-item-timeline');
  const sel=document.getElementById('seguimiento-item-select');
  if(!cont||!sel) return;
  const it=(state.ordenItems||[]).find(x=>x.id===sel.value); if(!it) return;
  const items=[...cont.querySelectorAll('.timeline-item')];
  items.slice(0,4).forEach(x=>x.style.display='none');
  const calidad=items[4];
  if(calidad && !calidad.querySelector('.timeline-action')){
    const action=document.createElement('div');action.className='timeline-action sm-quality-fallback';
    const b=document.createElement('button');b.type='button';b.className='btn btn-teal btn-sm';b.textContent='Abrir control de calidad';
    b.onclick=()=>{ if(Number(it.timelineIndex||0)<4) it.timelineIndex=4; if(typeof window.openCalidadModal==='function') window.openCalidadModal(it.ordenId,it.id); };
    action.appendChild(b); calidad.querySelector('div:last-child')?.appendChild(action);
  }
  document.querySelectorAll('button').forEach(b=>{
    if(!/Avisar:.*listos para recoger/i.test(b.textContent||'')) return;
    const pares=(state.ordenItems||[]).filter(x=>x.ordenId===it.ordenId);
    b.style.display=pares.length&&pares.every(x=>Number(x.timelineIndex||0)>=5)?'':'none';
  });
}

async function saveAudit(id,isNew){
  const o=(state.ordenes||[]).find(x=>x.id===id); if(!o)return;
  const who=state.session?.user||state.session?.nombre||''; if(!who)return;
  o.extra=o.extra||{};
  if(isNew&&!o.extra.registradoPor)o.extra.registradoPor=who;
  if(!isNew&&who!==o.extra.registradoPor)o.extra.editadoPor=who;
  if(o.extra.editadoPor===o.extra.registradoPor)delete o.extra.editadoPor;
  await persist(); await db.saveOrden(o);
}
function renderAudit(){
  document.querySelectorAll('#ordenes-grid .ticket').forEach(t=>{
    t.querySelectorAll('.sm-order-audit,.sm-order-audit-final').forEach(x=>x.remove());
    const m=(t.textContent||'').match(/#\s*(\d+)/); if(!m)return;
    const o=(state.ordenes||[]).find(x=>String(x.numero)===m[1]); const reg=o?.extra?.registradoPor; if(!reg)return;
    const d=document.createElement('div');d.className='sm-order-audit';d.style.cssText='border-top:1px dashed var(--line);margin-top:10px;padding-top:8px;font-size:12px;line-height:1.5';
    d.innerHTML='Registrado por: <strong>'+reg+'</strong>'+(o.extra?.editadoPor&&o.extra.editadoPor!==reg?'<br>Editado por: <strong>'+o.extra.editadoPor+'</strong>':'');
    t.querySelector('.ticket-body')?.appendChild(d);
  });
}

function apply(){addCSS();fixProduction();fixPhotoButtons();fixGallery();fixRanges();fixTimeline();renderAudit();}
function wrap(name){const f=window[name];if(typeof f!=='function'||f.__smStableWrap)return;const w=function(...a){const r=f.apply(this,a);if(r&&typeof r.then==='function')return r.then(v=>{setTimeout(apply,0);return v;});setTimeout(apply,0);return r;};w.__smStableWrap=true;window[name]=w;}

function init(){
  ['openOrdenModal','agregarFilaItemOrden','openNuevoClienteOrdenModal','agregarFilaParCO','renderProduccion','renderGaleria','renderIA','viewOrdenDetalle','renderSeguimientoItemSeleccionado','renderOrdenes','switchTab'].forEach(wrap);
  const save=window.saveOrden;
  if(typeof save==='function'&&!save.__smStableAudit){const w=async function(...a){const isNew=!document.getElementById('orden-id')?.value;const id=await save.apply(this,a);if(id)await saveAudit(id,isNew);setTimeout(apply,0);return id;};w.__smStableAudit=true;window.saveOrden=w;}
  document.addEventListener('click',()=>setTimeout(apply,0),true);
  document.addEventListener('change',()=>setTimeout(apply,0),true);
  document.addEventListener('touchmove',e=>{const back=document.querySelector('.modal-backdrop.open');if(back&&!e.target.closest('.modal'))e.preventDefault();},{passive:false,capture:true});
  apply();
}
