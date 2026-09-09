/* ============================================================
   FOTOS DE ARTÍCULOS EN NUEVA/EDITAR ORDEN
   - La selección queda pendiente hasta Guardar orden.
   - Se preservan TODAS las fotos previas (array y formato legacy).
   - Solo se retira de pendientes una foto que realmente subió a R2.
   - Cubre saveOrden y el botón real saveOrdenYMantener.
   ============================================================ */
import { state, persist } from '../state.js';
import * as db from '../db.js';
import * as storageManager from '../storage-manager.js';
import { showToast } from '../ui.js';

const PENDING_KEY = '__smDeferredOrderItemPhotos';
function filaDeInput(input) { return input && input.closest ? input.closest('#orden-items-list .orden-item-row') : null; }
function mostrarPendientes(row) {
  if (!row) return;
  const files = Array.isArray(row[PENDING_KEY]) ? row[PENDING_KEY] : [];
  let box = row.querySelector('.sm-deferred-photo-preview');
  if (!box) { box = document.createElement('div'); box.className = 'sm-deferred-photo-preview'; box.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-top:7px;'; row.appendChild(box); }
  box.innerHTML = '';
  files.forEach((file, idx) => {
    const wrap = document.createElement('div'); wrap.style.cssText = 'position:relative;display:inline-block;';
    const img = document.createElement('img'); img.src = URL.createObjectURL(file); img.alt = 'Foto pendiente'; img.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:7px;border:1px solid var(--line);'; img.onload = () => { try { URL.revokeObjectURL(img.src); } catch (_) {} };
    const del = document.createElement('button'); del.type = 'button'; del.textContent = '×'; del.title = 'Quitar esta foto pendiente'; del.style.cssText = 'position:absolute;right:-5px;top:-7px;border:0;border-radius:50%;width:20px;height:20px;cursor:pointer;';
    del.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); const arr = Array.isArray(row[PENDING_KEY]) ? row[PENDING_KEY] : []; arr.splice(idx,1); row[PENDING_KEY] = arr; mostrarPendientes(row); };
    wrap.append(img,del); box.appendChild(wrap);
  });
  if (files.length) { const txt = document.createElement('span'); txt.className='hint'; txt.textContent = files.length + (files.length===1 ? ' foto lista para guardar' : ' fotos listas para guardar'); box.appendChild(txt); }
}
document.addEventListener('change', ev => {
  const input=ev.target; if (!(input instanceof HTMLInputElement) || input.type!=='file') return;
  const row=filaDeInput(input); if(!row) return;
  const files=Array.from(input.files||[]).filter(f=>f&&((f.type||'').startsWith('image/')||/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name||''))); if(!files.length)return;
  ev.preventDefault(); ev.stopPropagation(); if(typeof ev.stopImmediatePropagation==='function')ev.stopImmediatePropagation();
  const actuales=Array.isArray(row[PENDING_KEY])?row[PENDING_KEY]:[]; row[PENDING_KEY]=actuales.concat(files); mostrarPendientes(row); input.value='';
  showToast(files.length===1?'Foto lista. Se guardará al pulsar Guardar orden.':files.length+' fotos listas. Se guardarán al pulsar Guardar orden.');
},true);
function snapshotPendientes(){return Array.from(document.querySelectorAll('#orden-items-list .orden-item-row')).map((row,index)=>({row,index,itemId:row.dataset.itemId||'',files:Array.isArray(row[PENDING_KEY])?row[PENDING_KEY].slice():[]})).filter(x=>x.files.length);}
function agregarFotosLegacy(destino,origen){
  if(!origen)return;
  if(Array.isArray(origen)){origen.forEach(f=>{if(f)destino.push(typeof f==='string'?{url:f}:f);});return;}
  if(typeof origen==='object')Object.entries(origen).forEach(([categoria,lista])=>{if(!Array.isArray(lista))return;lista.forEach(f=>{if(f)destino.push(typeof f==='string'?{url:f,categoria}:{...f,categoria:f.categoria||categoria});});});
}
function asegurarFotosSinPerdida(orden){
  const reunidas=[]; agregarFotosLegacy(reunidas,orden?.extra?.fotos); agregarFotosLegacy(reunidas,orden?.fotos);
  const vistas=new Set(); const unicas=reunidas.filter(f=>{const k=f.path||f.url||JSON.stringify(f);if(vistas.has(k))return false;vistas.add(k);return true;});
  orden.extra=orden.extra||{}; orden.extra.fotos=unicas; return orden.extra.fotos;
}
async function guardarFotosPendientes(ordenId,pendientes){
  const orden=(state.ordenes||[]).find(o=>o.id===ordenId); if(!orden||!pendientes.length)return 0;
  const items=(state.ordenItems||[]).filter(it=>it.ordenId===ordenId).sort((a,b)=>(a.numeroItem||0)-(b.numeroItem||0)); const fotosOrden=asegurarFotosSinPerdida(orden); let agregadas=0;
  for(const p of pendientes){const item=p.itemId?items.find(it=>it.id===p.itemId):items[p.index];if(!item)continue;for(const file of p.files){try{const foto=await storageManager.uploadFoto(file,orden.id,'item_inicial');foto.item=item.codigo;foto.itemId=item.id;foto.categoria='item_inicial';fotosOrden.push(foto);agregadas++;if(p.row&&Array.isArray(p.row[PENDING_KEY])){p.row[PENDING_KEY]=p.row[PENDING_KEY].filter(x=>x!==file);mostrarPendientes(p.row);}}catch(e){console.error('No se pudo subir foto pendiente del artículo '+(item.codigo||''),e);}}}
  if(agregadas){await persist();const res=await db.saveOrden(orden);if(res&&res.error&&!res.queued)throw res.error;} return agregadas;
}
async function procesarDespuesDeGuardar(pendientes,idAntes,idsAntes,resultado){
  if(!pendientes.length)return;let ordenId=idAntes||document.getElementById('orden-id')?.value||'';if(!ordenId){const nueva=(state.ordenes||[]).find(o=>!idsAntes.has(o.id));ordenId=nueva?nueva.id:(typeof resultado==='string'?resultado:'');}if(!ordenId)return;
  try{const n=await guardarFotosPendientes(ordenId,pendientes);if(n)showToast('✅ Orden y fotos guardadas');}catch(e){console.error('Error guardando fotos pendientes de artículos:',e);showToast('La orden se guardó, pero alguna foto sigue pendiente. Intenta guardar nuevamente.');}
}
function envolverGuardado(nombre,marca,intento=0){
  const original=window[nombre];if(typeof original!=='function'){if(intento<40)setTimeout(()=>envolverGuardado(nombre,marca,intento+1),50);return;}if(original[marca])return;
  const wrapper=async function(...args){const pendientes=snapshotPendientes();const idAntes=document.getElementById('orden-id')?.value||'';const idsAntes=new Set((state.ordenes||[]).map(o=>o.id));const resultado=await original.apply(this,args);await procesarDespuesDeGuardar(pendientes,idAntes,idsAntes,resultado);return resultado;};wrapper[marca]=true;window[nombre]=wrapper;
}
function instalar(){envolverGuardado('saveOrden','__smDeferredItemPhotos');envolverGuardado('saveOrdenYMantener','__smDeferredItemPhotosKeepOpen');}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',instalar,{once:true});else instalar();
