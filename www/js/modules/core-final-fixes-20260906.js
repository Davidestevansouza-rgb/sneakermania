import { state } from '../state.js';
import * as storage from '../storage-manager.js';
import { fmtDate, fmtMoney, clienteById, showToast } from '../ui.js';

if (!window.__smCoreFinalFix0906) {
  window.__smCoreFinalFix0906 = true;
  queueMicrotask(instalar);
  setTimeout(instalar, 400);
  setTimeout(instalar, 1200);
}

const fotoFileCache = new Map();

function normalizarWhatsApp(numero) {
  let n = String(numero || '').replace(/\D/g, '');
  if (!n) return '';
  if (n.length === 8) n = '591' + n;
  if (n.startsWith('0') && n.length === 9) n = '591' + n.slice(1);
  return n;
}

function instalarNormalizacionWhatsApp() {
  ['enviarWhatsApp','enviarWhatsAppConFoto'].forEach(nombre => {
    const original = window[nombre];
    if (typeof original !== 'function' || original.__smNumeroBO) return;
    const w = function(numero, ...rest) { return original.call(this, normalizarWhatsApp(numero), ...rest); };
    w.__smNumeroBO = true;
    window[nombre] = w;
  });
}

function mensajeOrden(o) {
  const c = clienteById(o?.clienteId) || {};
  const items = (state?.ordenItems || [])
    .filter(it => it.ordenId === o?.id)
    .sort((a,b) => Number(a.numeroItem || 0) - Number(b.numeroItem || 0));
  const valorFinal = Number(o?.precio || 0) - Number(o?.descuento || 0);
  const lineas = [
    'Hola ' + (c.nombre || '') + ' 👋',
    '¡Registramos tu pedido (orden #' + (o?.numero || '') + ')!',
    '',
    'Orden #' + (o?.numero || ''),
    'Cliente: ' + (c.nombre || '—'),
    'Ingreso: ' + fmtDate(o?.fechaIngreso),
    'Entrega est.: ' + fmtDate(o?.fechaEstimada),
    '— Artículos (' + items.length + ') —'
  ];
  items.forEach((it, i) => {
    const servicios = Array.isArray(it.tipoServicio) && it.tipoServicio.length
      ? it.tipoServicio.join(', ')
      : (it.servicio || 'Sin servicio');
    lineas.push(
      'Artículo ' + (i + 1) + ': ' + (it.descripcion || it.codigo || '—') +
      ' · Servicio: ' + servicios +
      ' · Estado: ' + (it.estado || 'Recibido y registrado')
    );
  });
  lineas.push('Total: ' + fmtMoney(valorFinal) + ' · Pagado: ' + fmtMoney(Number(o?.pagado || 0)));
  lineas.push('', '¡Gracias por tu confianza!');
  return lineas.join('\n');
}

function fotoGeneral(o) {
  const fotos = o?.extra && Array.isArray(o.extra.fotos) ? o.extra.fotos : [];
  return fotos.find(f => f && f.categoria === 'todos_pares') || null;
}

async function prepararFotoGeneral(o) {
  const f = fotoGeneral(o);
  if (!f) return null;
  const key = o.id + ':' + (f.path || f.url || 'foto');
  if (fotoFileCache.has(key)) return fotoFileCache.get(key);
  if ((typeof f.url === 'string' && f.url.startsWith('r2://')) || f.path) return null;
  try {
    const u = await storage.resolveImageUrl(f.url, f.path);
    const r = await fetch(u);
    if (!r.ok) return null;
    const blob = await r.blob();
    const file = new File([blob], 'orden-' + o.numero + '.jpg', { type: blob.type || 'image/jpeg' });
    fotoFileCache.set(key, file);
    return file;
  } catch (e) {
    console.warn('No se pudo preparar la foto general para compartir; se continúa con texto.');
    return null;
  }
}

async function compartirOrdenConFoto(o) {
  const c = clienteById(o?.clienteId) || {};
  const numero = normalizarWhatsApp(c.whatsapp || c.telefono || '');
  const msg = mensajeOrden(o);
  const file = await prepararFotoGeneral(o);
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: msg, title: 'Orden #' + o.numero }); return true; }
    catch (e) { if (e?.name === 'AbortError') return false; console.error('No se pudo abrir el compartir nativo:', e); }
  }
  if (numero && typeof window.enviarWhatsApp === 'function') {
    window.enviarWhatsApp(numero, msg);
    return !file;
  }
  return false;
}

function reemplazarEnviarWhatsAppOrden() {
  if (window.enviarWhatsAppOrden?.__smCoreFinalShare) return;
  const w = async function(id) {
    const o = (state?.ordenes || []).find(x => x.id === id);
    if (!o) return;
    return compartirOrdenConFoto(o);
  };
  w.__smCoreFinalShare = true;
  window.enviarWhatsAppOrden = w;
}

function capturarFotosNuevasPorFila() {
  return Array.from(document.querySelectorAll('#orden-items-list .orden-item-row')).map((row,index) => ({ row,index,itemIdAntes:row.dataset.itemId || '',file:row.__smPendingItemPhoto || null })).filter(x => x.file);
}

async function asegurarFotosItemsNuevos(ordenId, antesIds, capturadas) {
  if (!capturadas.length || !ordenId) return;
  const nuevos = (state?.ordenItems || []).filter(it => it.ordenId === ordenId && !antesIds.has(it.id)).sort((a,b) => Number(a.numeroItem || 0) - Number(b.numeroItem || 0));
  const pendientesNuevos = capturadas.filter(x => !x.itemIdAntes);
  for (let i=0;i<pendientesNuevos.length;i++) {
    const item=nuevos[i]; if(!item) continue;
    try { if (typeof window.agregarFotoItem === 'function') await window.agregarFotoItem(item.id, pendientesNuevos[i].file); }
    catch(e){ console.error('No se pudo asegurar la foto del artículo nuevo:',e); }
  }
}

function modalOrdenAbierto(){return document.getElementById('modal-orden')?.classList.contains('open');}

function envolverSaveOrden() {
  const original=window.saveOrden;
  if(typeof original!=='function'||original.__smCoreFinalSave)return;
  const w=async function(...args){
    const eraNueva=!document.getElementById('orden-id')?.value;
    const capturadas=capturarFotosNuevasPorFila();
    const antesIds=new Set((state?.ordenItems||[]).map(it=>it.id));
    const r=await original.apply(this,args);
    const ordenId=typeof r==='string'?r:document.getElementById('orden-id')?.value;
    if(!ordenId)return r;
    await asegurarFotosItemsNuevos(ordenId,antesIds,capturadas);
    if(modalOrdenAbierto()&&typeof window.openOrdenModal==='function'){
      try{await window.openOrdenModal(ordenId);}catch(e){console.error(e);}
    }
    const o=(state?.ordenes||[]).find(x=>x.id===ordenId);
    if(o) prepararFotoGeneral(o);
    if(eraNueva&&o&&fotoGeneral(o)) showToast('✅ Orden guardada con foto.');
    return r;
  };
  w.__smCoreFinalSave=true;
  window.saveOrden=w;
}

function precargarFotosAlAbrir(){
  ['viewOrdenDetalle','openOrdenModal'].forEach(nombre=>{
    const original=window[nombre];
    if(typeof original!=='function'||original.__smPreloadFotoOrden)return;
    const w=function(id,...rest){return original.call(this,id,...rest);};
    w.__smPreloadFotoOrden=true;window[nombre]=w;
  });
}

function arreglarScrollModal(){
  if(document.getElementById('sm-modal-scroll-final'))return;
  const s=document.createElement('style');s.id='sm-modal-scroll-final';s.textContent=`
    body.modal-open-lock{overflow:hidden!important;position:relative!important;}
    .modal-backdrop.open{overflow:hidden!important;overscroll-behavior:none!important;touch-action:none!important;}
    .modal-backdrop.open>.modal{max-height:calc(100dvh - 28px)!important;overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior:contain!important;touch-action:pan-y!important;margin:auto!important;}
    @supports not (height:100dvh){.modal-backdrop.open>.modal{max-height:calc(100vh - 28px)!important;}}
  `;document.head.appendChild(s);
}

function arreglarIconoBiblioteca(){document.querySelectorAll('#tab-biblioteca button').forEach(btn=>{if(/Ubicar en estantería/i.test(btn.textContent||''))btn.textContent='📦 Ubicar en estantería';});}

function instalar(){instalarNormalizacionWhatsApp();reemplazarEnviarWhatsAppOrden();envolverSaveOrden();precargarFotosAlAbrir();arreglarScrollModal();arreglarIconoBiblioteca();}
