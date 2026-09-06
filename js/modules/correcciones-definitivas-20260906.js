import { state, persist } from '../state.js';
import * as db from '../db.js';

if (!window.__smDefinitive0906) {
  window.__smDefinitive0906 = true;
  queueMicrotask(init);
}

function addCSS() {
  if (document.getElementById('sm-definitive-css')) return;
  const s = document.createElement('style');
  s.id = 'sm-definitive-css';
  s.textContent = `
    .sm-pop{display:none!important}
    .sm-def-photo-btn{display:inline-flex!important;align-items:center;justify-content:center;gap:6px}
    .modal-backdrop .modal{box-sizing:border-box;max-width:min(760px,calc(100vw - 24px))!important;overflow-x:hidden!important}
    .modal-backdrop .modal input,.modal-backdrop .modal select,.modal-backdrop .modal textarea{max-width:100%!important;box-sizing:border-box!important}
    #orden-fotos-generales-preview{display:flex!important;flex-wrap:wrap!important;gap:8px!important;position:static!important;margin-top:8px!important}
    #orden-fotos-generales-preview .foto-general-thumb{position:relative!important;flex:0 0 auto!important}
    #orden-fotos-generales-preview img{position:static!important;width:82px!important;height:82px!important;object-fit:cover!important}
    #sm-frange,#sm-prange{gap:12px!important;align-items:end!important;overflow:visible!important}
    #tab-produccion .field,#tab-produccion input,#tab-produccion select,#tab-produccion textarea{min-width:0!important;max-width:100%!important;box-sizing:border-box!important}
    .timeline-list .timeline-item:nth-child(-n+4){display:none!important}
    body.sm-body-locked{overflow:hidden!important;position:fixed!important;width:100%!important;left:0!important;right:0!important}
    @media(max-width:700px){
      #sm-frange,#sm-prange{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:12px!important;width:100%!important;padding-left:12px!important;padding-right:12px!important;box-sizing:border-box!important}
      #sm-frange .field,#sm-prange .field{width:100%!important;min-width:0!important}
      #sm-frange input,#sm-prange input,#sm-prange select{width:100%!important;min-width:0!important;max-width:100%!important;box-sizing:border-box!important}
      #sm-frange button,#sm-prange button{width:auto!important;justify-self:start!important}
      #orden-registro-general>div[style*="display:flex"]{display:grid!important;grid-template-columns:1fr!important;gap:14px!important}
      #orden-registro-general>div[style*="display:flex"]>div{width:100%!important;min-width:0!important;max-width:100%!important}
      #orden-items-list .articulo-row,#orden-items-list .orden-item-row{overflow:hidden!important;box-sizing:border-box!important}
      #orden-items-list .articulo-row-fields{display:grid!important;grid-template-columns:1fr!important;width:100%!important}
    }
  `;
  document.head.appendChild(s);
}

function directNativeButton(container, input, key) {
  if (!container || !input) return;
  input.removeAttribute('capture');
  input.setAttribute('accept', 'image/*');
  container.querySelectorAll('.sm-menu').forEach(x => x.style.display = 'none');
  container.querySelectorAll('button').forEach(b => {
    if (/Tomar foto|Galer[ií]a|Fototeca|Elegir de la galería/i.test(b.textContent || '')) b.style.display = 'none';
  });
  let btn = container.querySelector('[data-sm-def-photo="'+key+'"]');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ghost btn-sm sm-def-photo-btn';
    btn.dataset.smDefPhoto = key;
    btn.textContent = '📷 Agregar foto';
    btn.onclick = e => { e.preventDefault(); e.stopPropagation(); input.click(); };
    container.appendChild(btn);
  }
}

function fixOrdenGeneral() {
  const general = document.getElementById('orden-registro-general');
  if (!general) return;
  const gal = document.getElementById('orden-foto-general-galeria');
  if (gal) {
    const host = gal.parentElement || general;
    directNativeButton(host, gal, 'orden-general');
  }
  document.querySelectorAll('#orden-items-list .orden-item-row').forEach((row, idx) => {
    const input = row.querySelector('label[title="Agregar foto de este artículo"] input[type=file]') || row.querySelector('input[type=file]');
    const label = input?.closest('label');
    row.querySelectorAll('.sm-menu').forEach(x => x.style.display = 'none');
    if (input) input.removeAttribute('capture');
    if (label) {
      label.style.display = 'inline-flex';
      label.style.cursor = 'pointer';
      label.childNodes.forEach(n => { if (n.nodeType === 3 && /Agregar foto/.test(n.textContent || '')) n.textContent = '📷 Agregar foto'; });
    }
  });
}

function fixProduccion() {
  const tab = document.getElementById('tab-produccion');
  if (!tab) return;
  const codigo = document.getElementById('prod-codigo');
  const info = document.getElementById('prod-info-articulo-wrap');
  const servicio = document.getElementById('prod-servicio');
  const blanco = document.getElementById('prod-blanqueamiento');
  const obs = document.getElementById('prod-observacion');
  const cam = document.getElementById('prod-foto-camera');
  const gal = document.getElementById('prod-foto-galeria');

  const codeField = codigo?.closest('.field');
  if (info && codeField && info.previousElementSibling !== codeField) codeField.after(info);

  const blancoField = blanco?.closest('.field');
  const obsField = obs?.closest('.field');
  if (obsField && blancoField && obsField.previousElementSibling !== blancoField) blancoField.after(obsField);

  const photoField = gal?.closest('.field') || cam?.closest('.field') || gal?.parentElement;
  if (photoField && obsField && photoField.previousElementSibling !== obsField) obsField.after(photoField);
  if (photoField && gal) directNativeButton(photoField, gal, 'produccion');

  if (info) info.querySelectorAll('label,button').forEach(el => {
    if (/Agregar foto/i.test(el.textContent || '')) el.style.display = 'none';
  });
}

function fixIA() {
  const empty = document.getElementById('ia-dropzone-empty');
  const gal = document.getElementById('ia-file-input-galeria');
  if (!empty || !gal) return;
  gal.removeAttribute('capture'); gal.setAttribute('accept','image/*');
  empty.querySelectorAll('button,label').forEach(el => {
    if (/Tomar foto|Elegir de la galería/i.test(el.textContent || '')) el.style.display = 'none';
  });
  directNativeButton(empty, gal, 'ia');
}

function fixGaleria() {
  const box = document.getElementById('sm-gbrand');
  const out = document.getElementById('sm-gresults');
  if (!box || !out) return;
  let clear = box.querySelector('.sm-def-clear-gallery');
  if (!clear) {
    clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn-ghost btn-sm sm-def-clear-gallery';
    clear.textContent = 'Limpiar';
    clear.onclick = () => {
      const input = box.querySelector('input');
      if (input) input.value = '';
      out.innerHTML = '';
    };
    const searchBtn = [...box.querySelectorAll('button')].find(b => /^Buscar$/i.test((b.textContent||'').trim()));
    if (searchBtn) searchBtn.after(clear); else box.querySelector('.row')?.appendChild(clear);
  }
}

function fixFinanceRanges() {
  ['sm-frange','sm-prange'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.boxSizing='border-box';
    el.querySelectorAll('input,select').forEach(x => { x.style.minWidth='0'; x.style.maxWidth='100%'; x.style.boxSizing='border-box'; });
  });
}

let lockedY = 0;
function fixModalScroll() {
  const open = document.querySelector('.modal-backdrop.open');
  if (open && !document.body.classList.contains('sm-body-locked')) {
    lockedY = window.scrollY;
    document.body.style.top = '-' + lockedY + 'px';
    document.body.classList.add('sm-body-locked');
  } else if (!open && document.body.classList.contains('sm-body-locked')) {
    document.body.classList.remove('sm-body-locked');
    document.body.style.top = '';
    window.scrollTo(0, lockedY);
  }
}

async function persistAudit(orderId, isNew) {
  const o = (state.ordenes || []).find(x => x.id === orderId);
  if (!o) return;
  const who = state.session?.user || state.session?.nombre || '';
  if (!who) return;
  o.extra = o.extra || {};
  if (isNew && !o.extra.registradoPor) o.extra.registradoPor = who;
  if (!isNew && who !== o.extra.registradoPor) o.extra.editadoPor = who;
  if (o.extra.editadoPor === o.extra.registradoPor) delete o.extra.editadoPor;
  await persist();
  await db.saveOrden(o);
}

function renderAuditOnTickets() {
  document.querySelectorAll('#ordenes-grid .ticket').forEach(ticket => {
    if (ticket.querySelector('.sm-order-audit')) return;
    const m = (ticket.textContent || '').match(/#\s*(\d+)/);
    if (!m) return;
    const o = (state.ordenes || []).find(x => String(x.numero) === m[1]);
    const reg = o?.extra?.registradoPor;
    if (!reg) return;
    const d = document.createElement('div');
    d.className = 'sm-order-audit';
    d.style.cssText = 'border-top:1px dashed var(--line);margin-top:10px;padding-top:8px;font-size:12px;line-height:1.5;color:var(--ink-soft)';
    d.innerHTML = 'Registrado por: <strong>' + reg + '</strong>' + (o.extra?.editadoPor && o.extra.editadoPor !== reg ? '<br>Editado por: <strong>' + o.extra.editadoPor + '</strong>' : '');
    ticket.querySelector('.ticket-body')?.appendChild(d);
  });
}

function applyAll() {
  addCSS();
  fixOrdenGeneral();
  fixProduccion();
  fixIA();
  fixGaleria();
  fixFinanceRanges();
  fixModalScroll();
  renderAuditOnTickets();
}

function wrap(name) {
  const f = window[name];
  if (typeof f !== 'function' || f.__smDefWrapped) return;
  const w = function(...args) {
    const r = f.apply(this,args);
    if (r && typeof r.then === 'function') return r.then(v => { requestAnimationFrame(applyAll); return v; });
    requestAnimationFrame(applyAll); return r;
  };
  w.__smDefWrapped = true;
  window[name] = w;
}

function init() {
  ['openOrdenModal','agregarFilaItemOrden','renderProduccion','renderGaleria','renderIA','viewOrdenDetalle','renderOrdenes','switchTab'].forEach(wrap);
  const save = window.saveOrden;
  if (typeof save === 'function' && !save.__smDefAudit) {
    const w = async function(...args) {
      const isNew = !document.getElementById('orden-id')?.value;
      const id = await save.apply(this,args);
      if (id) await persistAudit(id,isNew);
      requestAnimationFrame(applyAll);
      return id;
    };
    w.__smDefAudit = true;
    window.saveOrden = w;
  }

  let raf = 0;
  const obs = new MutationObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; applyAll(); });
  });
  obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style']});
  document.addEventListener('change', () => requestAnimationFrame(applyAll), true);
  applyAll();
}
