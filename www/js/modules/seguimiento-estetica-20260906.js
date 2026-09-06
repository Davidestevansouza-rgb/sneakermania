if (!document.getElementById('sm-seguimiento-estetica-0906')) {
  const s = document.createElement('style');
  s.id = 'sm-seguimiento-estetica-0906';
  s.textContent = `
    #orden-detalle-content .sm-supervision-step,
    #orden-detalle-content .timeline-list .timeline-item {
      border:1px solid var(--line);
      border-radius:10px;
      padding:12px 14px;
      margin:0 0 10px 0;
      background:var(--paper-raised,#fff);
      box-shadow:none;
    }
    #orden-detalle-content .sm-supervision-step {
      display:block !important;
    }
    #orden-detalle-content .timeline-list {
      margin:0;
      padding:0;
    }
    #orden-detalle-content .timeline-list .timeline-item::before {
      display:none !important;
      content:none !important;
    }
    #orden-detalle-content .sm-supervision-step .timeline-dot,
    #orden-detalle-content .timeline-list .timeline-dot {
      display:none !important;
    }
    #orden-detalle-content .sm-supervision-step > div:last-child,
    #orden-detalle-content .timeline-list .timeline-item > div:last-child {
      width:100%;
      display:grid;
      grid-template-columns:minmax(0,1fr) auto;
      align-items:center;
      gap:10px;
    }
    #orden-detalle-content .timeline-label {
      font-weight:800;
      line-height:1.25;
      margin:0;
    }
    #orden-detalle-content .timeline-action {
      margin:0 !important;
    }
    #orden-detalle-content .timeline-action .btn {
      margin:0;
      white-space:nowrap;
    }
    @media(max-width:520px){
      #orden-detalle-content .sm-supervision-step > div:last-child,
      #orden-detalle-content .timeline-list .timeline-item > div:last-child {
        grid-template-columns:1fr;
      }
      #orden-detalle-content .timeline-action .btn {
        width:100%;
        justify-content:center;
      }
    }
  `;
  document.head.appendChild(s);
}
