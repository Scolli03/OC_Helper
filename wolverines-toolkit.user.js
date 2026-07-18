// ==UserScript==
// @name         Wolverines Toolkit
// @namespace    tornjunkie.wolverines
// @version      1.0.0
// @description  Torn Junkie multi-tool for the Wolverines family: OC CPR gates, role weights, travel/hosp blockers, and a status-bar launcher.
// @author       Torn Junkie
// @match        https://www.torn.com/*
// @icon         https://www.torn.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.torn.com
// @connect      tornprobability.com
// @run-at       document-end
// @updateURL    https://scriptserver.tornjunkie.com/?script=wolverines-toolkit
// @downloadURL  https://scriptserver.tornjunkie.com/?script=wolverines-toolkit
// ==/UserScript==

/* global GM_xmlhttpRequest, GM_addStyle, GM_getValue, GM_setValue */

(function () {
  'use strict';

  // Injected by script server at serve time
  const thresholds = __CPR_MINS__;
  const FEATURES = __FEATURES__;

  const APP_PREFIX = 'tj-wolve';
  const APP_TITLE = 'Wolverines Toolkit';
  const APP_SUB = 'Torn Junkie | Wolverines Family';
  const USERSCRIPT_VERSION = '1.0.0';
  const PDA_API_KEY_PLACEHOLDER = '###PDA' + '-APIKEY###';
  const API_BASE = 'https://api.torn.com/v2';
  const WEIGHTS_API = 'https://tornprobability.com:3000/api/GetRoleWeights';

  let API_KEY = '###PDA-APIKEY###';

  const SK = {
    apiKey: 'apiKey',
    playerId: 'playerId',
    playerName: 'playerName',
    settings: 'settings'
  };

  const DEFAULT_SETTINGS = {
    cprGate: true,
    roleWeights: true,
    ocBlocker: true,
    hospBlocker: true
  };

  const CUSTOM_KEY_TITLE = 'WolveToolkit';
  const CUSTOM_KEY_USER_SELECTIONS = 'basic,profile,cooldowns,organizedcrimes';
  const CUSTOM_KEY_USER_HELP = {
    basic: 'Minimal user info required for v2 user endpoints',
    profile: 'Your name and player ID (settings header)',
    cooldowns: 'Hospital / drug / booster timers used by conflict checks',
    organizedcrimes: 'Your active OC ready time for travel conflict blocking'
  };
  const CUSTOM_KEY_NOT_REQUESTED =
    'cash, bank, stocks, net worth, battlestats, personalstats, skills, faction funds, inventory';

  const TOOL_CATALOG = [
    {
      id: 'oc-tool',
      title: 'Organized Crimes',
      blurb: 'CPR pass/fail on role slots, role weights, and travel/hosp conflict blocking.',
      modules: ['cpr-gate', 'role-weights', 'oc-blocker']
    }
  ];

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function hasFeature(id) {
    if (!Array.isArray(FEATURES) || !FEATURES.length) return true;
    return FEATURES.includes(id);
  }

  // =====================================================================
  // Store
  // =====================================================================
  const Store = {
    get(key, def) {
      try {
        if (hasGM) {
          const v = GM_getValue(key, undefined);
          return v === undefined ? def : v;
        }
        const raw = localStorage.getItem(`${APP_PREFIX}:${key}`);
        return raw === null ? def : raw;
      } catch (e) { return def; }
    },
    set(key, value) {
      try {
        if (hasGM) { GM_setValue(key, value); return; }
        localStorage.setItem(`${APP_PREFIX}:${key}`, value);
      } catch (e) { /* ignore */ }
    },
    getJSON(key, def) {
      const raw = this.get(key, undefined);
      if (raw === undefined || raw === null) return def;
      if (typeof raw === 'object') return raw;
      try { return JSON.parse(raw); } catch (e) { return def; }
    },
    setJSON(key, value) {
      if (hasGM) { this.set(key, value); return; }
      this.set(key, JSON.stringify(value));
    },
    remove(key) {
      try {
        if (hasGM) { GM_setValue(key, undefined); return; }
        localStorage.removeItem(`${APP_PREFIX}:${key}`);
      } catch (e) { /* ignore */ }
    }
  };

  function loadSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, Store.getJSON(SK.settings, null) || {});
  }
  function saveSettings(s) { Store.setJSON(SK.settings, s); }

  function isPlaceholder(key) {
    return !key || key === PDA_API_KEY_PLACEHOLDER || key.indexOf('###PDA') === 0;
  }

  function ensureApiKey() {
    if (!isPlaceholder(API_KEY)) return API_KEY;
    const stored = Store.get(SK.apiKey, '');
    if (stored && !isPlaceholder(stored)) {
      API_KEY = stored;
      return API_KEY;
    }
    return null;
  }

  function detectPDA() {
    try {
      return !!(window.flutter_inappwebview && window.flutter_inappwebview.callHandler);
    } catch (e) { return false; }
  }

  // =====================================================================
  // API helpers
  // =====================================================================
  function gmGet(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        fetch(url).then((r) => r.text()).then(resolve).catch(reject);
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve(res.responseText);
          else reject(new Error('HTTP ' + res.status));
        },
        onerror: () => reject(new Error('Network error'))
      });
    });
  }

  async function apiGet(path) {
    const key = ensureApiKey();
    if (!key) throw new Error('No API key set');
    const url = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}comment=WolveToolkit&key=${encodeURIComponent(key)}`;
    const text = await gmGet(url);
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Invalid API JSON'); }
    if (data && data.error) {
      const code = data.error.code;
      const msg = data.error.error || 'Torn API error';
      throw new Error(code != null ? `${msg} (code ${code})` : msg);
    }
    return data;
  }

  // =====================================================================
  // Theme (Torn Junkie shell)
  // =====================================================================
  function applyTheme() {
    const css = `
      :root{
        --tj-bg-0:#0b0b12; --tj-bg-1:#12071f;
        --tj-text:#e5e7eb; --tj-muted:#9ca3af;
        --tj-accent-1:#a855f7; --tj-accent-2:#ec4899; --tj-accent-3:#22d3ee;
        --tj-good:#34d399; --tj-warn:#fbbf24; --tj-bad:#f87171;
        --tj-shadow:0 18px 60px rgba(0,0,0,.55); --tj-radius:14px;
      }
      #${APP_PREFIX}-overlay{
        position:fixed; inset:0; z-index:2147483646; display:none; overflow:auto;
        background:rgba(0,0,0,.72);
        font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
      }
      #${APP_PREFIX}-overlay.active{ display:block; }
      #${APP_PREFIX}-overlay .tj-panel{
        min-height:100vh; padding:18px 14px 40px;
        background:linear-gradient(135deg,var(--tj-bg-0) 0%,#1f0a37 40%,var(--tj-bg-0) 100%);
      }
      #${APP_PREFIX}-overlay .tj-topbar{
        position:sticky; top:0; z-index:2; background:rgba(0,0,0,.45);
        backdrop-filter:blur(10px); border-bottom:1px solid rgba(168,85,247,.25);
        padding:14px 10px; margin:-18px -14px 16px;
      }
      #${APP_PREFIX}-overlay .tj-topbar-inner{
        max-width:960px; margin:0 auto; display:flex; gap:10px; align-items:center;
        justify-content:space-between; flex-wrap:wrap;
      }
      #${APP_PREFIX}-overlay .tj-brand h1{
        margin:0; font-size:22px; font-weight:800;
        background:linear-gradient(90deg,var(--tj-accent-1),var(--tj-accent-2));
        -webkit-background-clip:text; background-clip:text; color:transparent;
      }
      #${APP_PREFIX}-overlay .tj-brand .tj-sub{ color:var(--tj-muted); font-size:12px; }
      #${APP_PREFIX}-overlay .tj-actions{ display:flex; gap:8px; align-items:center; }
      #${APP_PREFIX}-overlay .tj-btn{
        cursor:pointer; border:1px solid rgba(168,85,247,.35); border-radius:10px;
        background:rgba(17,24,39,.6); color:var(--tj-text); padding:9px 12px; font-weight:700;
        font-size:13px; user-select:none;
      }
      #${APP_PREFIX}-overlay .tj-btn:hover{ background:rgba(17,24,39,.85); border-color:rgba(236,72,153,.55); }
      #${APP_PREFIX}-overlay .tj-btn.primary{
        background:linear-gradient(90deg,rgba(168,85,247,.95),rgba(236,72,153,.92));
        border-color:rgba(236,72,153,.65); color:#fff;
      }
      #${APP_PREFIX}-overlay .tj-close{ width:38px; height:38px; border-radius:12px; padding:0; display:inline-flex; align-items:center; justify-content:center; }
      #${APP_PREFIX}-overlay input[type="text"],#${APP_PREFIX}-overlay input[type="password"]{
        background:rgba(17,24,39,.75); color:var(--tj-text); border:1px solid rgba(168,85,247,.35);
        border-radius:10px; padding:9px 11px; outline:none; font-size:13px; width:100%; box-sizing:border-box;
      }
      #${APP_PREFIX}-overlay a{ color:var(--tj-accent-3); }
      #${APP_PREFIX}-overlay .tj-grid{ max-width:960px; margin:0 auto; display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
      @media (max-width:800px){ #${APP_PREFIX}-overlay .tj-grid{ grid-template-columns:1fr; } }
      #${APP_PREFIX}-overlay .tj-card{
        border:1px solid rgba(168,85,247,.25); border-radius:var(--tj-radius);
        background:rgba(17,24,39,.62); box-shadow:var(--tj-shadow); padding:16px; color:var(--tj-text);
        cursor:default;
      }
      #${APP_PREFIX}-overlay .tj-card.clickable{ cursor:pointer; transition:border-color .12s ease, transform .12s ease; }
      #${APP_PREFIX}-overlay .tj-card.clickable:hover{ border-color:rgba(236,72,153,.55); transform:translateY(-1px); }
      #${APP_PREFIX}-overlay .tj-card h2{ margin:0 0 8px; font-size:16px; }
      #${APP_PREFIX}-overlay .tj-card h3{ margin:16px 0 8px; font-size:14px; }
      #${APP_PREFIX}-overlay .tj-muted{ color:var(--tj-muted); }
      #${APP_PREFIX}-overlay .tj-field{ display:flex; flex-direction:column; gap:5px; margin-bottom:12px; }
      #${APP_PREFIX}-overlay .tj-field label{ font-size:12px; color:var(--tj-muted); }
      #${APP_PREFIX}-overlay .tj-foot{ max-width:960px; margin:18px auto 0; text-align:center; color:var(--tj-muted); font-size:11px; }
      #${APP_PREFIX}-overlay .tj-row2{ display:flex; gap:12px; flex-wrap:wrap; }
      #${APP_PREFIX}-overlay .tj-row2 > *{ flex:1; min-width:140px; }
      #${APP_PREFIX}-overlay .tj-toggle{ display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid rgba(255,255,255,.06); }
      #${APP_PREFIX}-overlay .tj-toggle:last-child{ border-bottom:none; }
      #${APP_PREFIX}-overlay table{ width:100%; border-collapse:collapse; font-size:12px; }
      #${APP_PREFIX}-overlay th,#${APP_PREFIX}-overlay td{ text-align:left; padding:6px 8px; border-bottom:1px solid rgba(255,255,255,.06); }
      #${APP_PREFIX}-overlay th{ color:var(--tj-muted); font-weight:700; text-transform:uppercase; font-size:11px; }
      #${APP_PREFIX}-icon-anchor{ display:flex; align-items:center; justify-content:center; width:17px; height:17px; cursor:pointer; }
      .${APP_PREFIX}-cpr-dot{
        display:inline-block; width:12px; height:12px; border-radius:50%; margin-left:6px; vertical-align:middle;
      }
      .${APP_PREFIX}-weight-box{
        margin-top:6px; padding:6px; text-align:center;
        border:1px solid rgba(168,85,247,.25); border-radius:6px; background:rgba(168,85,247,.08);
        font-size:11px; color:#e5e7eb;
      }
      .${APP_PREFIX}-weight-box .label{ display:block; opacity:.8; text-transform:uppercase; letter-spacing:.05em; margin-bottom:2px; }
      .${APP_PREFIX}-weight-box .value{ display:block; font-size:15px; font-weight:700; }
      #${APP_PREFIX}-block-banner{
        position:fixed; left:12px; right:12px; bottom:12px; z-index:2147483645;
        background:rgba(17,24,39,.95); border:1px solid rgba(248,113,113,.55); border-radius:12px;
        color:#e5e7eb; padding:12px 14px; box-shadow:var(--tj-shadow);
        font-family:ui-sans-serif,system-ui,sans-serif; font-size:13px; display:none;
      }
      #${APP_PREFIX}-block-banner.active{ display:block; }
      #${APP_PREFIX}-block-banner strong{ color:var(--tj-bad); }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }
  }

  // =====================================================================
  // Notifications
  // =====================================================================
  function browserNotify(title, body) {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'granted') {
        new Notification(title, { body, icon: 'https://www.torn.com/favicon.ico' });
      }
    } catch (e) { /* ignore */ }
  }

  function pdaToast(message) {
    try {
      if (!detectPDA()) return;
      window.flutter_inappwebview.callHandler('scheduleNotification', {
        title: APP_TITLE,
        id: Date.now() % 100000,
        timestamp: Math.floor(Date.now() / 1000) + 1,
        launchNativeToast: true,
        toastMessage: message || '',
        toastColor: 'purple',
        toastDurationSeconds: 4,
        urlCallback: 'https://www.torn.com'
      });
    } catch (e) { /* ignore */ }
  }

  // =====================================================================
  // API key UI
  // =====================================================================
  function buildCustomApiKeyUrl() {
    const q = [
      'step=addNewKey',
      'title=' + CUSTOM_KEY_TITLE,
      'user=' + CUSTOM_KEY_USER_SELECTIONS
    ].join('&');
    return 'https://www.torn.com/preferences.php#tab=api?' + q;
  }

  function renderApiKeyAccessBreakdownHtml() {
    const userRows = CUSTOM_KEY_USER_SELECTIONS.split(',').map((sel) =>
      `<tr><td>user</td><td>${sel}</td><td>${CUSTOM_KEY_USER_HELP[sel] || ''}</td></tr>`
    ).join('');
    return `
      <div class="tj-api-key-breakdown" style="margin-top:12px;">
        <h3>What the custom API key accesses</h3>
        <p class="tj-muted" style="margin:0 0 8px;">The <b>Create custom API key</b> button opens Torn with key name <b>${CUSTOM_KEY_TITLE}</b> and only the permissions below.</p>
        <p class="tj-muted" style="margin:0 0 10px;font-size:12px;"><b>Not requested:</b> ${CUSTOM_KEY_NOT_REQUESTED}.</p>
        <table>
          <thead><tr><th>Section</th><th>Selection</th><th>Used for</th></tr></thead>
          <tbody>${userRows}</tbody>
        </table>
      </div>`;
  }

  function htmlApiKeyCreateButtonsBlock() {
    return `
      <div class="tj-row2" style="margin-top:10px;">
        <button type="button" class="tj-btn primary" id="${APP_PREFIX}-open-custom-key">Create custom API key</button>
        <button type="button" class="tj-btn" id="${APP_PREFIX}-copy-custom-key-url">Copy key-setup link</button>
      </div>
      <p class="tj-muted" style="margin-top:8px;font-size:12px;">If the button does nothing (popup blocked), use <b>Copy key-setup link</b> and open it while logged into Torn.</p>`;
  }

  function bindCustomApiKeyActions(root) {
    const openBtn = root.querySelector(`#${APP_PREFIX}-open-custom-key`);
    if (openBtn) openBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const url = buildCustomApiKeyUrl();
      const w = window.open(url, '_blank');
      if (!w) window.location.assign(url);
    });
    const copyBtn = root.querySelector(`#${APP_PREFIX}-copy-custom-key-url`);
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const url = buildCustomApiKeyUrl();
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy key-setup link'; }, 2500);
      } catch (err) {
        window.prompt('Copy this URL and open it in your browser:', url);
      }
    });
  }

  function bindSaveApiKeyForm(root, onSuccess) {
    const saveBtn = root.querySelector(`#${APP_PREFIX}-key-save`);
    if (!saveBtn) return;
    saveBtn.addEventListener('click', async () => {
      const inp = root.querySelector(`#${APP_PREFIX}-key-input`);
      const msg = root.querySelector(`#${APP_PREFIX}-key-msg`);
      const v = (inp && inp.value || '').trim();
      if (!v) { if (msg) msg.textContent = 'Please enter a key.'; return; }
      if (msg) msg.textContent = 'Validating...';
      const prevKey = Store.get(SK.apiKey, '') || API_KEY;
      API_KEY = v;
      try {
        const me = await apiGet('/user/profile');
        const profile = me.profile || me;
        Store.set(SK.apiKey, v);
        Store.set(SK.playerId, String(profile.id || me.id || ''));
        Store.set(SK.playerName, profile.name || me.name || '');
        if (msg) msg.textContent = 'Saved.';
        if (onSuccess) await onSuccess();
      } catch (e) {
        API_KEY = PDA_API_KEY_PLACEHOLDER;
        if (prevKey && !isPlaceholder(prevKey)) {
          Store.set(SK.apiKey, prevKey);
          API_KEY = prevKey;
        } else {
          Store.remove(SK.apiKey);
        }
        if (msg) msg.textContent = 'Invalid key: ' + e.message;
      }
    });
  }

  // =====================================================================
  // Overlay + tool picker
  // =====================================================================
  let overlayEl = null;
  let currentView = 'picker'; // picker | oc

  function createOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = `${APP_PREFIX}-overlay`;
    overlayEl.innerHTML = `
      <div class="tj-panel">
        <div class="tj-topbar">
          <div class="tj-topbar-inner">
            <div class="tj-brand">
              <h1 id="${APP_PREFIX}-heading">${APP_TITLE}</h1>
              <div class="tj-sub">${APP_SUB} · v${USERSCRIPT_VERSION}</div>
            </div>
            <div class="tj-actions">
              <button type="button" class="tj-btn" id="${APP_PREFIX}-back" style="display:none;">Back</button>
              <button type="button" class="tj-btn tj-close" id="${APP_PREFIX}-close" title="Close">X</button>
            </div>
          </div>
        </div>
        <div id="${APP_PREFIX}-body"></div>
        <div class="tj-foot">Torn Junkie toolkit - estimates and page hints only. Not affiliated with Torn.</div>
      </div>`;
    document.body.appendChild(overlayEl);
    overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) closeOverlay(); });
    overlayEl.querySelector(`#${APP_PREFIX}-close`).addEventListener('click', closeOverlay);
    overlayEl.querySelector(`#${APP_PREFIX}-back`).addEventListener('click', () => {
      currentView = 'picker';
      renderBody();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlayEl && overlayEl.classList.contains('active')) closeOverlay();
    });
    return overlayEl;
  }

  function openOverlay() {
    createOverlay();
    currentView = 'picker';
    overlayEl.classList.add('active');
    renderBody();
  }

  function closeOverlay() {
    if (overlayEl) overlayEl.classList.remove('active');
  }

  function setHeading(title) {
    const el = overlayEl && overlayEl.querySelector(`#${APP_PREFIX}-heading`);
    if (el) el.textContent = title;
    const back = overlayEl && overlayEl.querySelector(`#${APP_PREFIX}-back`);
    if (back) back.style.display = currentView === 'picker' ? 'none' : 'inline-flex';
  }

  function entitledTools() {
    return TOOL_CATALOG.filter((t) => hasFeature(t.id) || t.modules.some(hasFeature));
  }

  function renderPicker() {
    const tools = entitledTools();
    if (!tools.length) {
      return `<div class="tj-grid"><div class="tj-card full"><h2>No tools enabled</h2>
        <p class="tj-muted">Your install token has no toolkit features. Ask leadership to reissue your URL.</p></div></div>`;
    }
    const cards = tools.map((t) => `
      <div class="tj-card clickable" data-tool="${t.id}">
        <h2>${t.title}</h2>
        <p class="tj-muted">${t.blurb}</p>
        <p class="tj-muted" style="margin-top:10px;font-size:12px;">Open settings</p>
      </div>`).join('');
    return `<div class="tj-grid">${cards}</div>`;
  }

  function renderOcTool() {
    const s = loadSettings();
    const keyOk = !!ensureApiKey();
    const pda = detectPDA();
    return `
      <div class="tj-grid">
        <div class="tj-card full">
          <h2>Organized Crimes</h2>
          <p class="tj-muted">Green = CPR meets your faction minimum. Red = below minimum. Role weights come from tornprobability.com. Travel/hosp blocker uses your API key when enabled.</p>
          <div class="tj-toggle"><div><b>CPR gate</b><div class="tj-muted" style="font-size:12px;">Pass/fail dots on OC roles</div></div>
            <input type="checkbox" id="${APP_PREFIX}-tog-cpr" ${s.cprGate ? 'checked' : ''} ${hasFeature('cpr-gate') ? '' : 'disabled'}></div>
          <div class="tj-toggle"><div><b>Role weights</b><div class="tj-muted" style="font-size:12px;">Show weight % under each role</div></div>
            <input type="checkbox" id="${APP_PREFIX}-tog-weights" ${s.roleWeights ? 'checked' : ''} ${hasFeature('role-weights') ? '' : 'disabled'}></div>
          <div class="tj-toggle"><div><b>Travel blocker</b><div class="tj-muted" style="font-size:12px;">Warn when a trip would miss your OC</div></div>
            <input type="checkbox" id="${APP_PREFIX}-tog-travel" ${s.ocBlocker ? 'checked' : ''} ${hasFeature('oc-blocker') ? '' : 'disabled'}></div>
          <div class="tj-toggle"><div><b>Hospital conflict hint</b><div class="tj-muted" style="font-size:12px;">Warn when hosp time may overlap OC ready</div></div>
            <input type="checkbox" id="${APP_PREFIX}-tog-hosp" ${s.hospBlocker ? 'checked' : ''} ${hasFeature('oc-blocker') ? '' : 'disabled'}></div>
        </div>
        <div class="tj-card full">
          <h2>API key ${keyOk ? '(saved)' : '(needed for blocker)'}</h2>
          ${pda ? `<p class="tj-muted">Torn PDA detected. Prefer PDA <b>Set separate API key</b> for this script, or paste a browser key below.</p>` : ''}
          <div class="tj-field">
            <label for="${APP_PREFIX}-key-input">Torn API key</label>
            <input type="password" id="${APP_PREFIX}-key-input" placeholder="${keyOk ? 'Key saved - paste to replace' : 'Paste limited key'}" autocomplete="off">
          </div>
          <div class="tj-row2">
            <button type="button" class="tj-btn primary" id="${APP_PREFIX}-key-save">Save key</button>
          </div>
          <p class="tj-muted" id="${APP_PREFIX}-key-msg" style="margin-top:8px;"></p>
          ${htmlApiKeyCreateButtonsBlock()}
          ${renderApiKeyAccessBreakdownHtml()}
        </div>
      </div>`;
  }

  function bindOcTool(root) {
    const s = loadSettings();
    const map = [
      [`#${APP_PREFIX}-tog-cpr`, 'cprGate'],
      [`#${APP_PREFIX}-tog-weights`, 'roleWeights'],
      [`#${APP_PREFIX}-tog-travel`, 'ocBlocker'],
      [`#${APP_PREFIX}-tog-hosp`, 'hospBlocker']
    ];
    map.forEach(([sel, key]) => {
      const el = root.querySelector(sel);
      if (!el) return;
      el.addEventListener('change', () => {
        s[key] = !!el.checked;
        saveSettings(s);
        schedulePageEffects();
      });
    });
    bindCustomApiKeyActions(root);
    bindSaveApiKeyForm(root, async () => { schedulePageEffects(); });
  }

  function renderBody() {
    createOverlay();
    const body = overlayEl.querySelector(`#${APP_PREFIX}-body`);
    if (currentView === 'oc') {
      setHeading('Organized Crimes');
      body.innerHTML = renderOcTool();
      bindOcTool(body);
      return;
    }
    setHeading(APP_TITLE);
    body.innerHTML = renderPicker();
    body.querySelectorAll('[data-tool]').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-tool');
        if (id === 'oc-tool') {
          currentView = 'oc';
          renderBody();
        }
      });
    });
  }

  // =====================================================================
  // Status icon
  // =====================================================================
  function injectStatusIcon() {
    const ICON_LI = `${APP_PREFIX}-icon-li`;
    const ICON_A = `${APP_PREFIX}-icon-anchor`;
    const tryInject = () => {
      const bar = document.querySelector('ul[class*="status-icons"]');
      if (!bar) return false;
      if (document.getElementById(ICON_LI)) return true;
      const li = document.createElement('li');
      li.id = ICON_LI;
      li.style.background = 'none';
      const a = document.createElement('a');
      a.id = ICON_A;
      a.href = '#';
      a.title = APP_TITLE;
      // Placeholder wolverine-claw style mark; replace when final icon is ready
      a.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="#a855f7" d="M3 4l3.5 16h2.2L6.2 4H3zm5.5 0l3.2 16h2.2L10.9 4H8.5zm5.5 0l2.9 16h2.2L16.4 4h-2.4zm5.2 0l1.6 16H23L21.2 4h-2z"/></svg>';
      a.addEventListener('click', (e) => { e.preventDefault(); openOverlay(); });
      li.appendChild(a);
      bar.appendChild(li);
      return true;
    };
    if (tryInject()) return;
    const iv = setInterval(() => { if (tryInject()) clearInterval(iv); }, 700);
    setTimeout(() => clearInterval(iv), 40000);
  }

  // =====================================================================
  // OC page effects: CPR + weights
  // =====================================================================
  let weightData = null;
  let weightsLoading = false;

  function normalize(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function attachTooltip(target, text) {
    const tip = document.createElement('div');
    tip.textContent = text;
    tip.style.cssText = 'position:absolute;background:#000;color:#fff;padding:3px 6px;font-size:11px;border-radius:4px;white-space:nowrap;z-index:99999;display:none;pointer-events:none;';
    document.body.appendChild(tip);
    target.addEventListener('mouseenter', () => {
      const rect = target.getBoundingClientRect();
      tip.style.left = (rect.right + 10 + window.scrollX) + 'px';
      tip.style.top = (rect.top + window.scrollY + 2) + 'px';
      tip.style.display = 'block';
    });
    target.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  function makeCprDot(currentValue, required) {
    const c = document.createElement('span');
    c.className = `${APP_PREFIX}-cpr-dot`;
    const pass = required === 'always' || currentValue >= required;
    c.style.background = pass ? 'var(--tj-good, #34d399)' : 'var(--tj-bad, #f87171)';
    attachTooltip(
      c,
      required === 'always'
        ? 'Always allowed'
        : `Required: ${required}, Current: ${currentValue}`
    );
    return c;
  }

  function getThresholdFor(crimeName, roleName) {
    if (!thresholds || typeof thresholds !== 'object') return null;
    const direct = thresholds[crimeName];
    if (direct && roleName in direct) return direct[roleName];
    const crimeKey = Object.keys(thresholds).find((k) => normalize(k) === normalize(crimeName));
    if (!crimeKey) return null;
    const roles = thresholds[crimeKey] || {};
    const roleKey = Object.keys(roles).find((k) => normalize(k) === normalize(roleName));
    return roleKey != null ? roles[roleKey] : null;
  }

  function processCprOnOc(ocRoot) {
    const s = loadSettings();
    if (!s.cprGate || !hasFeature('cpr-gate')) return;
    const titleEl = ocRoot.querySelector('[class^="panelTitle___"]');
    const crimeName = titleEl ? titleEl.textContent.trim() : null;
    if (!crimeName) return;

    const roles = Array.from(
      ocRoot.querySelectorAll('[class^="contentLayer___"] > [class^="wrapper___"] > [class^="wrapper___"]')
    );
    roles.forEach((role) => {
      if (role.querySelector(`.${APP_PREFIX}-cpr-dot`)) return;
      const roleName = (role.querySelector('[class^="title___"]')?.textContent || '').trim();
      if (!roleName) return;
      const required = getThresholdFor(crimeName, roleName);
      if (required == null) return;

      // CPR value: look for a numeric sibling/descendant near success chance
      let valueElem = null;
      const candidates = role.querySelectorAll('div, span, p');
      for (const el of candidates) {
        if (el.querySelector(`.${APP_PREFIX}-cpr-dot`)) continue;
        const t = (el.childNodes.length === 1 && el.firstChild && el.firstChild.nodeType === 3)
          ? el.textContent.trim()
          : '';
        if (/^\d{1,3}$/.test(t)) {
          valueElem = el;
          break;
        }
      }
      if (!valueElem) {
        // Fallback: text-walk style next sibling of role title parent
        const title = role.querySelector('[class^="title___"]');
        const sib = title && title.parentElement && title.parentElement.nextElementSibling;
        if (sib && /^\d{1,3}/.test(sib.textContent.trim())) valueElem = sib;
      }
      if (!valueElem) return;
      const currentValue = parseInt(valueElem.textContent.trim(), 10);
      if (Number.isNaN(currentValue)) return;
      valueElem.appendChild(makeCprDot(currentValue, required));
    });
  }

  function processWeightsOnOc(ocRoot) {
    const s = loadSettings();
    if (!s.roleWeights || !hasFeature('role-weights') || !weightData) return;
    const titleEl = ocRoot.querySelector('[class^="panelTitle___"]');
    const crimeName = titleEl ? titleEl.textContent.trim() : null;
    if (!crimeName) return;
    const ocWeights = weightData[normalize(crimeName)];
    if (!ocWeights) return;

    const roles = Array.from(
      ocRoot.querySelectorAll('[class^="contentLayer___"] > [class^="wrapper___"] > [class^="wrapper___"]')
    );
    roles.forEach((role) => {
      if (role.querySelector(`.${APP_PREFIX}-weight-box`)) return;
      const roleName = (role.querySelector('[class^="title___"]')?.textContent || '').trim();
      const weight = ocWeights[normalize(roleName)];
      if (weight == null) return;
      const box = document.createElement('div');
      box.className = `${APP_PREFIX}-weight-box`;
      box.innerHTML = `<span class="label">Weight</span><span class="value">${Number(weight).toFixed(1)}%</span>`;
      role.appendChild(box);
    });
  }

  function scanOcPage() {
    if (!/factions\.php/i.test(location.href) && !/organizedcrimes\.php/i.test(location.href)) return;
    const ocs = Array.from(document.querySelectorAll('div[class^="wrapper___"][data-oc-id]'));
    ocs.forEach((oc) => {
      processCprOnOc(oc);
      processWeightsOnOc(oc);
    });
  }

  function loadWeights() {
    if (weightsLoading || weightData || !hasFeature('role-weights')) return;
    weightsLoading = true;
    const done = (text) => {
      try {
        const data = JSON.parse(text);
        weightData = {};
        Object.entries(data).forEach(([ocName, roles]) => {
          const ocKey = normalize(ocName);
          weightData[ocKey] = {};
          Object.entries(roles || {}).forEach(([roleName, value]) => {
            weightData[ocKey][normalize(roleName)] = value;
          });
        });
        scanOcPage();
      } catch (err) {
        console.error('[WolveToolkit] Failed to parse weights:', err);
      } finally {
        weightsLoading = false;
      }
    };
    if (typeof GM_xmlhttpRequest === 'function') {
      GM_xmlhttpRequest({
        method: 'GET',
        url: WEIGHTS_API,
        onload: (r) => done(r.responseText),
        onerror: () => { weightsLoading = false; console.error('[WolveToolkit] Weights request failed'); }
      });
    } else {
      fetch(WEIGHTS_API).then((r) => r.text()).then(done).catch(() => { weightsLoading = false; });
    }
  }

  // =====================================================================
  // Travel / hosp blocker
  // =====================================================================
  let lastOcReadyTs = null;
  let blockBannerEl = null;

  function showBlockBanner(reason) {
    if (!blockBannerEl) {
      blockBannerEl = document.createElement('div');
      blockBannerEl.id = `${APP_PREFIX}-block-banner`;
      document.body.appendChild(blockBannerEl);
    }
    blockBannerEl.innerHTML = `<strong>OC conflict:</strong> ${reason}`;
    blockBannerEl.classList.add('active');
    browserNotify(APP_TITLE, reason);
    pdaToast(reason);
  }

  function hideBlockBanner() {
    if (blockBannerEl) blockBannerEl.classList.remove('active');
  }

  async function refreshOcReadyTime() {
    if (!hasFeature('oc-blocker')) return null;
    const s = loadSettings();
    if (!s.ocBlocker && !s.hospBlocker) return null;
    if (!ensureApiKey()) return null;
    try {
      const data = await apiGet('/user?selections=organizedcrimes,cooldowns');
      const ocs = data.organizedcrimes || data.organizedCrimes || [];
      let soonest = null;
      (Array.isArray(ocs) ? ocs : Object.values(ocs || {})).forEach((oc) => {
        const ready = oc.ready_at || oc.readyAt || oc.time_ready || oc.execute_time;
        if (ready && (!soonest || ready < soonest)) soonest = ready;
      });
      lastOcReadyTs = soonest;
      const cds = data.cooldowns || {};
      return { ocReady: soonest, hospital: cds.medical || cds.hospital || 0 };
    } catch (e) {
      console.warn('[WolveToolkit] OC ready fetch failed:', e.message);
      return null;
    }
  }

  function parseFlightSecondsFromTravelPage() {
    // Best-effort: read selected destination flight time text like "2h 15m"
    const text = document.body.innerText || '';
    const m = text.match(/(\d+)\s*h(?:ours?)?\s*(\d+)\s*m/i) || text.match(/(\d+)\s*:\s*(\d{2})/);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mins = parseInt(m[2], 10);
    if (Number.isNaN(h) || Number.isNaN(mins)) return null;
    return (h * 3600) + (mins * 60);
  }

  async function evaluateTravelBlock() {
    const s = loadSettings();
    if (!s.ocBlocker || !hasFeature('oc-blocker')) { hideBlockBanner(); return; }
    if (!/sid=travel|travel\.php/i.test(location.href + location.search)) { hideBlockBanner(); return; }
    const info = await refreshOcReadyTime();
    const ocTime = (info && info.ocReady) || lastOcReadyTs;
    if (!ocTime) { hideBlockBanner(); return; }
    const oneWay = parseFlightSecondsFromTravelPage();
    if (!oneWay) return;
    const now = Math.floor(Date.now() / 1000);
    const timeLeft = ocTime - now;
    const roundTrip = oneWay * 2;
    if (timeLeft > 0 && timeLeft <= roundTrip) {
      showBlockBanner('Your OC will be ready before you return - you may miss your Organized Crime window.');
      // Soft-block: disable travel confirm buttons when possible
      document.querySelectorAll('button, input[type="submit"], a').forEach((el) => {
        const label = (el.textContent || el.value || '').toLowerCase();
        if (label.includes('travel') || label.includes('continue')) {
          el.setAttribute('data-tj-blocked', '1');
          el.addEventListener('click', blockClickOnce, true);
        }
      });
    } else {
      hideBlockBanner();
    }
  }

  function blockClickOnce(e) {
    const s = loadSettings();
    if (!s.ocBlocker) return;
    e.preventDefault();
    e.stopPropagation();
    showBlockBanner('Travel blocked: this trip would conflict with your OC ready time. Open the toolkit to disable the blocker if needed.');
  }

  async function evaluateHospHint() {
    const s = loadSettings();
    if (!s.hospBlocker || !hasFeature('oc-blocker')) return;
    const info = await refreshOcReadyTime();
    if (!info || !info.ocReady || !info.hospital) return;
    const now = Math.floor(Date.now() / 1000);
    if (info.hospital > now && info.ocReady > now && info.hospital >= info.ocReady) {
      showBlockBanner('You may still be in hospital when your OC becomes ready.');
    }
  }

  // =====================================================================
  // Boot
  // =====================================================================
  let pageFxTimer = null;
  function schedulePageEffects() {
    if (pageFxTimer) clearTimeout(pageFxTimer);
    pageFxTimer = setTimeout(() => {
      scanOcPage();
      evaluateTravelBlock();
      evaluateHospHint();
    }, 200);
  }

  async function boot() {
    applyTheme();
    ensureApiKey();
    injectStatusIcon();
    loadWeights();
    schedulePageEffects();
    const obs = new MutationObserver(() => schedulePageEffects());
    obs.observe(document.body, { childList: true, subtree: true });
    // Periodic OC ready refresh when blocker enabled
    setInterval(() => {
      const s = loadSettings();
      if ((s.ocBlocker || s.hospBlocker) && hasFeature('oc-blocker') && ensureApiKey()) {
        refreshOcReadyTime();
      }
    }, 120000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
