/* Online Cadastral & Survey Records Portal — single-page client. */
(() => {
  'use strict';
  const S = window.Survey;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const app = $('#app');

  // ---------- utilities ----------
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (n, d = 3) => n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });
  const coord = n => (n >= 0 ? '+' : '−') + fmt(Math.abs(n), 3);
  const bytes = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function date(s, withTime = false) {
    if (!s) return '—';
    if (/^\d{4}$/.test(s)) return s;
    if (/^\d{4}-\d{2}$/.test(s)) return `${MONTHS[+s.slice(5) - 1]} ${s.slice(0, 4)}`;
    const d = new Date(/\d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') + 'Z' : s + 'T00:00:00');
    if (isNaN(d)) return s;
    const base = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    return withTime ? `${base}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : base;
  }
  function ago(s) {
    const d = new Date(s.replace(' ', 'T') + 'Z'), m = (Date.now() - d) / 60000;
    if (m < 1) return 'just now';
    if (m < 60) return `${Math.floor(m)} min ago`;
    if (m < 1440) return `${Math.floor(m / 60)} h ago`;
    if (m < 10080) return `${Math.floor(m / 1440)} d ago`;
    return date(s);
  }
  const STATUS = { approved: 'Approved', lodged: 'Lodged', under_examination: 'Under examination', returned: 'Returned for correction', pending: 'Pending', active: 'Active', suspended: 'Suspended' };
  const badge = s => `<span class="badge ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
  const ref = r => r.ref_no || r.lodgement_no || '—';
  const kindTag = k => `<span class="kind ${esc(k)}"><i></i>${esc(k)}</span>`;
  const initials = n => String(n).split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  let toastTimer;
  function toast(msg, bad = false) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 3200);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET', credentials: 'same-origin',
      headers: { 'X-Portal': '1', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && state.user) { state.user = null; go('#/login'); }
    if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.details = data.details; e.status = res.status; throw e; }
    return data;
  }

  // ---------- icons (Lucide-style, 24px grid) ----------
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    map: '<path d="m9 4-6 2.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
    beacon: '<path d="M12 3 3 20h18z"/><circle cx="12" cy="14" r="2"/>',
    tool: '<path d="M4 20 20 4"/><path d="M14 4h6v6"/><path d="M4 14v6h6"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 16l4-4-4-4M14 12H3"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    check: '<path d="m4 12.5 5 5L20 6.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    cal: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    msg: '<path d="M4 5h16v11H8l-4 4z"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
    area: '<path d="M4 18 8 5l9 3 3 10z"/>',
    transform: '<path d="M4 4h7v7H4zM13 13h7v7h-7z"/><path d="M11 7.5h5a2 2 0 0 1 2 2V13M13 16.5H8a2 2 0 0 1-2-2V11"/>',
  };
  const ic = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

  // ---------- state & router ----------
  const state = { user: null, meta: { recordTypes: [], districts: [] }, stats: null };
  const isStaff = () => ['examiner', 'admin'].includes(state.user?.role);
  const go = h => { if (location.hash === h) route(); else location.hash = h; };

  function parseHash() {
    const [p, qs] = (location.hash.slice(1) || '/').split('?');
    return { parts: p.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs || '')) };
  }

  let cleanup = null;
  async function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    const { parts, query } = parseHash();
    const [a, b] = parts;
    if (!state.user) {
      if (a === 'register') return renderRegister();
      return renderLogin();
    }
    if (a === 'login' || a === 'register') return go('#/');
    shell(a || 'home');
    const c = $('.content');
    c.innerHTML = '<div class="stack"><div class="skeleton" style="width:30%;height:22px"></div><div class="skeleton"></div><div class="skeleton" style="width:80%"></div></div>';
    window.scrollTo(0, 0);
    try {
      if (!a) await pageHome(c);
      else if (a === 'search') await pageSearch(c, query);
      else if (a === 'records' && b) await pageRecord(c, b, query.tab);
      else if (a === 'map') await pageMap(c);
      else if (a === 'beacons') await pageBeacons(c, query);
      else if (a === 'tools') pageTools(c, query.tool);
      else if (a === 'lodge') await pageLodge(c, b);
      else if (a === 'lodgements') await pageList(c, 'mine');
      else if (a === 'queue') await pageList(c, 'queue');
      else if (a === 'admin') await pageAdmin(c, query.tab);
      else c.innerHTML = empty('map', 'Page not found', 'That address does not exist in the portal.');
    } catch (e) {
      c.innerHTML = `<div class="notice bad">${ic('alert')}<div>${esc(e.message)}</div></div>`;
    }
  }
  window.addEventListener('hashchange', route);

  const empty = (icon, title, text, action = '') => `<div class="empty">${ic(icon)}<b>${esc(title)}</b><p>${esc(text)}</p>${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;

  // ---------- shell ----------
  function shell(active) {
    const u = state.user;
    const counts = state.stats || {};
    const link = (href, key, icon, label, count) =>
      `<a href="${href}" class="${active === key ? 'active' : ''}">${ic(icon)}<span>${label}</span>${count ? `<span class="count">${count}</span>` : ''}</a>`;
    if (!$('.shell')) {
      app.innerHTML = `<div class="shell">
        <aside class="side"></aside>
        <div class="main">
          <header class="topbar">
            <button class="btn ghost icon menu" aria-label="Menu">${ic('menu')}</button>
            <form class="gsearch" role="search">${ic('search')}<input name="q" placeholder="Search by SR number, property, district or beacon…" autocomplete="off" aria-label="Search records"><kbd>/</kbd></form>
            <div style="margin-left:auto" class="row">
              ${u.role === 'surveyor' ? `<a class="btn primary sm" href="#/lodge" aria-label="Lodge survey">${ic('upload')}<span class="hide-sm">Lodge survey</span></a>` : ''}
            </div>
          </header>
          <main class="content"></main>
        </div>
      </div>`;
      $('.gsearch').addEventListener('submit', ev => { ev.preventDefault(); const q = ev.target.q.value.trim(); go(`#/search?q=${encodeURIComponent(q)}`); });
      $('.menu').addEventListener('click', () => $('.shell').classList.toggle('nav-open'));
      document.addEventListener('keydown', ev => {
        if (ev.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { ev.preventDefault(); $('.gsearch input')?.focus(); }
      });
    }
    $('.shell').classList.remove('nav-open');
    $('.side').innerHTML = `
      <a class="brand" href="#/"><img src="/img/mark.svg" alt=""><div><b>e-Cadastre</b><span>Surveyor-General · Zimbabwe</span></div></a>
      <nav class="nav">
        ${link('#/', 'home', 'home', 'Dashboard')}
        ${link('#/search', 'search', 'search', 'Cadastral search')}
        ${link('#/map', 'map', 'map', 'Index map')}
        ${link('#/beacons', 'beacons', 'beacon', 'Beacons & trigs')}
        ${link('#/tools', 'tools', 'tool', 'Survey tools')}
        ${u.role === 'surveyor' ? `<div class="nav-label">Lodgement</div>
          ${link('#/lodge', 'lodge', 'upload', 'Lodge a survey')}
          ${link('#/lodgements', 'lodgements', 'folder', 'My lodgements', counts.returned || '')}` : ''}
        ${isStaff() ? `<div class="nav-label">Examination</div>
          ${link('#/queue', 'queue', 'inbox', 'Examination queue', counts.queue || '')}` : ''}
        ${u.role === 'admin' ? link('#/admin', 'admin', 'users', 'Users & audit', counts.pendingUsers || '') : ''}
      </nav>
      <div class="side-foot">
        <div class="avatar">${esc(initials(u.name))}</div>
        <div class="who"><b>${esc(u.name)}</b><span>${esc(u.role)}</span></div>
        <button class="btn ghost icon sm" id="logout" title="Sign out" aria-label="Sign out">${ic('logout')}</button>
      </div>`;
    $('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); state.user = null; app.innerHTML = ''; go('#/login'); };
    const q = parseHash().query.q;
    if (active === 'search' && q != null) $('.gsearch input').value = q;
  }

  async function refreshCounts() {
    try { const { stats } = await api('/api/stats'); state.stats = stats; } catch { /* ignore */ }
  }

  // ---------- auth pages ----------
  const authSide = `<div class="auth-side">
      <svg class="lines" viewBox="0 0 400 400" fill="none" stroke="#d6d8dc" stroke-width="1.2">
        <path d="M60 300 140 90l190 70-60 190z"/><path d="M140 90 330 160" stroke="#ea580c" stroke-width="1.6"/>
        <path d="M20 200h360M200 20v360" stroke-dasharray="3 6"/>
        <circle cx="140" cy="90" r="5" fill="#ea580c" stroke="none"/><circle cx="330" cy="160" r="4" fill="#fff"/><circle cx="270" cy="350" r="4" fill="#fff"/><circle cx="60" cy="300" r="4" fill="#fff"/>
      </svg>
      <a class="brand" href="#/login"><img src="/img/mark.svg" alt=""><div><b>e-Cadastre</b><span>Department of the Surveyor-General</span></div></a>
      <h1>Survey records, <em>without the trip</em> to Electra House.</h1>
      <p class="lead">Search approved diagrams, general plans and coordinate lists, lodge new surveys online and track examination from anywhere in Zimbabwe.</p>
      <div class="auth-points">
        <div>${ic('search')}<div><b>Remote search</b><span>By SR number, property, district or beacon</span></div></div>
        <div>${ic('upload')}<div><b>Online lodgement</b><span>Coordinates, figures and plans in one submission</span></div></div>
        <div>${ic('shield')}<div><b>Automatic checks</b><span>Areas and closures verified on lodgement</span></div></div>
        <div>${ic('layers')}<div><b>Digital archive</b><span>Scans preserved against wear and loss</span></div></div>
      </div>
      <div class="foot">Land Survey Act [Chapter 20:12] · Access is restricted to registered practitioners and DSG staff.</div>
    </div>`;

  function renderLogin() {
    const demo = [['Surveyor', 'surveyor@demo.co.zw'], ['Examiner', 'examiner@dsg.gov.zw'], ['Conveyancer', 'conveyancer@demo.co.zw'], ['Admin', 'admin@dsg.gov.zw']];
    app.innerHTML = `<div class="auth">${authSide}
      <div class="auth-form"><form novalidate>
        <div><h2>Sign in</h2></div>
        <p class="sub">Use your registered practitioner or DSG staff account.</p>
        <div id="err"></div>
        <label class="field">Email<input class="input" name="email" type="email" autocomplete="username" required></label>
        <label class="field">Password<input class="input" name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary block" type="submit">Sign in</button>
        <p class="center muted small">New practitioner? <a class="link" href="#/register">Request access</a></p>
        <div class="demo"><b>Demo accounts · password Demo@2026</b><div class="opts">
          ${demo.map(([l, e]) => `<button type="button" class="chip" data-email="${e}">${l}</button>`).join('')}
        </div></div>
      </form></div></div>`;
    const f = $('form');
    $$('[data-email]').forEach(b => b.onclick = () => { f.email.value = b.dataset.email; f.password.value = 'Demo@2026'; f.requestSubmit(); });
    f.onsubmit = async ev => {
      ev.preventDefault();
      const btn = f.querySelector('[type=submit]'); btn.disabled = true;
      try {
        const { user } = await api('/api/auth/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
        state.user = user; app.innerHTML = '';
        await refreshCounts();
        go(location.hash && !/login|register/.test(location.hash) ? location.hash : '#/');
      } catch (e) {
        $('#err').innerHTML = `<div class="notice bad">${ic('alert')}<div>${esc(e.message)}</div></div>`;
        btn.disabled = false;
      }
    };
  }

  function renderRegister() {
    app.innerHTML = `<div class="auth">${authSide}
      <div class="auth-form"><form novalidate>
        <div><h2>Request access</h2></div>
        <p class="sub">The registry verifies your registration number before activating the account.</p>
        <div id="err"></div>
        <label class="field">Full name<input class="input" name="name" required autocomplete="name"></label>
        <label class="field">Email<input class="input" name="email" type="email" required autocomplete="email"></label>
        <div class="grid-2">
          <label class="field">Profession<select class="input" name="role">
            <option value="surveyor">Land surveyor</option><option value="planner">Town planner</option><option value="conveyancer">Conveyancer</option></select></label>
          <label class="field">Registration no.<input class="input" name="reg_no" required></label>
        </div>
        <label class="field">Firm / organisation<input class="input" name="organisation" autocomplete="organization"></label>
        <label class="field">Password <span class="hint">At least 8 characters with letters and numbers</span><input class="input" name="password" type="password" required autocomplete="new-password"></label>
        <button class="btn primary block" type="submit">Submit request</button>
        <p class="center muted small">Already registered? <a class="link" href="#/login">Sign in</a></p>
      </form></div></div>`;
    const f = $('form');
    f.onsubmit = async ev => {
      ev.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      try {
        const r = await api('/api/auth/register', { method: 'POST', body });
        f.innerHTML = `<div class="empty">${ic('check')}<b>Request received</b><p>${esc(r.message)}</p><div style="margin-top:16px"><a class="btn" href="#/login">Back to sign in</a></div></div>`;
      } catch (e) { $('#err').innerHTML = `<div class="notice bad">${ic('alert')}<div>${esc(e.message)}</div></div>`; }
    };
  }

  // ---------- dashboard ----------
  async function pageHome(c) {
    const { stats, activity } = await api('/api/stats');
    state.stats = stats; shell('home');
    const u = state.user;
    const tiles = isStaff()
      ? [['inbox', 'Awaiting examination', stats.queue, 'Lodged or under examination', true], ['folder', 'Approved records', stats.approved, 'Searchable by practitioners'],
        ['beacon', 'Beacons on record', stats.beacons, `${stats.trigs} national trig beacons`], ['download', 'Downloads (30 days)', stats.downloads30, 'Audited retrievals']]
      : u.role === 'surveyor'
        ? [['folder', 'Approved records', stats.approved, 'Available to search'], ['beacon', 'Beacons on record', stats.beacons, `${stats.trigs} national trig beacons`],
          ['upload', 'My lodgements', stats.mine, `${stats.mineOpen} in progress`], ['alert', 'Returned to me', stats.returned, 'Need corrections', stats.returned > 0]]
        : [['folder', 'Approved records', stats.approved, 'Available to search'], ['beacon', 'Beacons on record', stats.beacons, `${stats.trigs} national trig beacons`],
          ['file', 'Digitised documents', stats.documents, 'Scans, plans and reports'], ['download', 'Downloads (30 days)', stats.downloads30, 'Across the portal']];
    const maxT = Math.max(1, ...stats.byType.map(t => t.n));
    const hour = new Date().getHours();
    c.innerHTML = `
      <div class="page-head"><div><h1>Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${esc(u.name)}</h1>
        <p>${isStaff() ? 'Review lodged surveys and keep the national cadastre current.' : 'Find survey data for your next job without visiting the registry.'}</p></div></div>
      <section class="hero-search">
        <h2>Cadastral search</h2>
        <p>Search approved Survey Records, General Plans, Diagrams and coordinate lists.</p>
        <form id="hs"><div class="gsearch">${ic('search')}<input name="q" placeholder="e.g. SR 51/2012, Garryowen, Gwelo, 19A" aria-label="Search"></div><button class="btn primary">Search</button></form>
        <div class="chips">${['Garryowen', 'Ardpatrick', 'Christmas Gift', 'Barkly', 'Gwelo', '315/S'].map(t => `<a class="chip" href="#/search?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>
      </section>
      <div class="stats">${tiles.map(([i, k, v, d, hl]) => `<div class="stat ${hl ? 'accent' : ''}"><div class="k">${ic(i)}${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('')}</div>
      <div class="cols">
        <div class="card"><div class="card-h"><div><h2>${isStaff() ? 'Recent examination activity' : 'My recent activity'}</h2></div>
          <a class="btn ghost sm" href="${isStaff() ? '#/queue' : u.role === 'surveyor' ? '#/lodgements' : '#/search'}">View all ${ic('arrow')}</a></div>
          <div class="list-activity">${activity.length ? activity.map(a => `
            <a class="act ${esc(a.action)}" href="#/records/${a.record_id}"><span class="dot"></span><div>
              <div class="t1"><b class="mono">${esc(a.ref)}</b> · ${esc(a.property_name)}</div>
              <div class="t2">${esc(actionLabel(a.action))} by ${esc(a.user_name || 'system')} · ${ago(a.created_at)}</div></div></a>`).join('')
            : empty('clock', 'Nothing yet', u.role === 'surveyor' ? 'Lodge your first survey to track it here.' : 'Activity on lodgements will appear here.',
              u.role === 'surveyor' ? `<a class="btn primary sm" href="#/lodge">${ic('upload')}Lodge a survey</a>` : '')}</div>
        </div>
        <div class="stack">
          ${u.role === 'surveyor' ? `<div class="card"><div class="card-b stack">
            <div class="row" style="gap:10px"><div class="step-n" style="background:var(--accent)">${ic('upload')}</div><h2>Lodge a new survey</h2></div>
            <p class="muted">Submit coordinates, figures and your working plan. Areas and consistency are checked automatically before examination.</p>
            <a class="btn dark" href="#/lodge">Start lodgement ${ic('arrow')}</a></div></div>` : ''}
          ${isStaff() && stats.pendingUsers && u.role === 'admin' ? `<a class="notice accent" href="#/admin">${ic('users')}<div><b>${stats.pendingUsers} practitioner${stats.pendingUsers > 1 ? 's' : ''}</b> awaiting verification</div></a>` : ''}
          <div class="card"><div class="card-h"><h2>Holdings by type</h2></div><div class="card-b">
            ${stats.byType.map(t => `<div class="type-row"><span>${esc(t.record_type)}</span><b class="num" style="text-align:right">${t.n}</b><div class="bar"><i style="width:${(t.n / maxT) * 100}%"></i></div></div>`).join('') || '<p class="muted">No approved records yet.</p>'}
          </div></div>
          <div class="card"><div class="card-b stack" style="gap:8px">
            <h3>Quick tools</h3>
            <a class="row small" href="#/tools?tool=area">${ic('area')}<span>Areas from coordinates</span></a>
            <a class="row small" href="#/tools?tool=helmert">${ic('transform')}<span>Helmert transformation</span></a>
            <a class="row small" href="#/tools?tool=join">${ic('ruler')}<span>Join: direction &amp; distance</span></a>
          </div></div>
        </div>
      </div>`;
    $('#hs').onsubmit = ev => { ev.preventDefault(); go(`#/search?q=${encodeURIComponent(ev.target.q.value.trim())}`); };
  }
  const actionLabel = a => ({ lodged: 'Lodged', resubmitted: 'Resubmitted', started: 'Examination started', returned: 'Returned for correction', approved: 'Approved', comment: 'Comment' })[a] || a;

  // ---------- search ----------
  async function pageSearch(c, query) {
    if (!state.meta.recordTypes.length) state.meta = await api('/api/meta');
    const q = query.q || '', type = query.type || '', district = query.district || '';
    const qs = new URLSearchParams({ q, type, district });
    const { records } = await api(`/api/records?${qs}`);
    const link = over => '#/search?' + new URLSearchParams({ q, type, district, ...over });
    c.innerHTML = `
      <div class="page-head"><div><h1>Cadastral search</h1><p>${q ? `${records.length} result${records.length === 1 ? '' : 's'} for “${esc(q)}”` : `${records.length} records available`}</p></div></div>
      <form class="row wrap" id="sf" style="margin-bottom:14px">
        <div class="gsearch" style="max-width:none;flex:1;min-width:240px">${ic('search')}<input name="q" value="${esc(q)}" placeholder="SR number, property, district, reference or beacon name" style="background:#fff"></div>
        <select class="input" name="district" style="width:180px"><option value="">All districts</option>${state.meta.districts.map(d => `<option ${d === district ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
        <button class="btn dark">Search</button>
      </form>
      <div class="chips" style="margin-bottom:18px">
        <a class="chip ${!type ? 'on' : ''}" href="${link({ type: '' })}">All types</a>
        ${state.meta.recordTypes.map(t => `<a class="chip ${t === type ? 'on' : ''}" href="${link({ type: t })}">${esc(t)}</a>`).join('')}
      </div>
      <div class="card">${records.length ? recordTable(records, { match: !!q }) : empty('search', 'No matching records', 'Try an SR number such as “SR 51/2012”, a property name, or a beacon like “19A”.')}</div>`;
    $('#sf').onsubmit = ev => { ev.preventDefault(); const f = new FormData(ev.target); go(link({ q: f.get('q').trim(), district: f.get('district') })); };
    bindRows(c);
  }

  function recordTable(records, { match = false, lodger = false } = {}) {
    return `<div class="table-wrap"><table class="t"><thead><tr>
      <th>Reference</th><th>Property</th><th>Type</th><th>District</th>${lodger ? '<th>Lodged by</th>' : ''}<th>Date</th><th>Status</th><th class="r">Files</th></tr></thead><tbody>
      ${records.map(r => `<tr class="click" data-href="#/records/${r.id}">
        <td class="mono" style="white-space:nowrap">${esc(ref(r))}</td>
        <td><div class="title">${esc(r.property_name)}</div>${match && r.match ? `<div class="sub">Matched: ${esc(r.match)}</div>` : r.declared_area ? `<div class="sub">${esc(r.declared_area)}</div>` : ''}</td>
        <td><span class="tag">${esc(r.record_type)}</span></td>
        <td>${esc(r.district)}</td>
        ${lodger ? `<td>${esc(r.lodged_by_name || '—')}</td>` : ''}
        <td class="muted" style="white-space:nowrap">${date(r.status === 'approved' ? r.approved_date || r.survey_date : r.lodged_at)}</td>
        <td>${badge(r.status)}</td>
        <td class="r muted num">${r.doc_count}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  const bindRows = root => $$('tr[data-href]', root).forEach(tr => tr.onclick = () => go(tr.dataset.href));

  // ---------- parcel plot ----------
  function plotSVG(beacons, figures = [], { system = 'LO29', focus = true, highlight = null } = {}) {
    if (!beacons.length) return '';
    const tr = system === 'LEGACY' ? b => [b.y, -b.x] : b => [-b.y, b.x];
    const byName = new Map(beacons.map(b => [b.name, b]));
    const figPts = figures.flatMap(f => (f.order || []).map(n => byName.get(n)).filter(Boolean));
    const basis = focus && figPts.length ? figPts : beacons;
    const P = basis.map(tr);
    let minX = Math.min(...P.map(p => p[0])), maxX = Math.max(...P.map(p => p[0]));
    let minY = Math.min(...P.map(p => p[1])), maxY = Math.max(...P.map(p => p[1]));
    const W = 800, H = 600, pad = 60;
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const k = Math.min((W - 2 * pad) / Math.max(maxX - minX, span * 0.01), (H - 2 * pad) / Math.max(maxY - minY, span * 0.01));
    const ox = (W - (maxX - minX) * k) / 2, oy = (H - (maxY - minY) * k) / 2;
    const sc = b => { const [x, y] = tr(b); return [ox + (x - minX) * k, oy + (y - minY) * k]; };
    const inView = ([x, y]) => x > -20 && x < W + 20 && y > -20 && y < H + 20;
    let svg = `<svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="Plot of beacons and figures">
      <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#f0f1f3" stroke-width="1"/></pattern></defs>
      <rect width="${W}" height="${H}" fill="url(#grid)"/>`;
    const placed = [];
    figures.forEach((f, i) => {
      const pts = (f.order || []).map(n => byName.get(n)).filter(Boolean).map(sc);
      if (pts.length < 3) return;
      const hi = highlight == null ? i === figures.length - 1 : highlight === i;
      svg += `<polygon points="${pts.map(p => p.join(',')).join(' ')}" fill="${hi ? 'rgba(234,88,12,.07)' : 'rgba(17,24,39,.03)'}" stroke="${hi ? '#ea580c' : '#374151'}" stroke-width="${hi ? 2 : 1.3}" stroke-linejoin="round"/>`;
      if (hi && pts.length <= 14 && f.legs) {
        f.legs.forEach((l, j) => {
          const a = pts[j], b = pts[(j + 1) % pts.length];
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 60) return;
          let ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
          if (ang > 90 || ang < -90) ang += 180;
          const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          svg += `<text x="${mx}" y="${my}" transform="rotate(${ang} ${mx} ${my}) translate(0 -6)" text-anchor="middle" font-size="11" fill="#6b7280">${fmt(l.distance, 2)}</text>`;
        });
      }
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      let cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      // Nudge figure labels apart when figures overlap (e.g. a subdivision inside its parent lot).
      while (placed.some(([px, py]) => Math.abs(px - cx) < 90 && Math.abs(py - cy) < 40)) cy += 42;
      placed.push([cx, cy]);
      svg += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="12.5" font-weight="600" fill="#111827">${esc(f.name)}</text>`;
      if (f.area) svg += `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="#6b7280">${f.area >= 10000 ? fmt(f.area / 10000, 4) + ' ha' : fmt(f.area, 1) + ' m²'}</text>`;
    });
    const labelled = beacons.length <= 40;
    for (const b of beacons) {
      const p = sc(b);
      if (!inView(p)) continue;
      const [x, y] = p;
      if (b.kind === 'trig') svg += `<path d="M${x} ${y - 7}L${x + 6.5} ${y + 5}H${x - 6.5}Z" fill="#111827"/>`;
      else if (b.kind === 'placed') svg += `<circle cx="${x}" cy="${y}" r="4.2" fill="#ea580c" stroke="#fff" stroke-width="1.5"/>`;
      else if (b.kind === 'station') svg += `<rect x="${x - 3.5}" y="${y - 3.5}" width="7" height="7" fill="#fff" stroke="#8a9099" stroke-width="1.5"/>`;
      else if (b.kind === 'computed') svg += `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="#8a9099" stroke-width="1.5" stroke-dasharray="2 2"/>`;
      else svg += `<circle cx="${x}" cy="${y}" r="4.2" fill="#fff" stroke="#111827" stroke-width="1.8"/>`;
      if (labelled) svg += b.kind === 'station'
        ? `<text x="${x + 7}" y="${y - 6}" font-size="10" fill="#9ca3af" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(b.name)}</text>`
        : `<text x="${x + 8}" y="${y - 7}" font-size="11.5" font-weight="600" fill="#1f2937" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(b.name)}</text>`;
    }
    // Scale bar (1-2-5 steps) and north arrow.
    const target = 140 / k, pow = 10 ** Math.floor(Math.log10(target));
    const step = [1, 2, 5, 10].map(m => m * pow).reduce((best, v) => Math.abs(v - target) < Math.abs(best - target) ? v : best);
    const barW = step * k;
    svg += `<g transform="translate(${W - barW - 24} ${H - 26})"><rect width="${barW}" height="5" fill="#111827"/><rect width="${barW / 2}" height="5" fill="#fff" stroke="#111827"/>
      <text x="${barW}" y="-6" text-anchor="end" font-size="11" fill="#374151">${step >= 1000 ? step / 1000 + ' km' : step + ' m'}</text></g>
      <g transform="translate(${W - 30} 34)"><path d="M0-16 7 8 0 3-7 8Z" fill="#111827"/><text y="22" text-anchor="middle" font-size="10.5" font-weight="600" fill="#374151">N</text></g></svg>`;
    return svg;
  }
  const plotLegend = `<div class="legend">${kindTag('found')}${kindTag('placed')}${kindTag('station')}${kindTag('computed')}</div>`;

  // ---------- record ----------
  async function pageRecord(c, id, tab = 'overview') {
    const d = await api(`/api/records/${encodeURIComponent(id)}`);
    const r = d.record;
    const tabs = [['overview', 'Overview'], ['coordinates', 'Coordinates', d.beacons.length], ['figures', 'Figures & areas', d.figures.length],
      ['documents', 'Documents', d.documents.length], ['examination', r.status === 'approved' ? 'History' : 'Examination', d.history.length]];
    const setTab = t => { history.replaceState(null, '', `#/records/${r.id}?tab=${t}`); draw(t); };
    c.innerHTML = `
      <div class="crumb"><a href="#/search">Cadastral search</a><span>/</span><span>${esc(ref(r))}</span></div>
      <div class="rec-head"><div>
        <div class="row" style="gap:8px"><span class="ref">${esc(ref(r))}</span>${r.ref_no && r.lodgement_no ? `<span class="faint mono small">${esc(r.lodgement_no)}</span>` : ''}${badge(r.status)}</div>
        <h1>${esc(r.title)}</h1>
        <div class="meta-line"><span>${ic('file')}${esc(r.record_type)}</span><span>${ic('pin')}${esc(r.district)}${r.province ? ', ' + esc(r.province) : ''}</span>
          <span>${ic('cal')}${r.status === 'approved' ? 'Approved ' + date(r.approved_date) : 'Lodged ' + date(r.lodged_at)}</span>
          ${r.declared_area ? `<span>${ic('area')}${esc(r.declared_area)}</span>` : ''}</div>
      </div>
      <div class="btn-row">
        ${d.can.resubmit ? `<a class="btn primary" href="#/lodge/${r.id}">${ic('edit')}Correct &amp; resubmit</a>` : ''}
        ${d.can.examine ? `<button class="btn primary" data-tab="examination">${ic('shield')}Examine</button>` : ''}
        ${d.beacons.length ? `<a class="btn" href="/api/records/${r.id}/coordinates.csv">${ic('download')}Coordinates</a>` : ''}
        ${d.figures.length ? `<a class="btn" href="/api/records/${r.id}/area-report.txt">${ic('download')}Area report</a>` : ''}
      </div></div>
      <div class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" data-tab="${k}">${l}${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>
      <div id="tabc"></div>`;
    $$('[data-tab]', c).forEach(b => b.onclick = () => setTab(b.dataset.tab));

    function draw(t) {
      $$('.tabs button', c).forEach(b => b.classList.toggle('on', b.dataset.tab === t));
      const el = $('#tabc');
      if (t === 'overview') el.innerHTML = overview();
      else if (t === 'coordinates') el.innerHTML = coordinates();
      else if (t === 'figures') el.innerHTML = figuresTab();
      else if (t === 'documents') { el.innerHTML = documentsTab(); bindDocs(el); }
      else { el.innerHTML = examTab(); bindExam(el); }
      if (t === 'overview') bindPlotToggle(el);
    }

    function overview() {
      const hasPlot = d.beacons.length > 0;
      return `<div class="cols">
        <div class="stack">
          ${hasPlot ? `<div class="plot-wrap" id="pw">${plotSVG(d.beacons, d.figures, { system: r.coord_system })}${plotLegend}
            <div class="plot-note">${r.coord_system === 'LEGACY' ? 'Plan coordinates · not to Lo 29' : 'Lo 29'} ${d.figures.length ? `· <button type="button" class="link" id="fit">Show all beacons</button>` : ''}</div></div>`
            : d.documents.find(x => /^image\//.test(x.mime)) ? `<div class="viewer compact" style="margin:0"><img src="/api/documents/${d.documents.find(x => /^image\//.test(x.mime)).id}/view" alt="Scan of ${esc(r.title)}"></div>`
            : d.documents.find(x => x.mime === 'application/pdf') ? `<div class="viewer" style="margin:0"><iframe src="/api/documents/${d.documents.find(x => x.mime === 'application/pdf').id}/view" title="Plan"></iframe></div>` : ''}
          <div class="card"><div class="card-h"><h2>Record details</h2></div><div class="card-b"><dl class="kv">
            <dt>Property</dt><dd>${esc(r.property_name)}</dd>
            <dt>Record type</dt><dd>${esc(r.record_type)}</dd>
            ${r.ref_no ? `<dt>Reference</dt><dd class="mono">${esc(r.ref_no)}</dd>` : ''}
            ${r.lodgement_no ? `<dt>Lodgement no.</dt><dd class="mono">${esc(r.lodgement_no)}</dd>` : ''}
            <dt>District</dt><dd>${esc(r.district)}${r.office ? ` · ${esc(r.office)} office` : ''}</dd>
            ${r.surveyor ? `<dt>Surveyor</dt><dd>${esc(r.surveyor)}${d.lodger?.reg_no ? ` <span class="faint">(${esc(d.lodger.reg_no)})</span>` : ''}</dd>` : ''}
            <dt>Surveyed</dt><dd>${date(r.survey_date)}</dd>
            <dt>Approved</dt><dd>${date(r.approved_date)}</dd>
            ${r.declared_area ? `<dt>Extent</dt><dd>${esc(r.declared_area)}</dd>` : ''}
            ${r.datum ? `<dt>Datum / system</dt><dd>${esc(r.datum)}</dd>` : ''}
            ${r.related_refs ? `<dt>Related records</dt><dd>${r.related_refs.split(';').map(s => `<a class="tag" style="margin:0 4px 4px 0" href="#/search?q=${encodeURIComponent(s.trim())}">${esc(s.trim())}</a>`).join('')}</dd>` : ''}
            ${d.examiner ? `<dt>Examiner</dt><dd>${esc(d.examiner)}</dd>` : ''}
            ${r.notes ? `<dt>Notes</dt><dd class="muted">${esc(r.notes)}</dd>` : ''}
          </dl></div></div>
        </div>
        <div class="stack">
          ${d.checks.length ? `<div class="card"><div class="card-h"><div><h2>Consistency checks</h2><p>Computed from the coordinate list</p></div></div><div class="card-b"><div class="checks">
            ${d.checks.map(k => `<div class="check ${k.level}">${ic(k.level === 'pass' ? 'check' : k.level === 'info' ? 'info' : k.level === 'fail' ? 'x' : 'alert')}<span>${esc(k.text)}</span></div>`).join('')}</div></div></div>` : ''}
          ${d.figures.length ? `<div class="card"><div class="card-h"><h2>Figures</h2></div><div class="card-b flush"><table class="t dense">
            ${d.figures.map(f => `<tr><td><b>${esc(f.name)}</b><div class="sub">${f.order.length} beacons</div></td><td class="r num">${f.area != null ? fmt(f.area, 3) + ' m²' : '—'}<div class="sub">${f.hectares != null ? fmt(f.hectares, 4) + ' ha' : ''}</div></td></tr>`).join('')}
          </table></div></div>` : ''}
          ${d.control.length ? `<div class="card"><div class="card-h"><div><h2>Nearest control</h2><p>Trig beacons from the national network</p></div></div><div class="card-b flush"><table class="t dense">
            ${d.control.map(t => `<tr><td><b class="mono">${esc(t.name)}</b><div class="sub">${esc(t.locality || 'Trig beacon')}</div></td><td class="r num">${fmt(t.distance / 1000, 2)} km</td></tr>`).join('')}
          </table></div></div>` : ''}
          <div class="card"><div class="card-h"><h2>Documents</h2><button class="btn ghost sm" data-go="documents">Open ${ic('arrow')}</button></div>
            <div class="doc-list">${d.documents.slice(0, 4).map(docRow).join('') || '<div class="card-b muted">No documents.</div>'}</div></div>
        </div></div>`;
    }

    function bindPlotToggle(el) {
      let focus = true;
      const fit = $('#fit', el);
      if (fit) fit.onclick = () => {
        focus = !focus;
        $('svg.plot', el).outerHTML = plotSVG(d.beacons, d.figures, { system: r.coord_system, focus });
        fit.textContent = focus ? 'Show all beacons' : 'Fit to figures';
      };
      $$('[data-go]', el).forEach(b => b.onclick = () => setTab(b.dataset.go));
    }

    function coordinates() {
      if (!d.beacons.length) return `<div class="card">${empty('beacon', 'No coordinates captured', 'This record is held as a scanned plan. Open the Documents tab to view it.')}</div>`;
      const legacy = r.coord_system === 'LEGACY';
      const groups = ['station', 'found', 'placed', 'computed'].map(k => [k, d.beacons.filter(b => b.kind === k)]).filter(g => g[1].length);
      return `${legacy ? `<div class="notice" style="margin-bottom:14px">${ic('info')}<div>Coordinates are reproduced as printed on the plan (${esc(r.datum || 'original system')}). They are not in the Lo 29 system.</div></div>` : ''}
        <div class="card"><div class="card-h"><div><h2>Co-ordinate list</h2><p>${esc(r.datum || (legacy ? 'Plan system' : 'Lo 29'))}</p></div>
        <a class="btn sm" href="/api/records/${r.id}/coordinates.csv">${ic('download')}Download CSV</a></div>
        <div class="table-wrap"><table class="t dense"><thead><tr><th>Beacon</th><th>Type</th><th class="r">Y (m)</th><th class="r">X (m)</th>${d.beacons.some(b => b.z != null) ? '<th class="r">Z (m)</th>' : ''}<th>Description</th><th class="r">Calcs</th></tr></thead><tbody>
        ${groups.map(([k, list]) => `<tr><td colspan="7" style="background:var(--subtle);font-size:11.5px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.04em">${{ station: 'Working stations', found: 'Found beacons', placed: 'Placed beacons', computed: 'Computed points' }[k]}</td></tr>
          ${list.map(b => `<tr><td><b class="mono">${esc(b.name)}</b></td><td>${kindTag(b.kind)}</td><td class="r mono">${coord(b.y)}</td><td class="r mono">${coord(b.x)}</td>
          ${d.beacons.some(x => x.z != null) ? `<td class="r mono">${b.z != null ? fmt(b.z, 3) : ''}</td>` : ''}<td class="muted">${esc(b.description || '')}</td><td class="r faint">${esc(b.calc_page || '')}</td></tr>`).join('')}`).join('')}
        </tbody></table></div></div>`;
    }

    function figuresTab() {
      if (!d.figures.length) return `<div class="card">${empty('area', 'No figures defined', 'Figures are defined when a survey is lodged with a boundary beacon order.')}</div>`;
      return `<div class="stack">${d.figures.map(f => `<div class="card"><div class="card-h"><div><h2>${esc(f.name)}</h2><p>${esc(f.order.join(' → '))} → ${esc(f.order[0])}</p></div>
        <div class="row"><div class="r"><b class="num">${fmt(f.area, 3)} m²</b><div class="faint small">${fmt(f.hectares, 4)} ha</div></div></div></div>
        ${f.error ? `<div class="card-b"><div class="notice bad">${ic('alert')}${esc(f.error)}</div></div>` : `<div class="table-wrap"><table class="t dense"><thead><tr><th>From</th><th>To</th><th class="r">Direction</th><th class="r">Distance (m)</th><th class="r">Y</th><th class="r">X</th></tr></thead><tbody>
        ${f.legs.map(l => `<tr><td class="mono">${esc(l.from)}</td><td class="mono">${esc(l.to)}</td><td class="r mono">${S.dms(l.direction)}</td><td class="r mono">${fmt(l.distance, 3)}</td><td class="r mono">${coord(l.y)}</td><td class="r mono">${coord(l.x)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="card-b"><div class="result-grid">
          <div><span>Computed area</span><b>${fmt(f.area, 3)} m²</b></div>
          <div><span>Declared area</span><b>${f.declared_m2 != null ? fmt(f.declared_m2, 3) + ' m²' : '—'}</b></div>
          <div><span>Difference</span><b class="${f.difference == null ? '' : Math.abs(f.difference) <= Math.max(0.1, (f.declared_m2 || 0) * 1e-4) ? 'diff-ok' : 'diff-warn'}">${f.difference != null ? (f.difference >= 0 ? '+' : '') + fmt(f.difference, 3) + ' m²' : '—'}</b></div>
          <div><span>Perimeter</span><b>${fmt(f.perimeter, 3)} m</b></div>
        </div></div>`}</div>`).join('')}
        <div><a class="btn" href="/api/records/${r.id}/area-report.txt">${ic('download')}Download area report</a></div></div>`;
    }

    function docRow(doc) {
      const ext = (doc.filename.split('.').pop() || '').slice(0, 4);
      const cls = doc.mime === 'application/pdf' ? 'pdf' : /^image/.test(doc.mime) ? 'img' : /dwg|dxf/.test(ext) ? 'dwg' : '';
      const viewable = /^(image\/(png|jpeg)|application\/pdf|text\/plain)$/.test(doc.mime);
      return `<div class="doc"><div class="ic ${cls}">${esc(ext)}</div><div class="info"><b title="${esc(doc.filename)}">${esc(doc.filename)}</b><span>${esc(doc.kind || 'Document')} · ${bytes(doc.size)} · ${date(doc.uploaded_at)}</span></div>
        <div class="btn-row">${viewable ? `<button class="btn ghost sm" data-view="${doc.id}" data-mime="${esc(doc.mime)}" data-name="${esc(doc.filename)}">${ic('eye')}View</button>` : ''}
        <a class="btn sm" href="/api/documents/${doc.id}/download" title="Download">${ic('download')}</a></div></div>`;
    }
    function documentsTab() {
      return `<div class="card"><div class="card-h"><div><h2>Documents</h2><p>Every view and download is recorded in the audit log.</p></div></div>
        <div class="doc-list">${d.documents.map(docRow).join('') || empty('file', 'No documents', 'Nothing has been attached to this record.')}</div></div><div id="viewer"></div>`;
    }
    function bindDocs(el) {
      $$('[data-view]', el).forEach(b => b.onclick = () => {
        const src = `/api/documents/${b.dataset.view}/view`;
        $('#viewer').innerHTML = `<div class="viewer"><div class="vh"><b>${esc(b.dataset.name)}</b><div class="btn-row">${/^image/.test(b.dataset.mime) ? `<button class="btn ghost sm" id="vrot">Rotate</button>` : ''}<button class="btn ghost sm" id="vclose">${ic('x')}Close</button></div></div>
          ${/^image/.test(b.dataset.mime) ? `<img src="${src}" alt="${esc(b.dataset.name)}">` : `<iframe src="${src}" title="${esc(b.dataset.name)}"></iframe>`}</div>`;
        $('#vclose').onclick = () => ($('#viewer').innerHTML = '');
        let turn = 0;
        if ($('#vrot')) $('#vrot').onclick = () => { turn = (turn + 90) % 360; $('#viewer img').className = `rot${turn}`; };
        $('#viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      const first = $('[data-view]', el);
      if (first && d.documents.length === 1) first.click();
    }

    function examTab() {
      const tl = d.history.map(h => `<div class="tl ${esc(h.action)}"><div class="dot">${ic({ approved: 'check', returned: 'x', started: 'play', comment: 'msg', lodged: 'upload', resubmitted: 'upload' }[h.action] || 'info')}</div>
        <div><b>${esc(actionLabel(h.action))}</b> <span class="when">· ${esc(h.user_name || 'Registry')} · ${date(h.created_at, true)}</span>${h.comment ? `<div class="c">${esc(h.comment)}</div>` : ''}</div></div>`).join('');
      const act = d.can.examine ? `<div class="card"><div class="card-h"><div><h2>Examiner actions</h2><p>Decisions are recorded against your name</p></div></div><div class="card-b stack">
          ${d.checks.some(k => k.level === 'fail') ? `<div class="notice bad">${ic('alert')}<div>Automatic checks found errors. Return the lodgement unless they are resolved.</div></div>`
            : d.checks.some(k => k.level === 'warn') ? `<div class="notice accent">${ic('alert')}<div>Some checks need attention. Review the Overview before approving.</div></div>`
            : `<div class="notice">${ic('shield')}<div>All automatic checks passed.</div></div>`}
          ${r.status === 'lodged' || r.status === 'returned' ? `<button class="btn dark" data-act="start">${ic('play')}Start examination</button>` : ''}
          <label class="field">Comment or correction notes<textarea class="input" id="ecomment" placeholder="Required when returning a lodgement"></textarea></label>
          <label class="field">SR number on approval <span class="hint">Leave blank to assign the next number automatically</span><input class="input" id="eref" placeholder="SR …/${new Date().getFullYear()}"></label>
          <div class="btn-row"><button class="btn primary" data-act="approve">${ic('check')}Approve</button><button class="btn danger" data-act="return">${ic('x')}Return for correction</button><button class="btn ghost" data-act="comment">${ic('msg')}Add comment</button></div>
        </div></div>` : d.can.resubmit ? `<div class="card"><div class="card-b stack"><div class="notice accent">${ic('alert')}<div>The examiner returned this lodgement. Make the corrections noted in the history and resubmit.</div></div>
          <a class="btn primary" href="#/lodge/${r.id}">${ic('edit')}Correct &amp; resubmit</a></div></div>` : '';
      return `<div class="cols"><div class="card"><div class="card-h"><h2>History</h2></div><div class="card-b"><div class="timeline">${tl || '<p class="muted">No history recorded.</p>'}</div></div></div><div class="stack">${act}
        ${d.checks.length && d.can.examine ? `<div class="card"><div class="card-h"><h2>Checks</h2></div><div class="card-b"><div class="checks">${d.checks.map(k => `<div class="check ${k.level}">${ic(k.level === 'pass' ? 'check' : k.level === 'info' ? 'info' : k.level === 'fail' ? 'x' : 'alert')}<span>${esc(k.text)}</span></div>`).join('')}</div></div></div>` : ''}</div></div>`;
    }
    function bindExam(el) {
      $$('[data-act]', el).forEach(b => b.onclick = async () => {
        const action = b.dataset.act;
        const comment = $('#ecomment')?.value || '';
        if (action === 'approve' && !confirm(`Approve ${r.lodgement_no || r.title} and register it in the cadastre?`)) return;
        b.disabled = true;
        try {
          await api(`/api/records/${r.id}/examine`, { method: 'POST', body: { action, comment, ref_no: $('#eref')?.value || '' } });
          toast({ start: 'Examination started', approve: 'Approved and registered', return: 'Returned to the surveyor', comment: 'Comment added' }[action]);
          await refreshCounts();
          await pageRecord(c, r.id, 'examination'); shell(parseHash().parts[0]);
        } catch (e) { toast(e.message, true); b.disabled = false; }
      });
    }

    draw(tabs.some(t => t[0] === tab) ? tab : 'overview');
  }

  // ---------- index map ----------
  async function pageMap(c) {
    let data;
    try {
      data = await api('/api/map');
    } catch (e) {
      c.innerHTML = `<div class="notice bad">${ic('alert')}<div><b>Failed to load map data</b><div>${esc(e.message)}</div></div></div>`;
      return;
    }
    c.innerHTML = `<div class="page-head"><div><h1>Index map</h1><p>Surveyed parcels, beacons and trig stations on the Lo 29 system. Legacy plans without Lo 29 coordinates are listed in search.</p></div>
      <div class="chips"><span class="chip">${kindTag('trig')}</span><span class="chip"><span style="width:12px;height:10px;border:2px solid #ea580c;background:rgba(234,88,12,.12);border-radius:2px"></span>Approved parcel</span><span class="chip"><span style="width:12px;height:10px;border:2px dashed #374151;border-radius:2px"></span>In examination</span></div></div>
      <div id="map"></div>`;
    if (!window.L) { $('#map').innerHTML = empty('map', 'Map unavailable', 'The Leaflet map library failed to load.'); return; }
    
    if (L.Icon && L.Icon.Default) {
      L.Icon.Default.imagePath = '/vendor/leaflet/images/';
    }

    const mapEl = $('#map');
    const map = L.map(mapEl, { zoomControl: true, attributionControl: true });
    
    const osmProxy = L.tileLayer('/api/tiles/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    });

    const osmFrance = L.tileLayer('https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', {
      maxZoom: 20,
      subdomains: 'abc',
      attribution: '&copy; OpenStreetMap France | &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    });

    const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and GIS User Community'
    });

    const esriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community'
    });

    osmProxy.addTo(map);

    L.control.layers({
      'OpenStreetMap': osmProxy,
      'OSM Standard (France)': osmFrance,
      'Satellite Imagery (Esri)': esriSatellite,
      'Topographic Map (Esri)': esriTopo
    }).addTo(map);

    const bounds = [];
    for (const t of data.trigs || []) {
      if (!t.ll || !isFinite(t.ll[0]) || !isFinite(t.ll[1])) continue;
      bounds.push(t.ll);
      L.marker(t.ll, {
        icon: L.divIcon({
          className: 'bl',
          html: `<svg width="14" height="13" viewBox="0 0 14 13" style="position:absolute;left:-7px;top:-8px"><path d="M7 0 14 13H0z" fill="#111827"/></svg><span>${esc(t.name)}</span>`,
          iconSize: [0, 0]
        })
      }).bindPopup(`<div class="map-pop"><span class="ref">${esc(t.name)}</span><b>${esc(t.locality || 'Trigonometrical beacon')}</b><div class="mono">Y ${coord(t.y)}<br>X ${coord(t.x)}</div></div>`).addTo(map);
    }
    for (const f of data.features || []) {
      const approved = f.status === 'approved';
      const pop = `<div class="map-pop"><span class="ref">${esc(f.ref)}</span><b>${esc(f.title)}</b>${badge(f.status)}<div style="margin-top:8px"><a href="#/records/${f.id}">Open record →</a></div></div>`;
      for (const p of f.parcels || []) {
        if (!p.ring || !p.ring.length) continue;
        L.polygon(p.ring, { color: approved ? '#ea580c' : '#374151', weight: 2, dashArray: approved ? null : '5 4', fillColor: approved ? '#ea580c' : '#374151', fillOpacity: .1 })
          .bindPopup(pop.replace('</b>', `</b><div class="small muted">${esc(p.name)} · ${p.area >= 10000 ? fmt(p.area / 10000, 4) + ' ha' : fmt(p.area, 1) + ' m²'}</div>`)).addTo(map);
        p.ring.forEach(ll => { if (isFinite(ll[0]) && isFinite(ll[1])) bounds.push(ll); });
      }
      for (const b of (f.beacons || []).filter(b => b.kind !== 'station')) {
        if (!b.ll || !isFinite(b.ll[0]) || !isFinite(b.ll[1])) continue;
        L.circleMarker(b.ll, { radius: 4, color: b.kind === 'placed' ? '#fff' : '#111827', weight: 1.5, fillColor: b.kind === 'placed' ? '#ea580c' : '#fff', fillOpacity: 1 })
          .bindTooltip(`${b.name} · ${f.ref}`, { direction: 'top' }).bindPopup(pop).addTo(map);
        bounds.push(b.ll);
      }
    }

    if (bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40] });
    } else {
      map.setView([-19.0, 29.8], 7);
    }

    const triggerResize = () => {
      if (mapEl && map) {
        map.invalidateSize();
      }
    };
    requestAnimationFrame(triggerResize);
    setTimeout(triggerResize, 150);
    setTimeout(triggerResize, 500);

    window.addEventListener('resize', triggerResize);
    cleanup = () => {
      window.removeEventListener('resize', triggerResize);
      map.remove();
    };
  }

  // ---------- beacons ----------
  async function pageBeacons(c, query) {
    const q = query.q || '';
    const { beacons } = await api(`/api/beacons?q=${encodeURIComponent(q)}`);
    const trigs = beacons.filter(b => !b.record_id), others = beacons.filter(b => b.record_id);
    c.innerHTML = `<div class="page-head"><div><h1>Beacons &amp; trigs</h1><p>Locate trigonometrical beacons and survey beacons before going to the field.</p></div></div>
      <form id="bf" class="row" style="margin-bottom:18px"><div class="gsearch" style="max-width:420px">${ic('search')}<input name="q" value="${esc(q)}" placeholder="Beacon name, e.g. 19A, S1, 315/S" style="background:#fff"></div><button class="btn dark">Find</button></form>
      ${trigs.length ? `<div class="card" style="margin-bottom:20px"><div class="card-h"><div><h2>National control network</h2><p>Trigonometrical beacons, Lo 29</p></div><span class="tag">${trigs.length}</span></div>
        <div class="table-wrap"><table class="t dense"><thead><tr><th>Trig</th><th>Name</th><th class="r">Y (m)</th><th class="r">X (m)</th><th class="r">H (m)</th><th class="r">Lat / Lon (approx.)</th></tr></thead><tbody>
        ${trigs.map(t => { const ll = S.loToLatLon(t.y, t.x); return `<tr><td>${kindTag('trig')} <b class="mono">${esc(t.name)}</b></td><td>${esc(t.locality || '—')}</td><td class="r mono">${coord(t.y)}</td><td class="r mono">${coord(t.x)}</td><td class="r mono">${t.z != null ? fmt(t.z, 1) : ''}</td><td class="r mono faint">${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}</td></tr>`; }).join('')}
        </tbody></table></div></div>` : ''}
      <div class="card"><div class="card-h"><div><h2>Survey beacons</h2><p>From approved records${isStaff() ? ' and lodgements' : ' and your own lodgements'}</p></div><span class="tag">${others.length}</span></div>
        ${others.length ? `<div class="table-wrap"><table class="t dense"><thead><tr><th>Beacon</th><th>Type</th><th class="r">Y</th><th class="r">X</th><th>Description</th><th>Record</th></tr></thead><tbody>
        ${others.map(b => `<tr class="click" data-href="#/records/${b.record_id}?tab=coordinates"><td><b class="mono">${esc(b.name)}</b></td><td>${kindTag(b.kind)}</td>
          <td class="r mono">${coord(b.y)}</td><td class="r mono">${coord(b.x)}</td><td class="muted">${esc(b.description || '')}</td>
          <td><span class="mono small">${esc(b.ref_no || b.lodgement_no)}</span>${b.status !== 'approved' ? ' ' + badge(b.status) : ''}${b.coord_system === 'LEGACY' ? ' <span class="tag">plan units</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div>` : empty('beacon', 'No beacons found', 'Try a different beacon name.')}</div>`;
    $('#bf').onsubmit = ev => { ev.preventDefault(); go(`#/beacons?q=${encodeURIComponent(ev.target.q.value.trim())}`); };
    bindRows(c);
  }

  // ---------- lists (my lodgements / queue) ----------
  async function pageList(c, scope) {
    const { records } = await api(`/api/records?scope=${scope}`);
    const queue = scope === 'queue';
    const groups = queue ? [['under_examination', 'Under examination'], ['lodged', 'Awaiting examination'], ['returned', 'Returned to surveyor']] : null;
    c.innerHTML = `<div class="page-head"><div><h1>${queue ? 'Examination queue' : 'My lodgements'}</h1>
      <p>${queue ? 'Survey records lodged online for examination and approval.' : 'Track surveys you have lodged with the Surveyor-General.'}</p></div>
      ${!queue ? `<a class="btn primary" href="#/lodge">${ic('plus')}New lodgement</a>` : ''}</div>
      ${!records.length ? `<div class="card">${empty(queue ? 'inbox' : 'folder', queue ? 'Queue is clear' : 'No lodgements yet', queue ? 'New lodgements will appear here.' : 'Lodge a survey to have it examined online.', !queue ? `<a class="btn primary sm" href="#/lodge">${ic('upload')}Lodge a survey</a>` : '')}</div>`
        : queue ? groups.map(([s, l]) => { const list = records.filter(r => r.status === s); return list.length ? `<div class="card" style="margin-bottom:18px"><div class="card-h"><h2>${l}</h2><span class="tag">${list.length}</span></div>${recordTable(list, { lodger: true })}</div>` : ''; }).join('')
        : `<div class="card">${recordTable(records)}</div>`}`;
    bindRows(c);
  }

  // ---------- lodgement ----------
  const EXAMPLE = `# Name   Y   X   Description   F/P
19A   -86913.832   2149285.021   12mm iron peg in concrete   F
18A   -86964.806   2149327.208   Computed (Helmert)
19C   -86906.270   2149398.054   12mm iron peg in concrete   F
S1    -86870.757   2149368.657   12mm iron peg in concrete   P
S2    -86884.749   2149353.342   12mm iron peg in concrete   P
S3    -86896.738   2149357.739   12mm iron peg in concrete   P
S4    -86904.488   2149356.651   12mm iron peg in concrete   P
S5    -86944.206   2149310.161   12mm iron peg in concrete   P`;

  async function pageLodge(c, editId) {
    if (state.user.role !== 'surveyor') { c.innerHTML = `<div class="card">${empty('shield', 'Surveyors only', 'Only registered land surveyors can lodge survey records.')}</div>`; return; }
    if (!state.meta.recordTypes.length) state.meta = await api('/api/meta');
    const L = { record: { record_type: 'Survey Record', property_name: '', title: '', district: '', province: '', survey_date: '', declared_area: '', datum: 'Lo 29', related_refs: '', notes: '' }, beacons: [], parcels: [{ name: '', order: '', declared_m2: '' }], files: [] };
    let existing = null;
    if (editId) {
      existing = await api(`/api/records/${editId}`);
      if (!existing.can.resubmit) { c.innerHTML = `<div class="card">${empty('shield', 'Cannot edit', 'Only lodgements returned for correction can be edited.')}</div>`; return; }
      Object.keys(L.record).forEach(k => (L.record[k] = existing.record[k] || ''));
      L.beacons = existing.beacons.map(b => ({ name: b.name, y: b.y, x: b.x, z: b.z, kind: b.kind, description: b.description || '' }));
      L.parcels = existing.figures.map(f => ({ name: f.name, order: f.order.join(' '), declared_m2: f.declared_m2 ?? '' }));
    }
    const lastReturn = existing?.history.filter(h => h.action === 'returned').pop();
    c.innerHTML = `
      <div class="crumb"><a href="#/lodgements">My lodgements</a><span>/</span><span>${existing ? esc(existing.record.lodgement_no) : 'New lodgement'}</span></div>
      <div class="page-head"><div><h1>${existing ? 'Correct & resubmit' : 'Lodge a survey'}</h1><p>Submit your survey for examination. Areas and consistency are checked as you type.</p></div></div>
      ${lastReturn ? `<div class="notice accent" style="margin-bottom:18px">${ic('alert')}<div><b>Examiner's notes</b><div>${esc(lastReturn.comment)}</div></div></div>` : ''}
      <div class="cols"><form class="steps" id="lf" novalidate>
        <section class="card"><div class="card-h"><div class="row" style="gap:10px"><span class="step-n">1</span><h2>Property</h2></div></div><div class="card-b grid-2">
          <label class="field span-2">Property description<input class="input" name="property_name" placeholder="e.g. Lot 1 of Lot 19 Block C of Blocks ABC of Christmas Gift" value="${esc(L.record.property_name)}" required></label>
          <label class="field">Record type<select class="input" name="record_type">${state.meta.recordTypes.map(t => `<option ${t === L.record.record_type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <label class="field">District<input class="input" name="district" list="dl-d" value="${esc(L.record.district)}" required><datalist id="dl-d">${state.meta.districts.map(d => `<option>${esc(d)}</option>`).join('')}</datalist></label>
          <label class="field">Province<select class="input" name="province">${['', 'Harare', 'Bulawayo', 'Manicaland', 'Mashonaland Central', 'Mashonaland East', 'Mashonaland West', 'Masvingo', 'Matabeleland North', 'Matabeleland South', 'Midlands'].map(p => `<option value="${p}" ${p === L.record.province ? 'selected' : ''}>${p || 'Select…'}</option>`).join('')}</select></label>
          <label class="field">Date of survey<input class="input" type="date" name="survey_date" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(L.record.survey_date) ? L.record.survey_date : '')}"></label>
          <label class="field">Declared extent <span class="hint">As on the diagram</span><input class="input" name="declared_area" placeholder="e.g. 2 952,027 m²" value="${esc(L.record.declared_area)}"></label>
          <label class="field">Datum / system<input class="input" name="datum" value="${esc(L.record.datum)}"></label>
          <label class="field span-2">Related records <span class="hint">Separate with semicolons</span><input class="input" name="related_refs" placeholder="e.g. GP 64-5/18; S.G. 200/76" value="${esc(L.record.related_refs)}"></label>
          <label class="field span-2">Notes to the examiner<textarea class="input" name="notes" rows="3">${esc(L.record.notes)}</textarea></label>
        </div></section>

        <section class="card"><div class="card-h"><div class="row" style="gap:10px"><span class="step-n">2</span><div><h2>Co-ordinate list</h2><p>Lo 29, metres. Y then X.</p></div></div>
          <div class="btn-row"><label class="btn sm">${ic('upload')}Import CSV/TXT<input type="file" id="cimport" accept=".csv,.txt" hidden></label></div></div>
          <div class="card-b stack">
            <label class="field">Paste coordinates <span class="hint">One per line: name, Y, X, description, F/P · tab, comma or spaces · <a class="link" id="ex">paste example</a></span>
              <textarea class="input mono" id="paste" rows="5" placeholder="S1   -86870.757   2149368.657   12mm iron peg   P"></textarea></label>
            <div class="btn-row"><button type="button" class="btn dark sm" id="addpaste">${ic('plus')}Add to list</button><button type="button" class="btn ghost sm" id="addrow">${ic('plus')}Add a row</button><span class="faint small" id="perr"></span></div>
          </div>
          <div class="table-wrap"><table class="t dense" id="btable"></table></div>
        </section>

        <section class="card"><div class="card-h"><div class="row" style="gap:10px"><span class="step-n">3</span><div><h2>Figures</h2><p>List boundary beacons in order around each figure</p></div></div>
          <button type="button" class="btn sm" id="addfig">${ic('plus')}Add figure</button></div>
          <div class="card-b stack" id="figs"></div></section>

        <section class="card"><div class="card-h"><div class="row" style="gap:10px"><span class="step-n">4</span><div><h2>Documents</h2><p>Working plan, diagram, field book, calculations · max 15 MB each</p></div></div></div>
          <div class="card-b">
            ${existing?.documents.length ? `<p class="small muted" style="margin-bottom:10px">${existing.documents.length} document(s) already on file will be kept.</p>` : ''}
            <label class="drop" id="drop">${ic('upload')}<div><b>Drop files here</b> or click to browse</div><div class="small faint">PDF, JPG, PNG, TIFF, DWG, DXF, XLSX, CSV, TXT, DOC</div><input type="file" id="files" multiple hidden accept="${state.meta.uploadTypes.join(',')}"></label>
            <div class="filelist" id="flist"></div>
          </div></section>

        <div id="lerr"></div>
        <div class="btn-row"><button class="btn primary" type="submit" id="submit">${ic('upload')}${existing ? 'Resubmit for examination' : 'Lodge for examination'}</button><a class="btn ghost" href="#/lodgements">Cancel</a></div>
      </form>
      <aside class="stack sticky">
        <div class="plot-wrap" id="preview"></div>
        <div class="card"><div class="card-h"><h2>Live checks</h2></div><div class="card-b"><div class="checks" id="lchecks"></div></div></div>
      </aside></div>`;

    const f = $('#lf');
    const table = $('#btable');

    function drawBeacons() {
      table.innerHTML = L.beacons.length ? `<thead><tr><th>Name</th><th>Type</th><th>Y</th><th>X</th><th>Description</th><th></th></tr></thead><tbody>
        ${L.beacons.map((b, i) => `<tr data-i="${i}">
          <td><input class="input sm mono" data-k="name" value="${esc(b.name)}" style="width:90px"></td>
          <td><select class="input sm" data-k="kind" style="width:115px">${['placed', 'found', 'station', 'computed'].map(k => `<option ${k === b.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
          <td><input class="input sm mono" data-k="y" value="${esc(b.y)}" style="width:130px"></td>
          <td><input class="input sm mono" data-k="x" value="${esc(b.x)}" style="width:130px"></td>
          <td><input class="input sm" data-k="description" value="${esc(b.description || '')}"></td>
          <td class="r"><button type="button" class="btn ghost icon sm" data-del="${i}" aria-label="Remove">${ic('trash')}</button></td></tr>`).join('')}</tbody>`
        : `<tbody><tr><td class="muted center" style="padding:18px">No coordinates yet. Paste or import a list above.</td></tr></tbody>`;
      $$('input,select', table).forEach(el => el.oninput = () => { const i = +el.closest('tr').dataset.i; L.beacons[i][el.dataset.k] = el.value; update(); });
      $$('[data-del]', table).forEach(b => b.onclick = () => { L.beacons.splice(+b.dataset.del, 1); drawBeacons(); update(); });
    }

    function drawFigs() {
      $('#figs').innerHTML = L.parcels.map((p, i) => `<div class="figure-card" data-i="${i}">
        <div class="grid-3"><label class="field">Figure name<input class="input" data-k="name" value="${esc(p.name)}" placeholder="e.g. Lot 1 of Lot 19"></label>
          <label class="field span-2">Beacon order<input class="input mono" data-k="order" value="${esc(p.order)}" placeholder="S5 18A 19C S1 S2 S3 S4"></label></div>
        <div class="grid-3"><label class="field">Declared area (m²)<input class="input mono" data-k="declared_m2" value="${esc(p.declared_m2)}" placeholder="optional"></label>
          <div class="span-2 row between" style="align-items:flex-end"><div class="figure-result" data-res="${i}"></div>
          ${L.parcels.length > 1 ? `<button type="button" class="btn ghost sm" data-delfig="${i}">${ic('trash')}Remove</button>` : ''}</div></div></div>`).join('');
      $$('#figs input').forEach(el => el.oninput = () => { L.parcels[+el.closest('.figure-card').dataset.i][el.dataset.k] = el.value; update(); });
      $$('[data-delfig]').forEach(b => b.onclick = () => { L.parcels.splice(+b.dataset.delfig, 1); drawFigs(); update(); });
    }

    function computed() {
      const beacons = L.beacons.map(b => ({ ...b, y: S.parseNum(b.y), x: S.parseNum(b.x) })).filter(b => b.name && isFinite(b.y) && isFinite(b.x));
      const byName = new Map(beacons.map(b => [b.name, b]));
      const figs = L.parcels.map(p => {
        const order = String(p.order).split(/[\s,→>-]+/).map(s => s.trim()).filter(Boolean);
        const missing = order.filter(n => !byName.has(n));
        const out = { name: p.name || 'Figure', order, missing, declared: p.declared_m2 === '' ? null : S.parseNum(p.declared_m2) };
        if (order.length >= 3 && !missing.length) Object.assign(out, S.figure(order.map(n => byName.get(n))));
        return out;
      });
      return { beacons, figs };
    }

    function update() {
      const { beacons, figs } = computed();
      $('#preview').innerHTML = beacons.length ? plotSVG(beacons, figs.filter(g => g.area)) + plotLegend : empty('area', 'Plot preview', 'Your figures appear here as you enter coordinates.');
      const checks = [];
      const names = L.beacons.map(b => String(b.name).trim()).filter(Boolean);
      const dups = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
      const invalid = L.beacons.filter(b => !isFinite(S.parseNum(b.y)) || !isFinite(S.parseNum(b.x)) || !String(b.name).trim()).length;
      if (!L.beacons.length) checks.push(['info', 'Add the co-ordinate list']);
      else checks.push(dups.length ? ['fail', `Duplicate names: ${dups.join(', ')}`] : ['pass', `${beacons.length} beacons captured`]);
      if (invalid) checks.push(['fail', `${invalid} row(s) missing a name or valid coordinates`]);
      const odd = beacons.filter(b => Math.abs(b.y) > 400000 || b.x < 1600000 || b.x > 2600000);
      if (odd.length) checks.push(['warn', `Outside Lo 29 range for Zimbabwe: ${odd.map(b => b.name).join(', ')}`]);
      figs.forEach((g, i) => {
        const res = $(`[data-res="${i}"]`);
        if (g.missing.length) { checks.push(['fail', `${g.name}: unknown beacons ${g.missing.join(', ')}`]); if (res) res.innerHTML = `<span class="diff-warn">Unknown: ${esc(g.missing.join(', '))}</span>`; return; }
        if (g.order.length < 3) { if (res) res.innerHTML = '<span class="faint">Enter at least three beacons</span>'; return; }
        const diff = g.declared != null && isFinite(g.declared) ? g.area - g.declared : null;
        const ok = diff == null || Math.abs(diff) <= Math.max(0.1, g.declared * 1e-4);
        checks.push([diff == null ? 'info' : ok ? 'pass' : 'warn', `${g.name}: ${fmt(g.area, 3)} m²${diff != null ? ` (Δ ${diff >= 0 ? '+' : ''}${fmt(diff, 3)})` : ''}`]);
        if (res) res.innerHTML = `<span>Area <b>${fmt(g.area, 3)} m²</b></span><span>${fmt(g.hectares, 4)} ha</span><span>Perimeter <b>${fmt(g.perimeter, 2)} m</b></span>${diff != null ? `<span class="${ok ? 'diff-ok' : 'diff-warn'}">Δ ${diff >= 0 ? '+' : ''}${fmt(diff, 3)} m²</span>` : ''}`;
      });
      $('#lchecks').innerHTML = checks.map(([l, t]) => `<div class="check ${l}">${ic(l === 'pass' ? 'check' : l === 'info' ? 'info' : l === 'fail' ? 'x' : 'alert')}<span>${esc(t)}</span></div>`).join('');
    }

    function addParsed(text) {
      const { points, errors } = S.parseCoordinateText(text);
      points.forEach(p => {
        const kind = p.fp === 'F' ? 'found' : p.fp === 'P' ? 'placed' : /^st|^z\d/i.test(p.name) ? 'station' : /comput|helmert|not beacon/i.test(p.description) ? 'computed' : 'placed';
        const i = L.beacons.findIndex(b => b.name === p.name);
        const row = { name: p.name, y: p.y, x: p.x, z: null, kind, description: p.description };
        if (i >= 0) L.beacons[i] = row; else L.beacons.push(row);
      });
      $('#perr').textContent = errors.length ? `${errors.length} line(s) skipped: ${errors[0]}` : points.length ? `${points.length} added` : '';
      drawBeacons(); update();
      return points.length;
    }

    $('#ex').onclick = () => {
      $('#paste').value = EXAMPLE;
      if (!L.parcels[0].name && !L.parcels[0].order) { L.parcels[0] = { name: 'Lot 1 of Lot 19', order: 'S5 18A 19C S1 S2 S3 S4', declared_m2: '2952.027' }; drawFigs(); }
    };
    $('#addpaste').onclick = () => { if (addParsed($('#paste').value)) $('#paste').value = ''; };
    $('#addrow').onclick = () => { L.beacons.push({ name: '', y: '', x: '', kind: 'placed', description: '' }); drawBeacons(); update(); $$('#btable tr:last-child input')[0]?.focus(); };
    $('#cimport').onchange = async ev => { const file = ev.target.files[0]; if (file) addParsed((await file.text()).replace(/^﻿/, '').split(/\r?\n/).map(l => l.replace(/,(station|found|placed|computed|trig),/i, ',')).join('\n')); ev.target.value = ''; };
    $('#addfig').onclick = () => { L.parcels.push({ name: '', order: '', declared_m2: '' }); drawFigs(); update(); };

    const drawFiles = () => {
      $('#flist').innerHTML = L.files.map((file, i) => `<div class="fileitem">${ic('file')}<span class="grow">${esc(file.name)}</span><span class="faint small">${bytes(file.size)}</span>
        <select class="input sm" data-fk="${i}" style="width:170px">${['Working plan', 'Diagram', 'Field book', 'Calculations', 'Coordinate list', 'Area report', 'Survey drawing', 'Other'].map(k => `<option ${k === file.kind ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <button type="button" class="btn ghost icon sm" data-fdel="${i}" aria-label="Remove">${ic('x')}</button></div>`).join('');
      $$('[data-fk]').forEach(s => s.onchange = () => (L.files[+s.dataset.fk].kind = s.value));
      $$('[data-fdel]').forEach(b => b.onclick = () => { L.files.splice(+b.dataset.fdel, 1); drawFiles(); });
    };
    const guessKind = n => /field/i.test(n) ? 'Field book' : /\.dwg|\.dxf/i.test(n) ? 'Survey drawing' : /area/i.test(n) ? 'Area report' : /coord/i.test(n) ? 'Coordinate list' : /plan/i.test(n) ? 'Working plan' : /diagram/i.test(n) ? 'Diagram' : /calc|helmert/i.test(n) ? 'Calculations' : 'Other';
    const addFiles = list => {
      for (const file of list) {
        if (file.size > 15 * 1024 * 1024) { toast(`${file.name} is larger than 15 MB`, true); continue; }
        L.files.push({ file, name: file.name, size: file.size, kind: guessKind(file.name) });
      }
      drawFiles();
    };
    $('#files').onchange = ev => { addFiles(ev.target.files); ev.target.value = ''; };
    const drop = $('#drop');
    drop.ondragover = ev => { ev.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = ev => { ev.preventDefault(); drop.classList.remove('over'); addFiles(ev.dataTransfer.files); };

    const toB64 = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file); });

    f.onsubmit = async ev => {
      ev.preventDefault();
      const btn = $('#submit'); btn.disabled = true; btn.lastChild.textContent = 'Uploading…';
      const fd = Object.fromEntries(new FormData(f));
      try {
        const files = [];
        for (const x of L.files) files.push({ name: x.name, kind: x.kind, data: await toB64(x.file) });
        const body = { ...fd, beacons: L.beacons, parcels: L.parcels.filter(p => p.name || p.order).map(p => ({ ...p, order: String(p.order).split(/[\s,→>]+/).filter(Boolean) })), files };
        const out = existing ? await api(`/api/lodgements/${existing.record.id}`, { method: 'PUT', body }) : await api('/api/lodgements', { method: 'POST', body });
        toast(existing ? 'Resubmitted for examination' : `Lodged as ${out.lodgement_no}`);
        await refreshCounts();
        go(`#/records/${out.id}`);
      } catch (e) {
        $('#lerr').innerHTML = `<div class="errors"><b>${esc(e.message)}</b>${e.details ? `<ul>${e.details.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;
        $('#lerr').scrollIntoView({ behavior: 'smooth', block: 'center' });
        btn.disabled = false; btn.lastChild.textContent = existing ? 'Resubmit for examination' : 'Lodge for examination';
      }
    };

    drawBeacons(); drawFigs(); update();
  }

  // ---------- tools ----------
  const HELMERT_EXAMPLE = `17A   -87015.710   2149369.370   -87015.750   2149369.349
19C   -86906.250   2149398.000   -86906.270   2149398.054
20C   -86855.290   2149355.880   -86855.305   2149355.830
19A   -86913.780   2149285.110   -86913.832   2149285.021`;

  function pageTools(c, tool = 'area') {
    const tabs = [['area', 'Areas from coordinates', 'area'], ['helmert', 'Helmert transformation', 'transform'], ['join', 'Join', 'ruler'], ['geo', 'Lo 29 → Lat/Lon', 'globe']];
    c.innerHTML = `<div class="page-head"><div><h1>Survey tools</h1><p>The computations used by the examiner, available to every practitioner. Nothing entered here is stored.</p></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tool ? 'on' : ''}">${l}</button>`).join('')}</div><div id="tool"></div>`;
    $$('[data-t]', c).forEach(b => b.onclick = () => { history.replaceState(null, '', `#/tools?tool=${b.dataset.t}`); pageTools(c, b.dataset.t); });
    const el = $('#tool');

    if (tool === 'area') {
      el.innerHTML = `<div class="cols even"><div class="card"><div class="card-h"><div><h2>Beacons in order</h2><p>Name, Y, X — one per line, clockwise or anticlockwise</p></div><a class="link small" id="tex">Example</a></div>
        <div class="card-b stack"><textarea class="input mono" id="ta" rows="12" placeholder="S5  -86944.206  2149310.161"></textarea>
        <label class="field">Declared area (m²) <span class="hint">optional, for comparison</span><input class="input mono" id="tdecl"></label></div></div>
        <div class="stack"><div class="plot-wrap" id="tplot"></div><div class="card" id="tres"></div></div></div>`;
      const run = () => {
        const { points, errors } = S.parseCoordinateText($('#ta').value);
        if (points.length < 3) { $('#tplot').innerHTML = empty('area', 'Enter three or more beacons', 'The figure is closed back to the first beacon automatically.'); $('#tres').innerHTML = errors.length ? `<div class="card-b"><div class="notice bad">${ic('alert')}${esc(errors[0])}</div></div>` : ''; return; }
        const pts = points.map(p => ({ ...p, kind: 'found' }));
        const fig = S.figure(pts);
        const decl = S.parseNum($('#tdecl').value);
        $('#tplot').innerHTML = plotSVG(pts, [{ name: '', order: pts.map(p => p.name), area: fig.area, legs: fig.legs }]);
        $('#tres').innerHTML = `<div class="card-b"><div class="result-grid">
          <div><span>Area</span><b>${fmt(fig.area, 3)} m²</b></div><div><span>Hectares</span><b>${fmt(fig.hectares, 4)}</b></div><div><span>Perimeter</span><b>${fmt(fig.perimeter, 3)} m</b></div>
          ${isFinite(decl) ? `<div><span>Difference</span><b>${fig.area - decl >= 0 ? '+' : ''}${fmt(fig.area - decl, 3)} m²</b></div>` : ''}</div></div>
          <div class="table-wrap"><table class="t dense"><thead><tr><th>To</th><th class="r">Direction</th><th class="r">Distance</th></tr></thead><tbody>
          ${fig.legs.map(l => `<tr><td class="mono">${esc(l.from)} → ${esc(l.to)}</td><td class="r mono">${S.dms(l.direction)}</td><td class="r mono">${fmt(l.distance, 3)}</td></tr>`).join('')}</tbody></table></div>`;
      };
      $('#tex').onclick = () => { $('#ta').value = EXAMPLE.split('\n').slice(1).filter(l => !/^19A|^\s*$/.test(l)).sort((a, b) => ['S5', '18A', '19C', 'S1', 'S2', 'S3', 'S4'].indexOf(a.split(/\s+/)[0]) - ['S5', '18A', '19C', 'S1', 'S2', 'S3', 'S4'].indexOf(b.split(/\s+/)[0])).join('\n'); $('#tdecl').value = '2952.027'; run(); };
      $('#ta').oninput = run; $('#tdecl').oninput = run; run();
    }

    if (tool === 'helmert') {
      el.innerHTML = `<div class="cols even"><div class="stack"><div class="card"><div class="card-h"><div><h2>Common points</h2><p>Name, old y, old x, new Y, new X</p></div><a class="link small" id="hex">Example</a></div>
        <div class="card-b"><textarea class="input mono" id="hc" rows="7"></textarea></div></div>
        <div class="card"><div class="card-h"><div><h2>Points to transform</h2><p>Name, old y, old x</p></div></div><div class="card-b"><textarea class="input mono" id="hn" rows="5"></textarea></div></div></div>
        <div class="stack" id="hres"></div></div>`;
      const run = () => {
        const common = [], errs = [];
        $('#hc').value.split(/\r?\n/).filter(l => l.trim()).forEach((l, i) => {
          const p = l.trim().split(/[\s,;\t]+/);
          const [name, ...v] = p; const n = v.map(S.parseNum);
          if (n.length < 4 || n.some(x => !isFinite(x))) errs.push(`Line ${i + 1}`); else common.push({ name, y: n[0], x: n[1], Y: n[2], X: n[3] });
        });
        if (common.length < 2) { $('#hres').innerHTML = `<div class="card">${empty('transform', 'Two or more common points needed', 'Four or more give a least-squares solution with a standard deviation.')}</div>`; return; }
        const h = S.helmert(common);
        const others = $('#hn').value.split(/\r?\n/).filter(l => l.trim()).map(l => { const [name, y, x] = l.trim().split(/[\s,;\t]+/); const t = h.apply(S.parseNum(y), S.parseNum(x)); return { name, ...t }; }).filter(t => isFinite(t.Y));
        $('#hres').innerHTML = `<div class="card"><div class="card-h"><h2>Transformation parameters</h2>${errs.length ? `<span class="faint small">${errs.length} line(s) skipped</span>` : ''}</div><div class="card-b"><div class="result-grid">
          <div><span>CY</span><b>${h.CY.toFixed(4)}</b></div><div><span>CX</span><b>${h.CX.toFixed(4)}</b></div><div><span>A</span><b>${h.A.toFixed(10)}</b></div><div><span>B</span><b>${h.B.toFixed(10)}</b></div>
          <div><span>Scale</span><b>${h.scale.toFixed(10)}</b></div><div><span>Swing</span><b>${h.swing >= 0 ? '+' : ''}${S.dms(h.swing)}</b></div><div><span>Std. devn</span><b>${h.stdDev.toFixed(4)}</b></div>
          <div><span>Mean Y / X shift</span><b>${h.meanShiftY.toFixed(4)} / ${h.meanShiftX.toFixed(4)}</b></div></div></div></div>
          <div class="card"><div class="card-h"><h2>Residuals</h2></div><div class="table-wrap"><table class="t dense"><thead><tr><th>Point</th><th class="r">TY</th><th class="r">TX</th><th class="r">DY</th><th class="r">DX</th></tr></thead><tbody>
          ${h.residuals.map(r => `<tr><td class="mono">${esc(r.name)}</td><td class="r mono">${r.TY.toFixed(3)}</td><td class="r mono">${r.TX.toFixed(3)}</td><td class="r mono">${(r.dY >= 0 ? '+' : '') + r.dY.toFixed(4)}</td><td class="r mono">${(r.dX >= 0 ? '+' : '') + r.dX.toFixed(4)}</td></tr>`).join('')}</tbody></table></div></div>
          ${others.length ? `<div class="card"><div class="card-h"><h2>Transformed points</h2></div><div class="table-wrap"><table class="t dense"><thead><tr><th>Point</th><th class="r">Y</th><th class="r">X</th></tr></thead><tbody>
          ${others.map(o => `<tr><td class="mono">${esc(o.name)}</td><td class="r mono">${o.Y.toFixed(3)}</td><td class="r mono">${o.X.toFixed(3)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
      };
      $('#hex').onclick = () => { $('#hc').value = HELMERT_EXAMPLE; $('#hn').value = '18A   -86964.750   2149327.240'; run(); };
      $('#hc').oninput = run; $('#hn').oninput = run; run();
    }

    if (tool === 'join') {
      el.innerHTML = `<div class="card" style="max-width:720px"><div class="card-b stack">
        <div class="grid-3"><label class="field">From<input class="input mono" id="ja" value="19A"></label><label class="field">Y<input class="input mono" id="jay" value="-86913.832"></label><label class="field">X<input class="input mono" id="jax" value="2149285.021"></label></div>
        <div class="grid-3"><label class="field">To<input class="input mono" id="jb" value="18A"></label><label class="field">Y<input class="input mono" id="jby" value="-86964.806"></label><label class="field">X<input class="input mono" id="jbx" value="2149327.208"></label></div>
        <div id="jr"></div></div></div>`;
      const run = () => {
        const a = { y: S.parseNum($('#jay').value), x: S.parseNum($('#jax').value) }, b = { y: S.parseNum($('#jby').value), x: S.parseNum($('#jbx').value) };
        if (![a.y, a.x, b.y, b.x].every(isFinite)) { $('#jr').innerHTML = '<p class="muted">Enter both points.</p>'; return; }
        const j = S.join(a, b);
        $('#jr').innerHTML = `<div class="result-grid"><div><span>Direction (from south)</span><b>${S.dms(j.direction)}</b></div><div><span>Reverse</span><b>${S.dms((j.direction + 180) % 360)}</b></div>
          <div><span>Distance</span><b>${fmt(j.distance, 3)} m</b></div><div><span>ΔY</span><b>${j.dy.toFixed(3)}</b></div><div><span>ΔX</span><b>${j.dx.toFixed(3)}</b></div></div>`;
      };
      $$('#tool input').forEach(i => (i.oninput = run)); run();
    }

    if (tool === 'geo') {
      el.innerHTML = `<div class="card" style="max-width:720px"><div class="card-b stack">
        <div class="notice">${ic('info')}<div>Approximate conversion from Lo 29 (WGS 84, scale factor 1) to latitude/longitude, for locating sites on a web map. Not for cadastral computation.</div></div>
        <div class="grid-3"><label class="field">Y (m)<input class="input mono" id="gy" value="-86913.832"></label><label class="field">X (m)<input class="input mono" id="gx" value="2149285.021"></label><label class="field">Central meridian<select class="input" id="glo"><option value="27">Lo 27</option><option value="29" selected>Lo 29</option><option value="31">Lo 31</option><option value="33">Lo 33</option></select></label></div>
        <div id="gr"></div></div></div>`;
      const run = () => {
        const y = S.parseNum($('#gy').value), x = S.parseNum($('#gx').value);
        if (!isFinite(y) || !isFinite(x)) { $('#gr').innerHTML = ''; return; }
        const ll = S.loToLatLon(y, x, +$('#glo').value);
        const d = v => S.dms(Math.abs(v), 2);
        $('#gr').innerHTML = `<div class="result-grid"><div><span>Latitude</span><b>${ll.lat.toFixed(7)}°</b></div><div><span>Longitude</span><b>${ll.lon.toFixed(7)}°</b></div>
          <div><span>Latitude (DMS)</span><b>${d(ll.lat)} ${ll.lat < 0 ? 'S' : 'N'}</b></div><div><span>Longitude (DMS)</span><b>${d(ll.lon)} E</b></div></div>
          <p class="small" style="margin-top:12px"><a class="link" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${ll.lat.toFixed(6)}&mlon=${ll.lon.toFixed(6)}#map=17/${ll.lat.toFixed(6)}/${ll.lon.toFixed(6)}">Open in OpenStreetMap ↗</a></p>`;
      };
      $$('#tool input, #tool select').forEach(i => (i.oninput = run)); run();
    }
  }

  // ---------- admin ----------
  async function pageAdmin(c, tab = 'users') {
    if (state.user.role !== 'admin') { c.innerHTML = `<div class="card">${empty('shield', 'Administrators only', '')}</div>`; return; }
    c.innerHTML = `<div class="page-head"><div><h1>Users &amp; audit</h1><p>Verify practitioners and review access to survey records.</p></div></div>
      <div class="tabs"><button data-t="users" class="${tab === 'users' ? 'on' : ''}">Users</button><button data-t="audit" class="${tab === 'audit' ? 'on' : ''}">Audit log</button></div><div id="adm"></div>`;
    $$('[data-t]', c).forEach(b => b.onclick = () => { history.replaceState(null, '', `#/admin?tab=${b.dataset.t}`); pageAdmin(c, b.dataset.t); });
    const el = $('#adm');
    if (tab === 'audit') {
      const { entries } = await api('/api/audit');
      el.innerHTML = `<div class="card"><div class="table-wrap"><table class="t dense"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Target</th><th>IP</th></tr></thead><tbody>
        ${entries.map(a => `<tr><td class="muted" style="white-space:nowrap">${date(a.created_at, true)}</td><td>${esc(a.user_name || '—')}${a.user_role ? ` <span class="faint small">${esc(a.user_role)}</span>` : ''}</td>
          <td><span class="tag">${esc(a.action.replace(/_/g, ' '))}</span></td><td class="mono small">${esc(a.target || '')}</td><td class="faint mono small">${esc(a.ip || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
      return;
    }
    const { users } = await api('/api/users');
    el.innerHTML = `<div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Role</th><th>Registration</th><th>Organisation</th><th>Joined</th><th>Status</th><th class="r">Actions</th></tr></thead><tbody>
      ${users.map(u => `<tr><td><div class="title">${esc(u.name)}</div><div class="sub">${esc(u.email)}</div></td><td style="text-transform:capitalize">${esc(u.role)}</td>
        <td class="mono small">${esc(u.reg_no || '—')}</td><td class="muted">${esc(u.organisation || '—')}</td><td class="muted">${date(u.created_at)}</td><td>${badge(u.status)}</td>
        <td class="r">${u.id === state.user.id ? '<span class="faint small">You</span>' : `<div class="btn-row" style="justify-content:flex-end">
          ${u.status !== 'active' ? `<button class="btn primary sm" data-u="${u.id}" data-s="active">${ic('check')}${u.status === 'pending' ? 'Verify' : 'Reactivate'}</button>` : ''}
          ${u.status === 'active' ? `<button class="btn sm danger" data-u="${u.id}" data-s="suspended">Suspend</button>` : ''}</div>`}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    $$('[data-u]', el).forEach(b => b.onclick = async () => {
      try { await api(`/api/users/${b.dataset.u}`, { method: 'PATCH', body: { status: b.dataset.s } }); toast(b.dataset.s === 'active' ? 'Account activated' : 'Account suspended'); await refreshCounts(); shell('admin'); pageAdmin(c, 'users'); }
      catch (e) { toast(e.message, true); }
    });
  }

  // ---------- boot ----------
  (async () => {
    try {
      const { user } = await api('/api/auth/me');
      state.user = user;
      if (user) await refreshCounts();
    } catch { /* offline */ }
    route();
  })();
})();
