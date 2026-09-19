/* ============================================================
   CONSULTA UNIFICADA — solo lectura
   Une datos existentes; no crea estados ni duplica información.
   ============================================================ */
import { state } from '../state.js';
import { escHtml, escAttr } from '../sanitize.js';
import { resolveImageUrl } from '../storage-manager.js';

const norm=v=>String(v??'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const fmt=v=>v?String(v).replace('T',' ').slice(0,16):'—';
function clienteDe(o){return (state.clientes||[]).find(c=>c.id===o?.clienteId)||null;}
function itemsDe(o){return (state.ordenItems||[]).filter(x=>x.ordenId===o.id).sort((a,b)=>(+a.numeroItem||0)-(+b.numeroItem||0));}
function registrosDe(it){return (state.registroPares||[]).filter(r=>String(r.codigo||'')===String(it.codigo||'')).sort((a,b)=>String(a.fecha||'').localeCompare(String(b.fecha||'')));}
function tiene(regs,...p){return regs.some(r=>p.some(x=>norm(r.servicio).includes(norm(x))));}
function ubicacion(it){const b=it?.biblioteca;return b&&typeof b==='object'?(b.ubicacion||b.estante||b.posicion||''):'';}
function estadoPago(o){if(norm(o?.estadoPago)==='pagado')return'Pagado';const t=Math.max(0,+o?.precio-(+o?.descuento||0)),p=(+o?.pagado||0)+(+o?.pagadoQR||0)+(+o?.pagadoEfectivo||0);return t>0&&p>=t?'Pagado':'Pendiente';}
function fotosDe(o,regs){
 const out=[]; for(const r of regs){for(const u of (Array.isArray(r.fotoUrls)?r.fotoUrls:[r.fotoUrl]))if(u&&!out.includes(u))out.push(u);}
 const fs=o?.extra?.fotos; if(Array.isArray(fs))for(const f of fs){const u=f?.url||f?.path;if(u&&!out.includes(u))out.push(u);} return out;
}
function coincide(o,it,c,q){const vals=[c?.nombre,c?.telefono,c?.whatsapp,it?.codigo,it?.descripcion,it?.marca,it?.modelo,it?.tipoCalzado,it?.color,it?.material,o?.marca,o?.modelo].map(norm);return norm(q).split(/\s+/).filter(Boolean).every(t=>vals.some(v=>v.includes(t)));}
function resultados(q){
 const raw=String(q||'').trim(), num=/^#?\d+$/.test(raw), cod=/^\d+\s*-\s*\d+$/.test(raw), n=num?+raw.replace('#',''):null, code=cod?raw.replace(/\s+/g,''):null, out=[];
 for(const o of(state.ordenes||[])){const c=clienteDe(o);for(const it of itemsDe(o)){const ok=num?+o.numero===n:cod?String(it.codigo||'')===code:coincide(o,it,c,raw);if(ok)out.push({o,it,c,regs:registrosDe(it)});}} return out;
}
async function pintarFotos(){await Promise.all([...document.querySelectorAll('#consulta-resultados img[data-r2-ref]')].map(async img=>{const u=await resolveImageUrl(img.dataset.r2Ref);if(u)img.src=u;}));}
function alerta(o,it,regs){
 const a=[], hoy=new Date(), est=it.fechaEntregaEstimada||o.fechaEstimada;
 if(est&&!it.entregado&&new Date(est+'T23:59:59')<hoy)a.push('Entrega atrasada');
 if(tiene(regs,'lavado')&&!tiene(regs,'detallado','detalle'))a.push('Pendiente de detallado');
 if(tiene(regs,'detallado','detalle')&&!ubicacion(it)&&!it.entregado)a.push('Listo sin ubicación');
 if(estadoPago(o)!=='Pagado')a.push('Pago pendiente');
 return a;
}
function historial(it,regs){
 const ev=[{t:'Ingreso',f:it.fechaIngreso||'',e:''}];
 for(const r of regs)ev.push({t:r.servicio||'Producción',f:[r.fecha,r.hora].filter(Boolean).join(' '),e:r.empleado||''});
 const ub=ubicacion(it); if(ub)ev.push({t:'Biblioteca '+ub,f:it.biblioteca?.fecha||'',e:''});
 if(it.entregado)ev.push({t:'Entregado',f:it.fechaEntrega||'',e:''}); return ev;
}
function detalleHtml(o,it,c,regs){
 const fotos=fotosDe(o,regs), hist=historial(it,regs), al=alerta(o,it,regs);
 return '<div class="cu-detail" id="cu-detail-'+escAttr(it.id)+'">'+
 '<div class="cu-detail-grid"><div><h4>Artículo</h4><div><b>Marca/modelo:</b> '+escHtml([it.marca,it.modelo].filter(Boolean).join(' ')||'—')+'</div><div><b>Tipo:</b> '+escHtml(it.tipoCalzado||'—')+'</div><div><b>Color:</b> '+escHtml(it.color||'—')+'</div><div><b>Material:</b> '+escHtml(it.material||'—')+'</div><div><b>Estado de ingreso:</b> '+escHtml(it.estadoCalzado||'—')+'</div><div><b>Tratamiento:</b> '+escHtml(it.tratamientoSugerido||'—')+'</div></div>'+
 '<div><h4>Cliente y fechas</h4><div><b>Cliente:</b> '+escHtml(c?.nombre||'—')+'</div><div><b>Teléfono:</b> '+escHtml(c?.whatsapp||c?.telefono||'—')+'</div><div><b>Ingreso:</b> '+escHtml(fmt(it.fechaIngreso||o.fechaIngreso))+'</div><div><b>Entrega estimada:</b> '+escHtml(fmt(it.fechaEntregaEstimada||o.fechaEstimada))+'</div><div><b>Responsable:</b> '+escHtml(it.responsable||o.responsable||'—')+'</div></div></div>'+
 (al.length?'<div class="cu-alerts">'+al.map(x=>'<span>⚠ '+escHtml(x)+'</span>').join('')+'</div>':'')+
 '<h4>Historial del artículo</h4><div class="cu-timeline">'+hist.map(x=>'<div><span></span><b>'+escHtml(x.t)+'</b><small>'+escHtml([x.f,x.e].filter(Boolean).join(' · '))+'</small></div>').join('')+'</div>'+
 '<div class="cu-detail-actions">'+(fotos.length?'<button class="btn btn-ghost btn-sm" onclick="verFotosConsulta(\''+escAttr(it.id)+'\')">📸 Ver '+fotos.length+' foto'+(fotos.length===1?'':'s')+'</button>':'')+
 '<button class="btn btn-ghost btn-sm" onclick="if(window.verOrden)window.verOrden(\''+escAttr(o.id)+'\')">Abrir orden original</button></div>'+
 (fotos.length?'<div class="cu-gallery" id="cu-gallery-'+escAttr(it.id)+'" hidden>'+fotos.map(u=>'<img data-r2-ref="'+escAttr(u)+'" src="" alt="Foto del artículo">').join('')+'</div>':'')+'</div>';
}
export function verDetalleConsulta(id){const e=document.getElementById('cu-detail-'+id);if(e)e.classList.toggle('open');}
export function verFotosConsulta(id){const e=document.getElementById('cu-gallery-'+id);if(e)e.hidden=!e.hidden;pintarFotos().catch(()=>{});}
export function buscarFichaArticulo(){
 const input=document.getElementById('consulta-articulo-q'),cont=document.getElementById('consulta-resultados');if(!input||!cont)return;const q=input.value.trim();
 if(!q){cont.innerHTML='<div class="empty-state">Escribe un número de orden, código, cliente o artículo.</div>';return;}
 const rs=resultados(q);if(!rs.length){cont.innerHTML='<div class="empty-state"><strong>Sin resultados</strong><br>No se encontró información para “'+escHtml(q)+'”.</div>';return;}
 const grupos=new Map();rs.forEach(x=>{if(!grupos.has(x.o.id))grupos.set(x.o.id,{o:x.o,c:x.c,items:[]});grupos.get(x.o.id).items.push(x);});
 cont.innerHTML='<div class="hint" style="margin:0 0 8px">'+grupos.size+' orden'+(grupos.size===1?'':'es')+' encontrada'+(grupos.size===1?'':'s')+'</div>'+[...grupos.values()].map(({o,c,items})=>{
  const pago=estadoPago(o),total=Math.max(0,(+o.precio||0)-(+o.descuento||0)),pag=(+o.pagado||0)+(+o.pagadoQR||0)+(+o.pagadoEfectivo||0);
  const cards=items.map(({it,regs})=>{const lav=tiene(regs,'lavado'),det=tiene(regs,'detallado','detalle'),ub=ubicacion(it),fs=fotosDe(o,regs),estado=it.entregado?'Entregado':(it.estado||o.estado||'Sin estado'),al=alerta(o,it,regs),art=[it.marca,it.modelo,it.descripcion,it.color].filter(Boolean).join(' · ')||'Artículo';
   return '<div class="cu-item"><div class="cu-photo">'+(fs[0]?'<img data-r2-ref="'+escAttr(fs[0])+'" src="" alt="Foto '+escAttr(it.codigo||'')+'">':'👟')+'</div><div><div class="cu-code">'+escHtml(it.codigo||'—')+'</div><div class="cu-desc">'+escHtml(art)+'</div>'+(al.length?'<div class="cu-mini-alert">⚠ '+al.length+' alerta'+(al.length===1?'':'s')+'</div>':'')+'</div>'+
   '<div class="cu-statuses"><div class="cu-status '+(lav?'cu-ok':'')+'"><small>🧼 Lavado</small><strong>'+(lav?'✓ Sí':'Pendiente')+'</strong></div><div class="cu-status '+(det?'cu-ok':'')+'"><small>✨ Detallado</small><strong>'+(det?'✓ Sí':'Pendiente')+'</strong></div><div class="cu-status"><small>📚 Biblioteca</small><strong>'+escHtml(ub||'No ubicado')+'</strong></div><div class="cu-status"><small>📦 Estado actual</small><strong>'+escHtml(estado)+'</strong></div></div>'+
   '<div class="cu-expand"><button class="btn btn-ghost btn-sm" onclick="verDetalleConsulta(\''+escAttr(it.id)+'\')">Ver información completa</button></div>'+detalleHtml(o,it,c,regs)+'</div>';}).join('');
  return '<section class="cu-order"><div class="cu-order-head"><div><div class="cu-kicker">ORDEN #'+escHtml(o.numero)+'</div><div class="cu-client">'+escHtml(c?.nombre||'Cliente sin nombre')+'</div><div class="cu-meta">Ingreso '+escHtml(fmt(o.fechaIngreso))+' · Entrega estimada '+escHtml(fmt(o.fechaEstimada))+'</div><div class="cu-money">Total '+total.toFixed(2)+' · Pagado '+pag.toFixed(2)+' · Saldo '+Math.max(0,total-pag).toFixed(2)+'</div></div><span class="cu-paid '+(pago==='Pagado'?'':'cu-pending')+'">'+(pago==='Pagado'?'✓ ':'')+escHtml(pago)+'</span></div>'+cards+'</section>';
 }).join('');pintarFotos().catch(()=>{});
}
export function limpiarFichaArticulo(){const i=document.getElementById('consulta-articulo-q');if(i)i.value='';const c=document.getElementById('consulta-resultados');if(c)c.innerHTML='<div class="empty-state">Busca una orden o artículo para ver toda su trazabilidad en un solo lugar.</div>';}
export function renderConsultaArticulo(){const i=document.getElementById('consulta-articulo-q');if(i&&i.value.trim())buscarFichaArticulo();}
Object.assign(window,{buscarFichaArticulo,limpiarFichaArticulo,renderConsultaArticulo,verDetalleConsulta,verFotosConsulta});
