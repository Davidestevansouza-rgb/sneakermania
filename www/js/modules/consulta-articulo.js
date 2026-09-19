/* ============================================================
   CONSULTA INTEGRAL DE ARTÍCULO
   Vista de solo lectura: une Orden + Artículo + Producción +
   Pago + Biblioteca + Foto sin duplicar ni modificar datos.
   ============================================================ */
import { state } from '../state.js';
import { escHtml, escAttr } from '../sanitize.js';
import { resolveImageUrl } from '../storage-manager.js';

function norm(v){ return String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function clienteDe(o){ return (state.clientes || []).find(c => c.id === o?.clienteId) || null; }
function itemsDe(o){ return (state.ordenItems || []).filter(it => it.ordenId === o.id).sort((a,b)=>(Number(a.numeroItem)||0)-(Number(b.numeroItem)||0)); }
function registrosDe(it){ return (state.registroPares || []).filter(r => String(r.codigo || '') === String(it.codigo || '')).sort((a,b)=>String(a.fecha||'').localeCompare(String(b.fecha||''))); }

function etapa(regs, palabras){
  const ps=palabras.map(norm);
  return regs.some(r => ps.some(p => norm(r.servicio).includes(p)));
}
function ubicacion(it){
  const b=it?.biblioteca;
  if(!b || typeof b!=='object') return '';
  return b.ubicacion || b.estante || b.posicion || '';
}
function estadoPago(o){
  if(norm(o?.estadoPago)==='pagado') return 'Pagado';
  const total=Math.max(0,Number(o?.precio||0)-Number(o?.descuento||0));
  const pagado=Number(o?.pagado||0)+Number(o?.pagadoQR||0)+Number(o?.pagadoEfectivo||0);
  return total>0 && pagado>=total ? 'Pagado' : 'Pendiente';
}
function fotoCandidata(o,it,regs){
  for(let i=regs.length-1;i>=0;i--){
    const urls=Array.isArray(regs[i].fotoUrls)?regs[i].fotoUrls:[regs[i].fotoUrl].filter(Boolean);
    if(urls.length) return urls[0];
  }
  const fotos=o?.extra?.fotos;
  if(Array.isArray(fotos) && fotos.length) return fotos[0]?.url || fotos[0]?.path || '';
  return '';
}
function coincideTexto(o,it,c,q){
  const hay=[c?.nombre,it?.codigo,it?.descripcion,it?.marca,it?.modelo,it?.tipoCalzado,it?.color,it?.material,it?.talla,o?.marca,o?.modelo,o?.talla]
    .map(norm).filter(Boolean);
  const tokens=norm(q).split(/\s+/).filter(Boolean);
  return tokens.every(t=>hay.some(v=>v.includes(t)));
}

function resultados(q){
  const raw=String(q||'').trim();
  if(!raw) return [];
  const ordenExacta=/^#?\d+$/.test(raw);
  const codigoExacto=/^\d+\s*-\s*\d+$/.test(raw);
  const n=ordenExacta?Number(raw.replace('#','')):null;
  const code=codigoExacto?raw.replace(/\s+/g,''):null;
  const out=[];
  for(const o of (state.ordenes||[])){
    const c=clienteDe(o);
    for(const it of itemsDe(o)){
      let ok=false;
      if(ordenExacta) ok=Number(o.numero)===n; // 70 nunca coincide con 170/270/370
      else if(codigoExacto) ok=String(it.codigo||'')===code;
      else ok=coincideTexto(o,it,c,raw);
      if(ok) out.push({o,it,c,regs:registrosDe(it)});
    }
  }
  return out;
}

function chip(ok,si,no){return '<span class="badge '+(ok?'badge-success':'')+'" style="margin-right:6px">'+(ok?'✓ '+si:'— '+no)+'</span>';}

async function pintarFotos(){
  const imgs=[...document.querySelectorAll('#consulta-resultados img[data-r2-ref]')];
  await Promise.all(imgs.map(async img=>{
    const ref=img.dataset.r2Ref;
    if(!ref)return;
    const url=await resolveImageUrl(ref);
    if(url) img.src=url;
  }));
}

export function buscarFichaArticulo(){
  const input=document.getElementById('consulta-articulo-q');
  const cont=document.getElementById('consulta-resultados');
  if(!input||!cont)return;
  const q=input.value.trim();
  if(!q){cont.innerHTML='<div class="empty-state">Escribe un número de orden, código, cliente o artículo.</div>';return;}
  const rs=resultados(q);
  if(!rs.length){cont.innerHTML='<div class="empty-state"><strong>Sin resultados</strong><br>No se encontró información para “'+escHtml(q)+'”.</div>';return;}

  const grupos=new Map();
  rs.forEach(x=>{ const k=x.o.id; if(!grupos.has(k)) grupos.set(k,{o:x.o,c:x.c,items:[]}); grupos.get(k).items.push(x); });
  cont.innerHTML='<div class="hint" style="margin:0 0 10px">'+grupos.size+' orden'+(grupos.size===1?'':'es')+' encontrada'+(grupos.size===1?'':'s')+'</div>'+
  [...grupos.values()].map(({o,c,items})=>{
    const pago=estadoPago(o);
    const total=Math.max(0,Number(o.precio||0)-Number(o.descuento||0));
    const pagado=Number(o.pagado||0)+Number(o.pagadoQR||0)+Number(o.pagadoEfectivo||0);
    const fechaIn=o.fechaIngreso||'—', fechaEst=o.fechaEstimada||'—';
    const cards=items.map(({it,regs})=>{
      const lavado=etapa(regs,['lavado','lavar']), detallado=etapa(regs,['detallado','detalle']);
      const ub=ubicacion(it), foto=fotoCandidata(o,it,regs), estado=it.entregado?'Entregado':(it.estado||o.estado||'Sin estado');
      const articulo=[it.marca,it.modelo,it.descripcion,it.color,it.talla?('Talla '+it.talla):''].filter(Boolean).join(' · ')||it.codigo||'Artículo';
      return '<div style="display:grid;grid-template-columns:96px minmax(160px,1fr) minmax(320px,2fr);gap:14px;align-items:center;padding:14px 0;border-top:1px solid var(--line)">'+
        '<div style="width:96px;height:96px;border-radius:14px;overflow:hidden;background:var(--surface-2,#f3f4f6);display:flex;align-items:center;justify-content:center">'+
        (foto?'<img data-r2-ref="'+escAttr(foto)+'" src="" alt="Foto '+escAttr(it.codigo||'')+'" style="width:100%;height:100%;object-fit:cover">':'<span style="font-size:34px">👟</span>')+'</div>'+
        '<div><strong style="font-size:16px">'+escHtml(it.codigo||'—')+'</strong><div style="margin-top:4px">'+escHtml(articulo)+'</div><div class="hint" style="margin-top:5px">'+regs.length+' registros de producción</div></div>'+
        '<div style="display:grid;grid-template-columns:repeat(4,minmax(92px,1fr));gap:8px">'+
          '<div class="card" style="padding:10px"><div class="hint">🧼 Lavado</div><strong>'+(lavado?'✓ Sí':'Pendiente')+'</strong></div>'+
          '<div class="card" style="padding:10px"><div class="hint">✨ Detallado</div><strong>'+(detallado?'✓ Sí':'Pendiente')+'</strong></div>'+
          '<div class="card" style="padding:10px"><div class="hint">📚 Biblioteca</div><strong>'+escHtml(ub||'No ubicado')+'</strong></div>'+
          '<div class="card" style="padding:10px"><div class="hint">📦 Estado actual</div><strong>'+escHtml(estado)+'</strong></div>'+
        '</div></div>';
    }).join('');
    return '<section class="card" style="padding:18px;margin-bottom:16px;border-radius:16px">'+
      '<div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap">'+
        '<div><div class="hint" style="font-weight:700">ORDEN #'+escHtml(o.numero)+'</div><h2 style="margin:4px 0">'+escHtml(c?.nombre||'Cliente sin nombre')+'</h2>'+
        '<div class="hint">Ingreso '+escHtml(fechaIn)+' · Entrega estimada '+escHtml(fechaEst)+'</div></div>'+
        '<div style="text-align:right"><span class="badge '+(pago==='Pagado'?'badge-success':'')+'">'+(pago==='Pagado'?'✓ ':'')+escHtml(pago)+'</span>'+
        '<div class="hint" style="margin-top:8px">Total '+escHtml(total.toFixed(2))+' · Pagado '+escHtml(pagado.toFixed(2))+' · Saldo '+escHtml(Math.max(0,total-pagado).toFixed(2))+'</div></div>'+
      '</div>'+cards+'</section>';
  }).join('');
  pintarFotos().catch(()=>{});
}

export function limpiarFichaArticulo(){
  const input=document.getElementById('consulta-articulo-q');
  if(input) input.value='';
  const cont=document.getElementById('consulta-resultados');
  if(cont) cont.innerHTML='<div class="empty-state">Busca una orden o artículo para ver toda su trazabilidad en un solo lugar.</div>';
}

export function renderConsultaArticulo(){
  const input=document.getElementById('consulta-articulo-q');
  if(input && input.value.trim()) buscarFichaArticulo();
}

Object.assign(window,{buscarFichaArticulo,limpiarFichaArticulo,renderConsultaArticulo});
