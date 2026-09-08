/* Hotfix fotos R2 2026-09-08 — rama de prueba */
import * as storageManager from './storage-manager.js';
import { state } from './state.js';

(function installFotoHotfix() {
  if (window.__smFotoHotfixInstalled) return;
  const PIXEL_TRANSPARENTE='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const resolviendo=new WeakSet();
  function normalizarFotosOrden(o){
    if(!o||typeof o!=='object')return;
    if(!o.extra||typeof o.extra!=='object'||Array.isArray(o.extra))o.extra={};
    const actuales=Array.isArray(o.extra.fotos)?o.extra.fotos:[];
    const anidadas=o.extra.extra&&Array.isArray(o.extra.extra.fotos)?o.extra.extra.fotos:[];
    const directas=Array.isArray(o.fotos)?o.fotos:[];
    const unicas=[],seen=new Set();
    for(const f of [...actuales,...anidadas,...directas]){if(!f||typeof f!=='object')continue;const key=f.path||f.url||JSON.stringify(f);if(seen.has(key))continue;seen.add(key);unicas.push(f);}
    o.extra.fotos=unicas;
  }
  function normalizarTodas(){for(const o of state.ordenes||[])normalizarFotosOrden(o);}
  async function resolverImagenR2(img){
    if(!img||resolviendo.has(img))return;const actual=img.getAttribute('src')||'';const original=actual.startsWith('r2://')?actual:(img.dataset.smR2Src||'');if(!original||!original.startsWith('r2://'))return;
    resolviendo.add(img);img.dataset.smR2Src=original;if(actual.startsWith('r2://'))img.setAttribute('src',PIXEL_TRANSPARENTE);
    try{const signed=await storageManager.resolveImageUrl(original);if(signed&&!signed.startsWith('r2://')){img.setAttribute('src',signed);img.removeAttribute('data-sm-r2-src');}}catch(e){console.warn('Hotfix fotos: error resolviendo R2',e);}finally{resolviendo.delete(img);}
  }
  function resolverR2En(root){normalizarTodas();if(!root)return;if(root.matches&&root.matches('img[src^="r2://"]'))resolverImagenR2(root);const imgs=root.querySelectorAll?root.querySelectorAll('img[src^="r2://"], img[data-sm-r2-src]'):[];imgs.forEach(resolverImagenR2);}
  function modalOrdenVisible(){const modal=document.getElementById('modal-orden');if(!modal)return false;const cs=getComputedStyle(modal);return modal.classList.contains('open')||modal.classList.contains('active')||modal.getAttribute('aria-hidden')==='false'||(cs.display!=='none'&&cs.visibility!=='hidden');}
  async function refrescarModalOrden(id){if(!id||!modalOrdenVisible()||typeof window.openOrdenModal!=='function')return;normalizarTodas();const modal=document.getElementById('modal-orden');const scrollEl=modal?.querySelector('.modal-content');const scrollTop=scrollEl?scrollEl.scrollTop:0;try{await window.openOrdenModal(id);resolverR2En(modal||document);if(storageManager.secureImageUrlsInDom)await storageManager.secureImageUrlsInDom(modal||document);requestAnimationFrame(()=>{const c=document.querySelector('#modal-orden .modal-content');if(c)c.scrollTop=scrollTop;});}catch(e){console.warn('Hotfix fotos: no se pudo refrescar modal',e);}}
  const observer=new MutationObserver(mutations=>{normalizarTodas();for(const m of mutations){if(m.type==='attributes'&&m.target?.tagName==='IMG')resolverImagenR2(m.target);for(const node of m.addedNodes||[])if(node&&node.nodeType===1)resolverR2En(node);}});
  const iniciarObserver=()=>{normalizarTodas();resolverR2En(document);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});const timerNorm=setInterval(normalizarTodas,500);setTimeout(()=>clearInterval(timerNorm),15000);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciarObserver,{once:true});else iniciarObserver();
  const tryInstall=()=>{if(window.__smFotoHotfixInstalled)return true;if(typeof window.saveOrden!=='function'||typeof window.openOrdenModal!=='function')return false;const originalSaveOrden=window.saveOrden;window.saveOrden=async function(...args){normalizarTodas();const result=await originalSaveOrden.apply(this,args);normalizarTodas();if(result&&modalOrdenVisible())await refrescarModalOrden(result);else resolverR2En(document);return result;};if(typeof window.saveOrdenYMantener==='function'&&!window.saveOrdenYMantener.__smFotoKeepOpenV2){const original=window.saveOrdenYMantener;const wrapped=async function(...args){normalizarTodas();const result=await original.apply(this,args);normalizarTodas();const id=document.getElementById('orden-id')?.value||'';if(id&&modalOrdenVisible())await refrescarModalOrden(id);return result;};wrapped.__smFotoKeepOpenV2=true;window.saveOrdenYMantener=wrapped;}window.__smFotoHotfixInstalled=true;return true;};
  if(!tryInstall()){const timer=setInterval(()=>{normalizarTodas();if(tryInstall())clearInterval(timer);},100);setTimeout(()=>clearInterval(timer),15000);}
  window.addEventListener('online',()=>resolverR2En(document));
})();
