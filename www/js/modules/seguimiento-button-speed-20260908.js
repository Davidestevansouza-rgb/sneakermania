/* Seguimiento: feedback táctil inmediato y protección contra doble toque. */
function activarFeedback(btn) {
  if (!btn || btn.dataset.smBusy === '1') return false;
  btn.dataset.smBusy = '1';
  btn.dataset.smOriginalText = btn.textContent || '';
  btn.style.touchAction = 'manipulation';
  btn.style.opacity = '0.72';
  btn.style.pointerEvents = 'none';
  if (/Marcar completado/i.test(btn.dataset.smOriginalText)) btn.textContent = 'Actualizando…';
  else if (/Abrir control de calidad/i.test(btn.dataset.smOriginalText)) btn.textContent = 'Abriendo…';
  requestAnimationFrame(() => requestAnimationFrame(() => {}));
  setTimeout(() => {
    if (!document.body.contains(btn)) return;
    btn.dataset.smBusy = '0';
    btn.style.opacity = '';
    btn.style.pointerEvents = '';
    if (btn.dataset.smOriginalText) btn.textContent = btn.dataset.smOriginalText;
  }, 8000);
  return true;
}

document.addEventListener('pointerdown', ev => {
  const btn = ev.target && ev.target.closest ? ev.target.closest('.timeline-action button') : null;
  if (!btn) return;
  btn.style.transform = 'scale(.985)';
}, { passive: true, capture: true });

document.addEventListener('pointerup', ev => {
  const btn = ev.target && ev.target.closest ? ev.target.closest('.timeline-action button') : null;
  if (!btn) return;
  btn.style.transform = '';
}, { passive: true, capture: true });

document.addEventListener('click', ev => {
  const btn = ev.target && ev.target.closest ? ev.target.closest('.timeline-action button') : null;
  if (!btn) return;
  activarFeedback(btn);
}, true);

const style = document.createElement('style');
style.textContent = '.timeline-action button{touch-action:manipulation;-webkit-tap-highlight-color:transparent;}';
document.head.appendChild(style);
