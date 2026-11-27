/* Panel de prospectos — cliente. Sin dependencias. Todo el texto entra con
   textContent (nunca innerHTML con datos). Polling cada 12 s que se pausa
   cuando la pestaña no está visible. */
(function () {
  'use strict';
  const POLL_MS = 12000;
  const page = document.body.dataset.page;
  const $ = (id) => document.getElementById(id);
  const TZ = 'America/Mexico_City';
  const fmtDate = (d) => (d ? new Intl.DateTimeFormat('es-MX', { timeZone: TZ, day: '2-digit', month: 'short' }).format(new Date(d)) : '');
  const fmtTime = (d) => (d ? new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d)) : '');
  const fmtDT = (d) => (d ? `${fmtDate(d)} ${fmtTime(d)}` : '—');
  function ago(d) {
    if (!d) return '—';
    const s = Math.max(0, Math.round((Date.now() - new Date(d)) / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60); if (m < 60) return `${m} min`;
    const h = Math.round(m / 60); if (h < 48) return `${h} h`;
    return `${Math.round(h / 24)} d`;
  }
  const dur = (sec) => (sec == null ? '—' : sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`);

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return n;
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(opts.etag ? { 'If-None-Match': opts.etag } : {}) }, ...opts });
    if (res.status === 401) { location.href = '/panel/login'; throw new Error('sesión'); }
    if (res.status === 403 && page !== 'password') { location.href = '/panel/password'; throw new Error('contraseña'); }
    if (res.status === 304) return { notModified: true };
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Error'), { status: res.status, data });
    return { data, etag: res.headers.get('ETag') };
  }
  const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body || {}) });

  // ── Barra: en vivo + salir ─────────────────────────────────────────────
  let lastOk = null; let lastFail = false;
  function tickLive() {
    const n = $('live'); if (!n) return;
    n.textContent = lastFail ? 'Sin conexión: reintentando…' : lastOk ? `● En vivo · hace ${ago(lastOk)}` : 'Conectando…';
    n.classList.toggle('bad', lastFail);
  }
  setInterval(tickLive, 1000);
  const logout = $('logout');
  if (logout) logout.addEventListener('click', async () => { try { await post('/panel/logout'); } catch (e) { /* igual */ } location.href = '/panel/login'; });

  function poller(fn) {
    let timer = null;
    const run = async () => {
      try { await fn(); lastOk = new Date(); lastFail = false; } catch (e) { if (e.message !== 'sesión') lastFail = true; }
      tickLive();
    };
    const schedule = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) run(); }, POLL_MS); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
    run(); schedule();
    return run;
  }

  // ── Login y contraseña ─────────────────────────────────────────────────
  function bindForm(formId, url, errId, fields) {
    const form = $(formId); if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = $(errId); err.hidden = true;
      const body = Object.fromEntries(fields.map((f) => [f, $(f).value]));
      try {
        const { data } = await post(url, body);
        location.href = data.next || '/panel';
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
  }
  if (page === 'login') bindForm('login-form', '/panel/login', 'login-error', ['email', 'password']);
  if (page === 'password') bindForm('password-form', '/panel/password', 'password-error', ['current', 'next']);

  // ── Inicio ─────────────────────────────────────────────────────────────
  if (page === 'home') {
    let range = 'hoy'; let summary = null; let sumEtag = null; let listEtag = null; let currentPage = 1; let lastAt = null;
    const known = new Set(); const advisors = new Set(); const statuses = new Map();

    const kpi = (label, oxV, edV, note, warn) => el('div', { class: `kpi${warn ? ' warn' : ''}` },
      el('span', { class: 'kpi-label', text: label }),
      el('span', { class: 'kpi-val' }, el('b', { text: 'Ox ' }), String(oxV ?? '—'), edV === undefined ? '' : ' · ', edV === undefined ? '' : el('b', { text: 'Ed ' }), edV === undefined ? '' : String(edV ?? '—')),
      note ? el('span', { class: 'kpi-note', text: note }) : null);

    function renderKpis() {
      if (!summary) return;
      const s = summary[range];
      const vencidos = s.ox.sinAtenderVencidos + s.ed.sinAtenderVencidos;
      const ws = s.ws.abiertos ? Object.entries(s.ws.porEstado).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(' · ') : 'ninguno';
      $('kpis').replaceChildren(
        kpi('Leads nuevos', s.ox.nuevos, s.ed.nuevos),
        kpi('Sin atender ahora', s.ox.sinAtender, s.ed.sinAtender, vencidos ? `${vencidos} con más de 30 min` : 'ninguno vencido', vencidos > 0),
        kpi('Sin confirmar (Ox)', s.ox.sinConfirmar, undefined, 'se agotó la cadena de asesoras', s.ox.sinConfirmar > 0),
        kpi('Tiempo de respuesta (mediana)', dur(s.ox.respuesta.mediana), dur(s.ed.respuesta.mediana), 'Ox hasta ATIENDO · Ed hasta LISTO'),
        kpi('Casos W&S abiertos', s.ws.abiertos, undefined, ws, s.ws.abiertos > 0),
      );
    }
    document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
      range = b.dataset.range;
      document.querySelectorAll('[data-range]').forEach((x) => x.classList.toggle('on', x === b));
      renderKpis();
    }));

    const qs = () => {
      const p = new URLSearchParams();
      for (const [k, id] of [['q', 'f-q'], ['bot', 'f-bot'], ['advisor', 'f-advisor'], ['stage', 'f-stage'], ['status', 'f-status'], ['from', 'f-from'], ['to', 'f-to']]) if ($(id).value) p.set(k, $(id).value);
      if ($('f-test').checked) p.set('includeTest', '1');
      p.set('page', String(currentPage));
      return p;
    };

    function fillSelect(id, values, labelOf) {
      const sel = $(id); const cur = sel.value; const first = sel.options[0];
      sel.replaceChildren(first, ...[...values].sort().map((v) => el('option', { value: v, text: labelOf ? labelOf(v) : v })));
      sel.value = cur;
    }

    const stagePill = (r) => el('span', { class: `pill st-${r.stage}${r.overdue ? ' late' : ''}`, text: r.stageLabel });
    const deliveryText = (d) => (!d ? '—' : { read: 'Leído', delivered: 'Entregado', sent: 'Enviado', accepted: 'Aceptado', failed: `Falló${d.errorCode ? ` (${d.errorCode})` : ''}`, send_error: 'No salió' }[d.status] || d.status);

    function renderRows(data) {
      const tbody = $('rows');
      if (!data.rows.length) { tbody.replaceChildren(el('tr', {}, el('td', { colspan: '10', class: 'muted', text: 'No hay prospectos con estos filtros.' }))); }
      else {
        // Foto de lo ya visto ANTES de pintar: si se consultara `known` mientras se
        // llena, desde la 2.ª fila todo parecería nuevo en la primera carga.
        const seenBefore = new Set(known);
        tbody.replaceChildren(...data.rows.map((r) => {
          const isNew = seenBefore.size > 0 && !seenBefore.has(r.key);
          const changed = data.changed && data.changed.includes(r.key);
          known.add(r.key);
          if (r.advisorCurrent) advisors.add(r.advisorCurrent);
          if (r.advisorOriginal) advisors.add(r.advisorOriginal);
          statuses.set(r.status, r.statusLabel);
          const href = `/panel/lead/${r.bot}/${r.ticket}`;
          const asesora = r.advisorOriginal && r.advisorCurrent && r.advisorOriginal !== r.advisorCurrent ? `${r.advisorOriginal} → ${r.advisorCurrent}` : (r.advisorCurrent || r.advisorOriginal || '—');
          return el('tr', { class: isNew || changed ? 'flash' : null },
            el('td', { class: 'nowrap' }, fmtDate(r.createdAt), el('br'), el('span', { class: 'muted', text: fmtTime(r.createdAt) })),
            el('td', {}, el('span', { class: `bot ${r.bot}`, text: r.botLabel })),
            el('td', {}, el('a', { href, text: r.name || 'Sin nombre' }), el('br'), el('span', { class: 'muted mono', text: r.phone })),
            el('td', { text: r.zone || '—' }),
            el('td', { text: r.product || '—' }),
            el('td', {}, stagePill(r), el('br'), el('span', { class: 'muted', text: `hace ${ago(r.sinceAt)}` }), r.wsCase ? el('span', { class: 'pill ws', text: `W&S #${r.wsCase.number}` }) : null),
            el('td', { text: asesora }),
            el('td', { class: 'nowrap' }, el('a', { href, text: `#${r.ticket}` }), el('br'), el('span', { class: 'muted', text: r.statusLabel })),
            el('td', { text: deliveryText(r.delivery) }),
            el('td', { class: 'nowrap', text: r.lastMessageAt ? `hace ${ago(r.lastMessageAt)}` : '—' }),
          );
        }));
      }
      fillSelect('f-advisor', advisors);
      fillSelect('f-status', new Set(statuses.keys()), (v) => statuses.get(v));
      $('count').textContent = `${data.total} prospecto${data.total === 1 ? '' : 's'}`;
      const pager = $('pager');
      pager.replaceChildren();
      if (data.pages > 1) {
        const go = (p) => () => { currentPage = p; listEtag = null; refresh(); };
        pager.append(el('button', { type: 'button', class: 'link', disabled: data.page <= 1 }, '← Anterior'), ` Página ${data.page} de ${data.pages} `, el('button', { type: 'button', class: 'link', disabled: data.page >= data.pages }, 'Siguiente →'));
        pager.children[0].addEventListener('click', go(data.page - 1));
        pager.children[1].addEventListener('click', go(data.page + 1));
      }
    }

    async function loadSummary() {
      const r = await api('/panel/api/summary', { etag: sumEtag });
      if (!r.notModified) { summary = r.data; sumEtag = r.etag; renderKpis(); }
    }
    async function loadList() {
      const p = qs(); if (lastAt) p.set('since', lastAt);
      const r = await api(`/panel/api/leads?${p}`, { etag: listEtag });
      if (r.notModified) return;
      listEtag = r.etag; lastAt = r.data.at; renderRows(r.data);
    }
    const refresh = poller(async () => { await Promise.all([loadSummary(), loadList()]); });
    let t = null;
    $('filters').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { currentPage = 1; listEtag = null; lastAt = null; known.clear(); refresh(); }, 350); });
    $('filters').addEventListener('submit', (e) => e.preventDefault());
  }

  // ── Detalle ────────────────────────────────────────────────────────────
  if (page === 'detail') {
    const { bot, ticket, role } = document.body.dataset;
    let etag = null; let older = []; let oldestAt = null;
    const LABELS = {
      fullName: 'Nombre', role: 'Puesto', institutionName: 'Institución', leadType: 'Tipo', state: 'Estado', municipality: 'Municipio', zoneKey: 'Dupla',
      primaryProductLabel: 'Producto', estimatedStudents: 'Alumnos', temperature: 'Temperatura', parentName: 'Papá / mamá', travelerName: 'Viajero',
      travelerAge: 'Edad del viajero', schoolCode: 'Colegio', programInterest: 'Programa', destination: 'Destino', notes: 'Notas',
    };
    const sender = (m) => (m.senderType === 'user' ? 'Prospecto' : m.senderType === 'agent' ? 'Asesora' : bot === 'ox' ? 'Ox' : 'Ed');

    function render(d) {
      const r = d.row;
      $('detail-head').replaceChildren(
        el('h1', {}, `${r.botLabel} · Ticket #${r.ticket} · ${r.name || 'Sin nombre'}`),
        el('p', {}, el('span', { class: 'mono', text: r.phone }), ' ', el('span', { class: `pill st-${r.stage}${r.overdue ? ' late' : ''}`, text: r.stageLabel }), ` ${r.statusLabel} · llegó ${fmtDT(r.createdAt)}`),
      );
      const dl = $('ficha'); dl.replaceChildren();
      for (const [k, label] of Object.entries(LABELS)) {
        const v = d.lead[k];
        if (v == null || v === '') continue;
        dl.append(el('dt', { text: label }), el('dd', { text: String(v) }));
      }
      dl.append(el('dt', { text: 'Asesora actual' }), el('dd', { text: r.advisorCurrent || '—' }));
      if (d.lead.slaDueAt && r.stage === 'derivado') dl.append(el('dt', { text: 'SLA vence' }), el('dd', { text: fmtDT(d.lead.slaDueAt) }));

      const chain = $('chain');
      const items = [];
      for (const a of d.attempts || []) items.push(el('li', {}, el('b', { text: a.advisor }), ` · asignada ${fmtDT(a.assignedAt)} · ${({ esperando: 'esperando', confirmo: 'confirmó', no_confirmo: 'no confirmó', otro_confirmo: 'otra confirmó' })[a.result] || a.result}`));
      for (const n of d.notifications) {
        const st = { read: `leído ${fmtDT(n.readAt)}`, delivered: `entregado ${fmtDT(n.deliveredAt)}`, sent: 'enviado', accepted: 'aceptado por Meta', failed: `falló ${n.errorCode || ''} ${n.errorTitle || ''}`, send_error: 'no salió' }[n.status] || n.status;
        items.push(el('li', { class: n.status === 'failed' || n.status === 'send_error' ? 'bad' : null }, el('b', { text: `Aviso a ${n.advisorName}` }), ` · ${n.via === 'template' ? `plantilla ${n.templateName}` : n.via === 'text' ? 'texto' : 'no salió'} · ${fmtDT(n.createdAt)} · ${st}`));
      }
      chain.replaceChildren(...(items.length ? items : [el('li', { class: 'muted', text: 'Sin avisos registrados (el rastro existe desde el 11-nov).' })]));
      $('commands').replaceChildren(...(d.commands.length ? d.commands.map((c) => el('li', {}, `${fmtDT(c.createdAt)} · `, el('b', { text: c.advisorName }), `: ${c.command} → ${c.outcome}${c.detail ? ` (${c.detail})` : ''}`)) : [el('li', { class: 'muted', text: 'Ninguno todavía.' })]));

      if (d.wsCases && d.wsCases.length) {
        $('ws-card').hidden = false;
        $('ws').replaceChildren(...d.wsCases.map((c) => el('div', { class: 'ws-case' },
          el('p', {}, el('b', { text: `Caso #${c.caseNumber}` }), ` · ${c.status.replace('_', ' ')} · ${c.confirmedBy || c.assignedName || '—'}`),
          el('p', { class: 'muted', text: `${c.stage} · ${c.email} · capturas: ${c.attachments.length}` }),
          el('p', { text: c.description }),
          el('ol', { class: 'chain' }, c.commands.map((x) => el('li', {}, `${fmtDT(x.createdAt)} · ${x.advisorName}: ${x.command} → ${x.outcome}`))),
        )));
      }

      const box = $('messages');
      if (d.messages === null) { box.replaceChildren(el('li', { class: 'muted', text: 'La conversación solo la ve un admin.' })); return; }
      const all = [...older, ...d.messages];
      if (!older.length) { oldestAt = d.messages[0]?.createdAt || null; $('older').hidden = !d.moreBefore; }
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      box.replaceChildren(...all.map((m) => el('li', { class: `msg ${m.direction === 'inbound' ? 'in' : 'out'}` },
        el('span', { class: 'meta', text: `${fmtDT(m.createdAt)} · ${sender(m)}${m.contentType !== 'text' ? ` · ${m.contentType}` : ''}` }),
        el('span', { class: 'body', text: m.content }))));
      if (atBottom) box.scrollTop = box.scrollHeight;
    }

    const load = async (first) => {
      const r = await api(`/panel/api/lead/${bot}/${ticket}${first ? '' : '?poll=1'}`, { etag });
      if (r.notModified) return;
      etag = r.etag; render(r.data);
    };
    let first = true;
    poller(async () => { await load(first); first = false; });
    $('older').addEventListener('click', async () => {
      if (!oldestAt) return;
      const { data } = await api(`/panel/api/lead/${bot}/${ticket}?poll=1&before=${encodeURIComponent(oldestAt)}`);
      older = [...(data.messages || []), ...older];
      oldestAt = data.messages?.[0]?.createdAt || oldestAt;
      $('older').hidden = !data.moreBefore;
      etag = null; await load(false);
    });
    void role;
  }
})();
