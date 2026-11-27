/**
 * Panel — HTML de las páginas. Solo estructura: los datos los pinta
 * /panel/assets/panel.js desde la API. Sin scripts ni estilos en línea (CSP).
 */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shell({ title, body, page, user = null, data = {} }) {
  const attrs = Object.entries({ page, ...data }).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${esc(title)}</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/panel/assets/panel.css">
</head>
<body ${attrs}>
${user ? `<header class="bar">
  <a class="brand" href="/panel">Prospectos <span>Ox · Ed</span></a>
  <span class="live" id="live" aria-live="polite">Conectando…</span>
  <span class="who">${esc(user.name)}</span>
  <button type="button" class="link" id="logout">Salir</button>
</header>` : ''}
${body}
<script src="/panel/assets/panel.js" defer></script>
</body>
</html>`;
}

export function loginPage() {
  return shell({
    title: 'Entrar · Panel de prospectos',
    page: 'login',
    body: `<main class="auth">
  <form id="login-form" class="card" novalidate>
    <h1>Panel de prospectos</h1>
    <label for="email">Correo</label>
    <input id="email" name="email" type="email" autocomplete="username" required>
    <label for="password">Contraseña</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <p class="error" id="login-error" role="alert" hidden></p>
    <button type="submit" id="login-submit">Entrar</button>
    <p class="fine">Acceso privado. Cada entrada queda registrada.</p>
  </form>
</main>`,
  });
}

export function passwordPage(user) {
  return shell({
    title: 'Cambiar contraseña · Panel de prospectos',
    page: 'password',
    user,
    body: `<main class="auth">
  <form id="password-form" class="card" novalidate>
    <h1>Cambia tu contraseña</h1>
    ${user?.mustChangePassword ? '<p>Es tu primer ingreso: define una contraseña propia para continuar.</p>' : ''}
    <label for="current">Contraseña actual</label>
    <input id="current" name="current" type="password" autocomplete="current-password" required>
    <label for="next">Contraseña nueva (mínimo 12 caracteres)</label>
    <input id="next" name="next" type="password" autocomplete="new-password" minlength="12" required>
    <p class="error" id="password-error" role="alert" hidden></p>
    <button type="submit">Guardar contraseña</button>
  </form>
</main>`,
  });
}

export function homePage(user) {
  return shell({
    title: 'Panel de prospectos',
    page: 'home',
    user,
    data: { role: user.role },
    body: `<main class="wrap">
  <section class="kpis" aria-label="Indicadores">
    <div class="kpi-head">
      <div class="seg" role="group" aria-label="Periodo">
        <button type="button" class="on" data-range="hoy">Hoy</button>
        <button type="button" data-range="semana">7 días</button>
      </div>
    </div>
    <div class="kpi-grid" id="kpis"><p class="muted">Cargando indicadores…</p></div>
  </section>

  <section class="list" aria-label="Prospectos">
    <form id="filters" class="filters">
      <input id="f-q" name="q" type="search" placeholder="Nombre, teléfono, colegio o #ticket" aria-label="Buscar">
      <select id="f-bot" name="bot" aria-label="Bot"><option value="">Ox y Ed</option><option value="ox">Ox</option><option value="ed">Ed</option></select>
      <select id="f-advisor" name="advisor" aria-label="Asesora"><option value="">Todas las asesoras</option></select>
      <select id="f-stage" name="stage" aria-label="Etapa">
        <option value="">Todas las etapas</option><option value="solo_saludo">Solo saludó</option><option value="dio_datos">Dio datos</option>
        <option value="derivado">Derivado</option><option value="atendido">Atendido</option><option value="cerrado">Cerrado</option><option value="sin_confirmar">Sin confirmar</option>
      </select>
      <select id="f-status" name="status" aria-label="Estado del ticket"><option value="">Todos los estados</option></select>
      <label class="inline">Del <input id="f-from" name="from" type="date"></label>
      <label class="inline">al <input id="f-to" name="to" type="date"></label>
      <label class="inline"><input id="f-test" name="includeTest" type="checkbox" value="1"> incluir pruebas</label>
      <span class="count" id="count"></span>
    </form>
    <div class="table-wrap">
      <table class="leads">
        <thead><tr>
          <th>Llegó</th><th>Bot</th><th>Prospecto</th><th>Zona / colegio</th><th>Producto</th><th>Etapa</th>
          <th>Asesora</th><th>Ticket</th><th>Aviso</th><th>Último mensaje</th>
        </tr></thead>
        <tbody id="rows"><tr><td colspan="10" class="muted">Cargando…</td></tr></tbody>
      </table>
    </div>
    <nav class="pager" id="pager" aria-label="Páginas"></nav>
  </section>
</main>`,
  });
}

export function detailPage(user, bot, ticket) {
  return shell({
    title: `${bot === 'ox' ? 'Ox' : 'Ed'} #${ticket} · Panel de prospectos`,
    page: 'detail',
    user,
    data: { bot, ticket, role: user.role },
    body: `<main class="wrap detail">
  <p><a href="/panel" class="back">← Volver a la lista</a></p>
  <header class="detail-head" id="detail-head"><h1>Cargando…</h1></header>
  <div class="detail-grid">
    <aside>
      <section class="card"><h2>Ficha</h2><dl id="ficha"></dl></section>
      <section class="card"><h2>Cadena de asignación</h2><ol class="chain" id="chain"></ol></section>
      <section class="card"><h2>Comandos de asesoras</h2><ol class="chain" id="commands"></ol></section>
      <section class="card" id="ws-card" hidden><h2>Caso W&amp;S</h2><div id="ws"></div></section>
    </aside>
    <section class="card convo">
      <h2>Conversación</h2>
      <button type="button" class="link" id="older" hidden>Ver mensajes anteriores</button>
      <ol class="messages" id="messages"></ol>
    </section>
  </div>
</main>`,
  });
}
