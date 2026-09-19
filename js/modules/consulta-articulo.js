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
  const input=document.getElementById('consulta-articulo-q'), cont=document.getElementById('consulta-resultados');
  if(!input||!cont)return;
  const q=input.value.trim();
  if(!q){cont.innerHTML='<div class="empty-state">Escribe un número de orden, código, cliente o artículo.</div>';return;}
  const rs=resultados(q);
  if(!rs.length){cont.innerHTML='<div class="empty-state"><strong>Sin resultados</strong><br>No se encontró información para “'+escHtml(q)+'”.</div>';return;}

  const grupos=new Map();
  rs.forEach(x=>{if(!grupos.has(x.o.id))grupos.set(x.o.id,{o:x.o,c:x.c,items:[]});grupos.get(x.o.id).items.push(x);});
  cont.innerHTML='<div class="hint" style="margin:0 0 8px">'+grupos.size+' orden'+(grupos.size===1?'':'es')+' encontrada'+(grupos.size===1?'':'s')+'</div>'+
  [...grupos.values()].map(({o,c,items})=>{
    const pago=estadoPago(o), total=Math.max(0,Number(o.precio||0)-Number(o.descuento||0));
    const pagado=Number(o.pagado||0)+Number(o.pagadoQR||0)+Number(o.pagadoEfectivo||0), saldo=Math.max(0,total-pagado);
    const cards=items.map(({it,regs})=>{
      const lavado=etapa(regs,['lavado','lavar']), detallado=etapa(regs,['detallado','detalle']);
      const ub=ubicacion(it), foto=fotoCandidata(o,it,regs), estado=it.entregado?'Entregado':(it.estado||o.estado||'Sin estado');
      const articulo=[it.marca,it.modelo,it.descripcion,it.color,it.talla?('Talla '+it.talla):''].filter(Boolean).join(' · ')||'Artículo';
      return '<div class="cu-item">'+
        '<div class="cu-photo">'+(foto?'<img data-r2-ref="'+escAttr(foto)+'" src="" alt="Foto '+escAttr(it.codigo||'')+'">':'<span style="font-size:30px">👟</span>')+'</div>'+
        '<div><div class="cu-code">'+escHtml(it.codigo||'—')+'</div><div class="cu-desc">'+escHtml(articulo)+'</div></div>'+
        '<div class="cu-statuses">'+
          '<div class="cu-status '+(lavado?'cu-ok':'')+'"><small>🧼 Lavado</small><strong>'+(lavado?'✓ Sí':'Pendiente')+'</strong></div>'+
          '<div class="cu-status '+(detallado?'cu-ok':'')+'"><small>✨ Detallado</small><strong>'+(detallado?'✓ Sí':'Pendiente')+'</strong></div>'+
          '<div class="cu-status"><small>📚 Biblioteca</small><strong>'+escHtml(ub||'No ubicado')+'</strong></div>'+
          '<div class="cu-status"><small>📦 Estado actual</small><strong>'+escHtml(estado)+'</strong></div>'+
        '</div></div>';
    }).join('');
    return '<section class="cu-order"><div class="cu-order-head"><div>'+
      '<div class="cu-kicker">ORDEN #'+escHtml(o.numero)+'</div><div class="cu-client">'+escHtml(c?.nombre||'Cliente sin nombre')+'</div>'+
      '<div class="cu-meta">Ingreso '+escHtml(o.fechaIngreso||'—')+' · Entrega estimada '+escHtml(o.fechaEstimada||'—')+'</div>'+
      '<div class="cu-money" style="margin-top:8px">Total '+escHtml(total.toFixed(2))+' · Pagado '+escHtml(pagado.toFixed(2))+' · Saldo '+escHtml(saldo.toFixed(2))+'</div>'+
      '</div><span class="cu-paid '+(pago==='Pagado'?'':'cu-pending')+'">'+(pago==='Pagado'?'✓ ':'')+escHtml(pago)+'</span></div>'+cards+'</section>';
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
