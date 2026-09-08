import { state, todayISO, persist } from '../state.js';
import * as db from '../db.js';
import { showToast, clienteById, fmtMoney, fmtDate } from '../ui.js';

if (!window.__smUltimas0906) {
  window.__smUltimas0906 = true;
  queueMicrotask(init);
}

function fixArticuloFotoOrden(){
  document.querySelectorAll('#orden-items-list label[title="Agregar foto de este artículo"]').forEach(label=>{
    const input=label.querySelector('input[type=file]');
    if(!input) return;
    input.removeAttribute('capture');
    input.setAttribute('accept','image/*');
    if(label.dataset.smDirectFoto==='1') return;
    label.dataset.smDirectFoto='1';
    label.onclick=e=>{
      if(e.target===input) return;
      e.preventDefault();
      e.stopPropagation();
      input.click();
    };
  });
}

function fixProduccionInfo(){
  const info=document.getElementById('prod-info-articulo-wrap');
  if(!info) return;
  info.querySelectorAll('label[title="Agregar foto de este artículo"],button,label').forEach(el=>{
    if(/Agregar foto/i.test(el.textContent||'')) el.style.setProperty('display','none','important');
  });
}

function fixBibliotecaIcon(){
  document.querySelectorAll('#tab-biblioteca button').forEach(btn=>{
    if(/Ubicar en estantería/i.test(btn.textContent||'')) {
      btn.textContent=(btn.textContent||'').replace(/^\s*📚\s*/,'📦 ').replace(/^\s*👟\s*/,'📦 ');
      if(!/^📦/.test(btn.textContent.trim())) btn.textContent='📦 Ubicar en estantería';
    }
  });
}

async function completarSupervisionItem(item){
  if(!item) return;
  item.timelineDates=item.timelineDates&&typeof item.timelineDates==='object'?item.timelineDates:{};
  const desde=Math.max(0,Number(item.timelineIndex||0));
  for(let i=desde;i<4;i++) if(!item.timelineDates[i]) item.timelineDates[i]=todayISO(0);
  item.timelineIndex=4;
  try{
    await persist();
    await db.saveOrdenItem(item);
    if(typeof window.sincronizarEstadoOrdenDesdeTimelinePares==='function') await window.sincronizarEstadoOrdenDesdeTimelinePares(item);
    if(typeof window.renderSeguimientoItemSeleccionado==='function') window.renderSeguimientoItemSeleccionado(item.ordenId,item.id);
    if(typeof window.renderOrdenes==='function') window.renderOrdenes();
    showToast('Supervisión completada');
  }catch(e){console.error(e);showToast('Error al guardar la supervisión');}
}

async function completarSupervisionOrden(o){
  if(!o) return;
  o.timelineDates=o.timelineDates&&typeof o.timelineDates==='object'?o.timelineDates:{};
  const desde=Math.max(0,Number(o.timelineIndex||0));
  for(let i=desde;i<4;i++) if(!o.timelineDates[i]) o.timelineDates[i]=todayISO(0);
  o.timelineIndex=4;
  try{
    await persist();
    await db.saveOrden(o);
    if(typeof window.viewOrdenDetalle==='function') window.viewOrdenDetalle(o.id);
    if(typeof window.renderOrdenes==='function') window.renderOrdenes();
    showToast('Supervisión completada');
  }catch(e){console.error(e);showToast('Error al guardar la supervisión');}
}

function crearSupervision(host,onClick){
  if(host.querySelector('.sm-supervision-step')) return;
  const d=document.createElement('div');
  d.className='sm-supervision-step';
  d.style.cssText='display:flex;gap:12px;align-items:flex-start;margin:0 0 16px 0;';
  d.innerHTML='<div class="timeline-dot">S</div><div><div class="timeline-label">Supervisión</div><div class="timeline-action"><button type="button" class="btn btn-teal btn-sm">Marcar completado</button></div></div>';
  d.querySelector('button').onclick=onClick;
  const lista=host.querySelector('.timeline-list');
  if(lista) lista.insertAdjacentElement('beforebegin',d); else host.prepend(d);
}

function fixSeguimiento(){
  document.querySelectorAll('.timeline-list .timeline-item').forEach((x,i)=>{ if(i<4) x.style.setProperty('display','none','important'); });
  const cont=document.getElementById('seguimiento-item-timeline');
  const sel=document.getElementById('seguimiento-item-select');
  if(cont&&sel){
    const item=(state.ordenItems||[]).find(x=>x.id===sel.value);
    if(item&&Number(item.timelineIndex||0)<4) crearSupervision(cont,()=>completarSupervisionItem(item));
    else cont.querySelector('.sm-supervision-step')?.remove();
    return;
  }
  const detalle=document.getElementById('orden-detalle-content');
  if(detalle){
    const titulo=document.getElementById('orden-detalle-titulo-extra')?.textContent||'';
    const m=titulo.match(/#(\d+)/);
    const o=m?(state.ordenes||[]).find(x=>String(x.numero)===m[1]):null;
    const lista=[...detalle.querySelectorAll('.timeline-list')].find(x=>!x.closest('#seguimiento-item-timeline'));
    if(lista&&o&&Number(o.timelineIndex||0)<4) crearSupervision(lista.parentElement||detalle,()=>completarSupervisionOrden(o));
  }
}

function inferirAuditoria(o){
  if(!o) return false;
  o.extra=o.extra||{};
  let cambio=false;
  if(!o.extra.registradoPor){
    const log=(state.activityLog||[]).find(a=>new RegExp('Creó orden #'+o.numero+'(?:\\D|$)','i').test(a.accion||''));
    if(log?.usuario){o.extra.registradoPor=log.usuario;cambio=true;}
  }
  const edit=(state.activityLog||[]).find(a=>new RegExp('Editó orden #'+o.numero+'(?:\\D|$)','i').test(a.accion||''));
  if(edit?.usuario&&edit.usuario!==o.extra.registradoPor&&o.extra.editadoPor!==edit.usuario){o.extra.editadoPor=edit.usuario;cambio=true;}
  if(o.extra.editadoPor===o.extra.registradoPor){delete o.extra.editadoPor;cambio=true;}
  return cambio;
}

function fixAuditoriaOrdenes(){
  // Esta capa SOLO completa/persiste los datos de auditoría.
  // El render visual se hace únicamente en correcciones-estables para evitar duplicados.
  (state.ordenes||[]).forEach(o=>{
    if(inferirAuditoria(o)) { persist().then(()=>db.saveOrden(o)).catch(()=>{}); }
  });
}

function mensajeOrden(o){
  const c=clienteById(o.clienteId)||{};
  const items=(state.ordenItems||[]).filter(it=>it.ordenId===o.id);
  const lineas=[
    'Hola '+(c.nombre||'')+' 👋',
    'Tu orden #'+o.numero+' fue registrada correctamente.',
    'Ingreso: '+fmtDate(o.fechaIngreso),
    'Entrega estimada: '+fmtDate(o.fechaEstimada),
    'Total: '+fmtMoney(Number(o.precio||0)-Number(o.descuento||0))
  ];
  if(items.length) lineas.push('Artículos: '+items.map(it=>it.codigo+' · '+(it.descripcion||'')).join(' | '));
  return lineas.join('\n');
}

async function compartirOrdenConFoto(o){
  const foto=o?.extra?.fotos?.find(f=>f.categoria==='todos_pares');
  if(!foto?.url) return false;
  try{
    const resp=await fetch(foto.url);
    if(!resp.ok) return false;
    const blob=await resp.blob();
    const file=new File([blob],'orden-'+o.numero+'.jpg',{type:blob.type||'image/jpeg'});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      await navigator.share({files:[file],text:mensajeOrden(o)});
      return true;
    }
  }catch(e){ if(e?.name!=='AbortError') console.error(e); }
  return false;
}

function prepararCompartirFotoNuevaOrden(){
  const save=window.saveOrden;
  if(typeof save!=='function'||save.__smFotoNuevaFinal) return;
  const w=async function(...args){
    const eraNueva=!document.getElementById('orden-id')?.value;
    const teniaFoto=document.querySelectorAll('#orden-fotos-generales-preview img').length>0;
    const id=await save.apply(this,args);
    if(eraNueva&&id&&teniaFoto){
      const o=(state.ordenes||[]).find(x=>x.id===id);
      if(o){
        const ok=await compartirOrdenConFoto(o);
        if(!ok) showToast('Orden guardada. Para enviar la foto junto con la información usa el botón WhatsApp del detalle.');
      }
    }
    return id;
  };
  w.__smFotoNuevaFinal=true;
  window.saveOrden=w;
}

function apply(){
  fixArticuloFotoOrden();
  fixProduccionInfo();
  fixBibliotecaIcon();
  fixSeguimiento();
  fixAuditoriaOrdenes();
}

function wrap(name){
  const f=window[name]; if(typeof f!=='function'||f.__smUltimasWrap) return;
  const w=function(...a){const r=f.apply(this,a);if(r&&typeof r.then==='function')return r.then(v=>{setTimeout(apply,0);return v;});setTimeout(apply,0);return r;};
  w.__smUltimasWrap=true; window[name]=w;
}

function init(){
  ['openOrdenModal','agregarFilaItemOrden','renderProduccion','viewOrdenDetalle','renderSeguimientoItemSeleccionado','renderOrdenes','renderBiblioteca','switchTab'].forEach(wrap);
  prepararCompartirFotoNuevaOrden();
  document.addEventListener('click',()=>setTimeout(apply,0),true);
  document.addEventListener('change',()=>setTimeout(apply,0),true);
  apply();
}
