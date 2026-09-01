/* ============================================================
   WHATSAPP CON LÍMITES CONFIGURABLES — Sistema SeS (Fase 2)
   Control de mensajes mensuales para evitar sobrecostos.
   ============================================================ */
import { state, persist } from '../state.js';
import { showToast } from '../ui.js';

const CONTADOR_KEY = 'ses-whatsapp-mensual';

/**
 * Obtiene el contador mensual de mensajes WhatsApp.
 */
function getContador() {
  try {
    const data = JSON.parse(localStorage.getItem(CONTADOR_KEY) || '{}');
    const mesActual = new Date().toISOString().slice(0, 7); // YYYY-MM
    
    if (data.mes !== mesActual) {
      // Nuevo mes: reiniciar contador
      return { mes: mesActual, enviados: 0 };
    }
    
    return data;
  } catch (e) {
    return { mes: new Date().toISOString().slice(0, 7), enviados: 0 };
  }
}

/**
 * Incrementa el contador de mensajes enviados.
 */
function incrementarContador() {
  const contador = getContador();
  contador.enviados++;
  localStorage.setItem(CONTADOR_KEY, JSON.stringify(contador));
  return contador.enviados;
}

/**
 * Verifica si se puede enviar un mensaje WhatsApp.
 * Retorna { permitido: boolean, mensaje: string }
 */
export function verificarLimiteWhatsApp() {
  const limite = Number(state.config?.whatsapp_limite_mensual) || 100; // default 100
  const contador = getContador();
  
  if (contador.enviados >= limite) {
    return {
      permitido: false,
      mensaje: `⚠️ Límite mensual alcanzado (${contador.enviados}/${limite}). Cambia el límite en Configuración o espera al próximo mes.`
    };
  }
  
  const restante = limite - contador.enviados;
  return {
    permitido: true,
    mensaje: `📊 Mensajes WhatsApp este mes: ${contador.enviados}/${limite} (quedan ${restante})`
  };
}

/**
 * Envía un mensaje WhatsApp si el límite lo permite.
 */
export function enviarWhatsApp(numero, mensaje) {
  const check = verificarLimiteWhatsApp();
  
  if (!check.permitido) {
    showToast(check.mensaje);
    return false;
  }
  
  // Abrir WhatsApp
  const url = `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(mensaje)}`;
  window.open(url, '_blank');
  
  // Incrementar contador
  const total = incrementarContador();
  const limite = Number(state.config?.whatsapp_limite_mensual) || 100;
  
  showToast(`Mensaje enviado (${total}/${limite} este mes)`, 'info');
  return true;
}

/**
 * Envía un mensaje WhatsApp CON una foto adjunta, de forma que el texto y
 * la imagen viajen JUNTOS en el mismo mensaje (usa la API nativa de
 * compartir del teléfono para elegir WhatsApp). Respeta el mismo límite
 * mensual que enviarWhatsApp(). Si el dispositivo/navegador no soporta
 * compartir archivos (p. ej. en computadora), se comporta como
 * enviarWhatsApp() —solo texto— y además descarga la foto para adjuntarla
 * a mano, igual que ya hace "Comprobante → Compartir" en Órdenes.
 */
export async function enviarWhatsAppConFoto(numero, mensaje, file) {
  const check = verificarLimiteWhatsApp();
  if (!check.permitido) {
    showToast(check.mensaje);
    return false;
  }

  try {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: mensaje });
    } else {
      if (file) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name || 'foto.jpg';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      }
      const url = `https://wa.me/${numero.replace(/\D/g, '')}?text=${encodeURIComponent(mensaje + (file ? '\n\n(adjunta la foto que se acaba de descargar)' : ''))}`;
      window.open(url, '_blank');
    }
  } catch (e) {
    // El usuario cerró el panel de compartir sin elegir nada: no es un error.
    if (e && e.name === 'AbortError') return false;
    console.error('Error al compartir por WhatsApp:', e);
    showToast('No se pudo compartir por WhatsApp');
    return false;
  }

  const total = incrementarContador();
  const limite = Number(state.config?.whatsapp_limite_mensual) || 100;
  showToast(`Mensaje enviado (${total}/${limite} este mes)`, 'info');
  return true;
}

/**
 * Muestra el panel de control de límites WhatsApp en Configuración.
 */
export function renderWhatsAppLimites() {
  const limite = Number(state.config?.whatsapp_limite_mensual) || 100;
  const contador = getContador();
  const porcentaje = Math.round((contador.enviados / limite) * 100);
  
  const html = `
    <div class="panel">
      <div class="panel-title">Control de WhatsApp</div>
      <div class="hint" style="margin-bottom:12px;">Limita los mensajes mensuales para evitar sobrecostos.</div>
      
      <div class="field">
        <label>Límite mensual de mensajes</label>
        <input type="number" id="cfg-whatsapp-limite" value="${limite}" min="10" max="10000" style="width:120px;">
      </div>
      
      <div style="margin-top:16px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">
          <span>Mensajes enviados este mes (${contador.mes})</span>
          <strong>${contador.enviados} / ${limite}</strong>
        </div>
        <div class="confidence-bar" style="height:8px;">
          <div class="confidence-fill" style="width:${Math.min(porcentaje, 100)}%;background:${porcentaje >= 90 ? 'var(--red)' : (porcentaje >= 70 ? 'var(--amber)' : 'var(--green)')}"></div>
        </div>
        ${porcentaje >= 90 ? '<div class="hint" style="color:var(--red);margin-top:6px;">⚠️ Límite casi alcanzado</div>' : ''}
      </div>
      
      <button class="btn btn-primary" style="margin-top:16px;" onclick="guardarLimiteWhatsApp()">Guardar límite</button>
    </div>
  `;
  
  return html;
}

/**
 * Guarda el límite configurado en state.config y persiste.
 */
export async function guardarLimiteWhatsApp() {
  const valor = Number(document.getElementById('cfg-whatsapp-limite').value) || 100;
  
  if (valor < 10) {
    showToast('El límite mínimo es 10 mensajes');
    return;
  }
  
  state.config.whatsapp_limite_mensual = valor;
  
  try {
    await persist();
    if (window.db && window.db.saveConfig) await window.db.saveConfig(state.config);
    showToast('Límite WhatsApp guardado: ' + valor + ' mensajes/mes');
  } catch (e) {
    console.error(e);
    showToast('Error al guardar el límite');
  }
}

Object.assign(window, { 
  verificarLimiteWhatsApp, 
  enviarWhatsApp, 
  enviarWhatsAppConFoto,
  renderWhatsAppLimites, 
  guardarLimiteWhatsApp 
});
