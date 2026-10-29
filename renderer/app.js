/* global EKIP, MD */
'use strict';
const { TEAM, spriteGrid, attribute, EDIT_TOOLS } = EKIP;
const $ = (s) => document.querySelector(s);
const byId = Object.fromEntries(TEAM.map((m) => [m.id, m]));

const S = {
  workspace: null,
  recent: [],
  status: {},          // kurulum durumu
  live: null,          // init mesajından gelen yüklü plugin/skill bilgisi
  selected: 'lider',
  state: 'yok',
  activity: Object.fromEntries(TEAM.map((m) => [m.id, []])),
  activeUntil: {},     // üye -> zaman damgası (avatar yanık kalsın)
  lead: null,          // bu turda işi yürüten üye
  toolOwner: {},       // tool_use_id -> üye
  toolEls: {},         // tool_use_id -> DOM
  slash: [],
  mode: 'default'
};

// ---------- Pixel-art ----------
const gridCache = {};
function gridOf(id) { return (gridCache[id] ||= spriteGrid(byId[id])); }

function drawSprite(canvas, id, scale, opts = {}) {
  const { grid, palette } = gridOf(id);
  const w = 16 * scale, h = 18 * scale;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const dy = opts.bob ? scale : 0;
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < 16; x++) {
      let ch = grid[y][x];
      if (ch === '.' || ch === ' ') continue;
      if (opts.blink && (ch === 'e')) ch = 's';
      if (opts.blink && id === 'lider' && ch === 'k' && y >= 6 && y <= 7) ch = 'o';
      const col = palette[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, (y + 1) * scale - dy, scale, scale);
    }
  }
}
function spriteCanvas(id, scale, cls) {
  const c = document.createElement('canvas');
  if (cls) c.className = cls;
  drawSprite(c, id, scale);
  return c;
}

// ---------- Yardımcılar ----------
const esc = MD.esc;
const now = () => new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const short = (s, n = 90) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const base = (p) => String(p || '').split(/[\\/]/).pop();

function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = text;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

const isGraphTool = (name) => /^mcp__codebase-memory/.test(name);
function toolSummary(name, input = {}) {
  if (isGraphTool(name)) {
    const op = name.split('__').pop();
    const arg = input.function_name || input.name_pattern || input.query || input.qualified_name || input.symbol || input.file_path || '';
    return `${op}${arg ? ' → ' + arg : ''}${input.project ? ' @' + input.project : ''}`;
  }
  switch (name) {
    case 'Read': return base(input.file_path);
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return input.file_path || input.notebook_path || '';
    case 'Bash': case 'PowerShell': return input.description ? `${input.description} — ${input.command}` : input.command;
    case 'Grep': return `"${input.pattern}"` + (input.path ? ` @ ${base(input.path)}` : '');
    case 'Glob': return input.pattern;
    case 'Agent': case 'Task': return `${input.subagent_type || 'alt ajan'}: ${input.description || ''}`;
    case 'Skill': return input.skill || input.command || '';
    case 'WebFetch': return input.url;
    case 'WebSearch': return input.query;
    case 'TodoWrite': return 'yapılacaklar listesi güncellendi';
    case 'AskUserQuestion': return (input.questions && input.questions[0] && input.questions[0].question) || '';
    default: return short(JSON.stringify(input), 120);
  }
}

function describeForMember(memberId, name, input) {
  const sum = short(toolSummary(name, input), 70);
  if (memberId === 'guvenlik' && EDIT_TOOLS.test(name)) return `${base(input.file_path || input.notebook_path)} taranıyor`;
  if (isGraphTool(name)) return `sinir ağına soruyor: ${short(toolSummary(name, input), 55)}`;
  if (name === 'Skill') return `skill: ${sum}`;
  if (name === 'Agent' || name === 'Task') return `alt ajan: ${short(input.description || '', 50)}`;
  if (name === 'Bash' || name === 'PowerShell') return `$ ${short(input.command, 60)}`;
  if (EDIT_TOOLS.test(name)) return `düzenliyor: ${base(input.file_path || input.notebook_path)}`;
  if (name === 'Read') return `okuyor: ${sum}`;
  if (name === 'Grep' || name === 'Glob') return `arıyor: ${sum}`;
  return `${name}: ${sum}`;
}

// ---------- Ekip etkinliği ----------
function activity(memberId, text, opts = {}) {
  const list = S.activity[memberId];
  list.push({ t: now(), text });
  if (list.length > 80) list.shift();
  S.activeUntil[memberId] = Date.now() + (opts.hold || 4000);
  const desk = document.querySelector(`.desk[data-id="${memberId}"]`);
  if (desk) {
    const b = desk.querySelector('.bubble');
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.remove('show'), opts.hold || 4000);
  }
  if (S.selected === memberId) renderActivity();
}

function isActive(id) {
  if (id === 'lider' && S.state === 'calisiyor') return true;
  return (S.activeUntil[id] || 0) > Date.now();
}

// ---------- Ofis ----------
const OFFICE_ORDER = ['mimar', 'lider', 'tasarimci', 'inceleyici', 'guvenlik', 'ceo'];
function renderOffice() {
  const o = $('#office');
  o.innerHTML = '';
  for (const id of OFFICE_ORDER) {
    const m = byId[id];
    const st = S.status[id];
    const d = document.createElement('div');
    d.className = 'desk' + (S.selected === id ? ' selected' : '') + (st && !st.installed ? ' uninstalled' : '');
    d.dataset.id = id;
    d.style.setProperty('--member', m.color);
    d.innerHTML = `<div class="bubble"></div><span class="dot ${st && st.installed ? 'on' : ''}" title="${st && st.installed ? 'Kurulu' : 'Kurulu değil'}"></span>`;
    const wrap = document.createElement('div');
    wrap.className = 'sprite-wrap';
    const c = spriteCanvas(id, 5);
    c.dataset.sprite = id;
    wrap.appendChild(c);
    d.appendChild(wrap);
    d.insertAdjacentHTML('beforeend', `<div class="table"></div><div class="name">${esc(m.name)}</div><div class="role">${esc(m.title)}</div>`);
    d.addEventListener('click', () => select(id));
    o.appendChild(d);
  }
  const missing = TEAM.filter((m) => m.installId && S.status[m.id] && !S.status[m.id].installed);
  $('#installAll').classList.toggle('hidden', !S.workspace || !missing.length);
}

function tick() {
  const t = Date.now();
  document.querySelectorAll('canvas[data-sprite]').forEach((c) => {
    const id = c.dataset.sprite;
    const active = isActive(id);
    const period = active ? 260 : 900;
    const bob = active ? Math.floor(t / period) % 2 === 0 : Math.floor(t / period) % 4 === 0;
    const blink = (Math.floor(t / 150) + id.length * 7) % 40 === 0;
    const key = `${bob}|${blink}`;
    if (c._k === key) return;
    c._k = key;
    drawSprite(c, id, c.width / 16, { bob, blink });
    const desk = c.closest('.desk');
    if (desk) desk.classList.toggle('active', active);
  });
  requestAnimationFrame(tick);
}

// ---------- Detay paneli ----------
function liveInfo(m) {
  if (!S.live) return null;
  const skills = (S.live.skills || []).filter((s) => {
    if (m.match && m.match.skill) return m.match.skill.test(s);
    return false;
  });
  const plugin = (S.live.plugins || []).find((p) => m.plugin && (p.name === m.plugin || p.name.startsWith(m.plugin) || (m.installId && p.name === m.installId.split('@')[0])));
  return { skills, plugin };
}

function select(id) {
  S.selected = id;
  document.querySelectorAll('.desk').forEach((d) => d.classList.toggle('selected', d.dataset.id === id));
  renderDetail();
}

function renderDetail() {
  const m = byId[S.selected];
  const st = S.status[m.id];
  const live = liveInfo(m);
  const el = $('#detail');
  el.style.setProperty('--member', m.color);
  let installHtml = '';
  if (m.builtIn) installHtml = '<span class="tag ok">YERLEŞİK</span>';
  else if (!S.workspace) installHtml = '<span class="tag no">Workspace seçilmedi</span>';
  else if (st && st.installed) installHtml = `<span class="tag ok">KURULU · ${esc(st.scope)}</span>`;
  else if (m.installId) installHtml = `<span class="tag no">KURULU DEĞİL</span><button class="btn btn-small" id="installOne">Bu workspace'e kur</button>`;
  else installHtml = '<span class="tag no">KURULU DEĞİL</span>';
  if (live && (live.plugin || live.skills.length)) installHtml += '<span class="tag live">BU OTURUMDA YÜKLÜ</span>';

  el.innerHTML = `
    <div class="detail-head">
      <div id="detailSprite"></div>
      <div>
        <h3>${esc(m.name)}</h3>
        <div class="sub">${esc(m.title.toUpperCase())}${m.plugin ? ' · plugin: ' + esc(m.plugin) : ''}</div>
        <p class="tagline">${esc(m.tagline)}</p>
        ${m.repo ? `<button class="link-btn" id="repoLink">${esc(m.repo.replace('https://github.com/', 'github.com/'))}</button>` : ''}
      </div>
    </div>
    <div class="install-row">${installHtml}</div>
    ${m.manualInstall && !(st && st.installed) ? `<div class="note">${esc(m.manualInstall)}</div>` : ''}
    <h4>NE YAPAR</h4>
    <div>${esc(m.what)}</div>
    <h4>ARKADA NE ÇALIŞTIRIR</h4>
    <ul>${m.runs.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    ${live && live.skills.length ? `<h4>BU OTURUMDA YÜKLÜ SKILL'LER</h4><div class="chips">${live.skills.map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
    <h4>HIZLI KOMUTLAR</h4>
    <div class="quick">${m.quick.map((q, i) => `<button class="btn btn-small" data-q="${i}" title="${esc(q.text)}">${esc(q.label)}</button>`).join('')}</div>
    <h4>CANLI ETKİNLİK</h4>
    <div class="activity" id="activity"></div>`;
  const big = spriteCanvas(m.id, 6);
  big.dataset.sprite = m.id;
  $('#detailSprite').appendChild(big);
  el.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    const q = m.quick[+b.dataset.q];
    const inp = $('#input');
    inp.value = q.text;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    updateLeadHint();
  }));
  const rl = $('#repoLink');
  if (rl) rl.addEventListener('click', () => window.ekip.openExternal(m.repo));
  const io = $('#installOne');
  if (io) io.addEventListener('click', () => installMembers([m.id]));
  renderActivity();
}

function renderActivity() {
  const a = $('#activity');
  if (!a) return;
  const list = S.activity[S.selected];
  if (!list.length) { a.innerHTML = '<div class="empty">Henüz bir şey yapmadı. Bir iş verdiğinizde burada ne çalıştırdığını göreceksiniz.</div>'; return; }
  a.innerHTML = list.map((x) => `<div class="row"><span class="t">${x.t}</span><span>${esc(x.text)}</span></div>`).join('');
  a.scrollTop = a.scrollHeight;
}

async function installMembers(ids) {
  for (const id of ids) {
    const m = byId[id];
    activity(id, 'kuruluyor…', { hold: 60000 });
    toast(`${m.name} (${m.plugin}) kuruluyor…`);
    const r = await window.ekip.install(id);
    S.activeUntil[id] = 0;
    if (r.status) S.status = r.status;
    if (r.ok) { activity(id, 'kuruldu ✓'); toast(`${m.name} kuruldu.`, 'ok'); }
    else { activity(id, 'kurulum başarısız'); toast(`${m.name} kurulamadı:\n${short(r.out, 300)}`, 'err'); }
  }
  renderOffice();
  renderDetail();
  if (S.state !== 'yok') toast('Yeni kurulan üyelerin devreye girmesi için "Yeni oturum" başlatın.');
}

// ---------- Workspace ----------
function setWorkspace(info) {
  if (!info) return;
  S.workspace = info.workspace;
  S.recent = info.recent || S.recent;
  S.status = info.status || {};
  S.live = null;
  $('#wsPath').textContent = S.workspace;
  $('#wsPath').title = S.workspace;
  clearChat();
  replayChat();
  renderOffice();
  renderDetail();
  renderLimits();
  refreshLimits();
}

// Önceki konuşmayı kaldığı yerden yeniden çizer (kayıt main sürecinde tutulur).
async function replayChat() {
  const items = await window.ekip.chatHistory();
  if (!items.length) return;
  const empty = document.getElementById('emptyChat');
  if (empty) empty.remove();
  for (const item of items) {
    if (item.kind === 'user') addUser(item.text);
    else if (item.kind === 'event') onEvent(item.msg);
  }
}

function toggleWsMenu(show) {
  const menu = $('#wsMenu');
  if (show === false || (!menu.classList.contains('hidden') && show !== true)) { menu.classList.add('hidden'); return; }
  menu.innerHTML = '';
  const add = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { menu.classList.add('hidden'); fn(); }; menu.appendChild(b); };
  add('📁  Klasör seç…', async () => setWorkspace(await window.ekip.pickWorkspace()));
  if (S.workspace) add('↗  Klasörü Explorer\'da aç', () => window.ekip.openFolder());
  const rec = S.recent.filter((r) => r !== S.workspace);
  if (rec.length) {
    const sep = document.createElement('div'); sep.className = 'sep'; menu.appendChild(sep);
    rec.forEach((r) => add(r, async () => setWorkspace(await window.ekip.selectWorkspace(r))));
  }
  menu.classList.remove('hidden');
}

// ---------- Sohbet ----------
function clearChat() {
  const log = $('#log');
  log.innerHTML = '';
  S.toolEls = {};
  S.toolOwner = {};
  S.lead = null;
  const e = document.createElement('div');
  e.className = 'empty-chat';
  e.id = 'emptyChat';
  if (!S.workspace) {
    e.innerHTML = `<h3>HOŞ GELDİNİZ</h3><p>Önce üstten geliştirme yapacağınız <b>workspace</b> klasörünü seçin. Sonra ekibe buradan iş verin; her üyeye tıklayınca arkada ne yaptığını görürsünüz.</p><button class="btn btn-primary" id="pickFromEmpty">Workspace seç</button>`;
    setTimeout(() => { const b = $('#pickFromEmpty'); if (b) b.onclick = async () => setWorkspace(await window.ekip.pickWorkspace()); });
  } else {
    e.innerHTML = `<h3>EKİP HAZIR</h3><p><code>${esc(S.workspace)}</code> üzerinde çalışılacak.</p><p>Bir iş yazın — ör. <i>"Ana sayfaya iletişim formu ekle"</i>. Claude işi alır; Süper Mimar planlar, Piksel tasarlar, Bekçi her değişikliği tarar, Dedektif inceler.</p>`;
  }
  log.appendChild(e);
}

function appendToLog(el) {
  const log = $('#log');
  const empty = $('#emptyChat');
  if (empty) empty.remove();
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.appendChild(el);
  if (stick) log.scrollTop = log.scrollHeight;
}

function msgEl(kind, memberId, html) {
  const m = byId[memberId] || byId.lider;
  const d = document.createElement('div');
  d.className = 'msg ' + kind;
  d.style.setProperty('--member', m.color);
  if (kind !== 'user') {
    const av = spriteCanvas(m.id, 2, 'av');
    d.appendChild(av);
  }
  const body = document.createElement('div');
  body.className = 'body';
  body.innerHTML = html;
  d.appendChild(body);
  return d;
}

function addUser(text) {
  appendToLog(msgEl('user', 'lider', esc(text)));
}

// Lider bir ekip üyesi adıyla başlıyorsa ("**Piksel (arayüz):** …" ya da "Piksel, …") mesajı o üyenin adına ve görüntüsüyle göster.
const MEMBER_BOLD = /^\*\*\s*(Süper Mimar|Piksel|Dedektif|Bekçi|Patron)\b[^*]*\*\*:?\s*/i;
const MEMBER_PLAIN = /^(Süper Mimar|Piksel|Dedektif|Bekçi|Patron)\s*[,:]\s*/i;

// Sohbetteki bağlantılar: https → tarayıcı, dosya yolu → varsayılan uygulama
document.getElementById('log').addEventListener('click', async (e) => {
  const a = e.target.closest('a[data-link], a[data-path]');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.link) window.ekip.openExternal(a.dataset.link);
  else {
    const err = await window.ekip.openPath(a.dataset.path);
    if (err) toast(err, 'err');
  }
});

function addAssistantText(text, sub) {
  let owner = sub ? (S.toolOwner[sub] || 'lider') : 'lider';
  let body = text;
  if (!sub) {
    const hit = text.match(MEMBER_BOLD) || text.match(MEMBER_PLAIN);
    const found = hit && TEAM.find((t) => t.name.toLowerCase() === hit[1].toLowerCase());
    if (found) { owner = found.id; body = text.slice(hit[0].length); }
  }
  const m = byId[owner];
  const label = sub ? `${m.name.toUpperCase()} · ALT AJAN` : (owner === 'lider' ? 'CLAUDE' : m.name.toUpperCase());
  appendToLog(msgEl('assistant', owner, `<div class="who">${esc(label)}</div><div class="text">${MD.render(body)}</div>`));
}

function addSys(text, cls = '') {
  const d = document.createElement('div');
  d.className = 'sys ' + cls;
  d.textContent = text;
  appendToLog(d);
}

function addTool(block, parentId) {
  const name = block.name;
  const input = block.input || {};
  let owner;
  if (parentId && S.toolOwner[parentId]) owner = S.toolOwner[parentId];
  else if (name === 'Skill') {
    owner = attribute({ kind: 'skill', name: input.skill || input.command || '' });
    if (owner !== 'lider') S.lead = owner;
  } else if (name === 'Agent' || name === 'Task') {
    const a = attribute({ kind: 'agent', text: `${input.description || ''} ${input.subagent_type || ''}` });
    owner = a !== 'lider' ? a : (S.lead || 'lider');
  } else owner = S.lead || 'lider';
  S.toolOwner[block.id] = owner;

  const m = byId[owner];
  const el = document.createElement('div');
  el.className = 'tool' + (parentId ? ' sub' : '');
  el.style.setProperty('--member', m.color);
  const head = document.createElement('div');
  head.className = 'tool-head';
  head.appendChild(spriteCanvas(owner, 1));
  head.insertAdjacentHTML('beforeend', `<span class="who">${esc(m.name)}</span><span class="name">${esc(name)}</span><span class="sum">${esc(short(toolSummary(name, input), 160))}</span><span class="st run">●</span>`);
  const body = document.createElement('div');
  body.className = 'tool-body hidden';
  body.innerHTML = `<span class="lbl">GİRDİ</span>\n${esc(JSON.stringify(input, null, 2))}`;
  head.addEventListener('click', () => body.classList.toggle('hidden'));
  el.appendChild(head);
  el.appendChild(body);
  S.toolEls[block.id] = el;
  appendToLog(el);

  activity(owner, describeForMember(owner, name, input));
  if (EDIT_TOOLS.test(name) && S.status.guvenlik && S.status.guvenlik.installed) {
    activity('guvenlik', describeForMember('guvenlik', name, input));
  }
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[görüntü]' : JSON.stringify(c))).join('\n');
  return JSON.stringify(content);
}

function finishTool(block) {
  const el = S.toolEls[block.tool_use_id];
  if (!el) return;
  const st = el.querySelector('.st');
  st.className = 'st ' + (block.is_error ? 'err' : 'ok');
  st.textContent = block.is_error ? '✗' : '✓';
  const body = el.querySelector('.tool-body');
  const txt = resultText(block.content);
  body.insertAdjacentHTML('beforeend', `\n\n<span class="lbl">${block.is_error ? 'HATA' : 'SONUÇ'}</span>\n${esc(txt.length > 6000 ? txt.slice(0, 6000) + '\n…(kısaltıldı)' : txt)}`);
  if (block.is_error) {
    const owner = S.toolOwner[block.tool_use_id] || 'lider';
    activity(owner, 'hata: ' + short(txt, 60));
  }
}

// ---------- Ajan olayları ----------
function onEvent(msg) {
  switch (msg.type) {
    case 'system': return onSystem(msg);
    case 'assistant': {
      const parent = msg.parent_tool_use_id;
      for (const b of (msg.message && msg.message.content) || []) {
        if (b.type === 'text' && b.text.trim()) addAssistantText(b.text, parent);
        else if (b.type === 'tool_use') addTool(b, parent);
        else if (b.type === 'thinking' && !parent) activity('lider', 'düşünüyor…');
      }
      return;
    }
    case 'user': {
      const content = msg.message && msg.message.content;
      if (Array.isArray(content)) for (const b of content) if (b.type === 'tool_result') finishTool(b);
      return;
    }
    case 'result': {
      const d = document.createElement('div');
      const ok = msg.subtype === 'success' && !msg.is_error;
      d.className = 'result' + (ok ? '' : ' err');
      const secs = ((msg.duration_ms || 0) / 1000).toFixed(1);
      d.textContent = ok ? `✓ Tamamlandı · ${secs} sn · ${msg.num_turns} tur` : `✗ ${msg.subtype}${msg.result ? ': ' + short(msg.result, 200) : ''}${(msg.errors || []).length ? ' — ' + msg.errors.join('; ') : ''}`;
      appendToLog(d);
      if (!ok && msg.result) addAssistantText(msg.result);
      S.lead = null;
      updateLeadHint();
      setTimeout(refreshLimits, 1500);
      return;
    }
    case 'rate_limit_event': {
      const i = msg.rate_limit_info || {};
      const key = i.rateLimitType;
      if (key && S.limits && S.limits.rate_limits && typeof i.utilization === 'number') {
        const w = S.limits.rate_limits[key] || (S.limits.rate_limits[key] = {});
        w.utilization = i.utilization <= 1 ? i.utilization * 100 : i.utilization;
        if (i.resetsAt) w.resets_at = new Date(i.resetsAt * (i.resetsAt < 1e12 ? 1000 : 1)).toISOString();
        renderLimits();
      }
      if (i.status === 'rejected') addSys('Plan limitine ulaşıldı — limit yenilenene kadar istekler bekletilecek.', 'err');
      else if (i.status === 'allowed_warning') addSys('Uyarı: plan limitine yaklaşıyorsunuz.', 'warn');
      return;
    }
    default:
      return;
  }
}

function onSystem(msg) {
  switch (msg.subtype) {
    case 'init': {
      S.live = { plugins: msg.plugins || [], skills: msg.skills || [], model: msg.model, version: msg.claude_code_version };
      S.slash = (msg.slash_commands || []).map((s) => '/' + s.replace(/^\//, ''));
      const pl = (msg.plugins || []).map((p) => p.name).join(', ') || 'yok';
      const ms = msg.mcp_servers || [];
      const conn = ms.filter((m) => m.status === 'connected').map((m) => m.name);
      const mcp = (conn.join(', ') || 'yok') + (ms.length > conn.length ? ` (+${ms.length - conn.length} bağlı değil)` : '');
      addSys(`Oturum başladı · ${msg.model} · Claude Code ${msg.claude_code_version} · izin: ${msg.permissionMode} · plugin'ler: ${pl} · MCP: ${mcp}`);
      activity('lider', `oturum açıldı (${(msg.skills || []).length} skill, ${(msg.plugins || []).length} plugin)`);
      for (const m of TEAM) {
        const li = liveInfo(m);
        if (li && (li.plugin || li.skills.length)) activity(m.id, `masasında hazır · ${li.skills.length} skill yüklendi`);
      }
      renderDetail();
      return;
    }
    case 'hook_started': {
      const ev = `${msg.hook_event}${msg.hook_name && msg.hook_name !== msg.hook_event ? ' · ' + msg.hook_name : ''}`;
      if (msg.hook_event === 'SessionStart') activity('lider', `SessionStart hook çalışıyor: ${msg.hook_name}`);
      else if (msg.hook_event === 'Stop' && S.status.guvenlik && S.status.guvenlik.installed) activity('guvenlik', 'iş bitti, diff güvenlik incelemesi başlıyor');
      else if (/UserPromptSubmit/.test(msg.hook_event) && S.status.guvenlik && S.status.guvenlik.installed) activity('guvenlik', 'istek güvenlik kalıplarına karşı kontrol ediliyor');
      void ev;
      return;
    }
    case 'hook_response': {
      const out = [msg.output, msg.stdout, msg.stderr].filter(Boolean).join('\n').trim();
      if (!out) return;
      const who = attribute({ kind: 'hook', text: out + ' ' + (msg.hook_name || '') });
      const notable = who !== 'lider' && (msg.hook_event !== 'SessionStart');
      activity(who, `${msg.hook_event} hook: ${short(out, 70)}`);
      if (notable || msg.outcome === 'error') {
        const m = byId[who];
        const card = msgEl('assistant', who, `<div class="who">${esc(m.name.toUpperCase())} · ${esc(msg.hook_event)} HOOK</div><div class="hookcard">${esc(short(out, 1500))}</div>`);
        appendToLog(card);
      }
      return;
    }
    case 'task_started': {
      const owner = (msg.tool_use_id && S.toolOwner[msg.tool_use_id]) || S.lead || 'lider';
      activity(owner, `alt ajan başladı: ${short(msg.description, 60)}`);
      return;
    }
    case 'task_progress': {
      const owner = (msg.tool_use_id && S.toolOwner[msg.tool_use_id]) || S.lead || 'lider';
      if (msg.last_tool_name) activity(owner, `alt ajan → ${msg.last_tool_name}${msg.summary ? ': ' + short(msg.summary, 50) : ''}`);
      return;
    }
    case 'task_notification': {
      const owner = (msg.tool_use_id && S.toolOwner[msg.tool_use_id]) || S.lead || 'lider';
      activity(owner, `alt ajan ${msg.status === 'completed' ? 'bitti ✓' : msg.status}: ${short(msg.summary, 60)}`);
      return;
    }
    case 'informational': {
      addSys(msg.content, msg.level === 'warning' ? 'warn' : '');
      return;
    }
    case 'compact_boundary':
      addSys('— bağlam özetlendi —');
      return;
    default:
      return;
  }
}

function setState(st) {
  S.state = st.state;
  const chip = $('#state');
  const map = {
    yok: ['Oturum yok', 'chip-off'],
    baglaniyor: ['Bağlanıyor…', 'chip-wait'],
    calisiyor: ['Çalışıyor…', 'chip-run'],
    bosta: ['Hazır', 'chip-ok'],
    kapandi: ['Oturum kapandı', 'chip-off']
  };
  const [txt, cls] = map[st.state] || [st.state, 'chip-off'];
  chip.textContent = txt;
  chip.className = 'chip ' + cls;
  $('#stop').disabled = st.state !== 'calisiyor';
  if (st.state === 'kapandi') addSys('Oturum kapandı. Yeni mesaj yeni bir oturum başlatır.', 'warn');
}

// ---------- Gönderme ----------
function updateLeadHint() {
  const v = $('#input').value.trim();
  let who = null;
  if (v.startsWith('/')) who = attribute({ kind: 'command', text: v });
  else {
    const m = TEAM.find((x) => x.match && x.match.skill && v.match(/^[\w-]+:[\w-]+/) && x.match.skill.test(v.match(/^[\w-]+:[\w-]+/)[0]));
    if (m) who = m.id;
  }
  $('#leadHint').textContent = who && who !== 'lider' ? `▸ Bu işi ${byId[who].name} (${byId[who].title}) yürütecek` : '';
}

async function sendMessage() {
  const inp = $('#input');
  const text = inp.value.trim();
  if (!text) return;
  if (!S.workspace) { toast('Önce bir workspace seçin.', 'err'); return; }
  if (!(S.auth && S.auth.loggedIn)) { toast('Önce bu uygulama için giriş yapın (üstte HESAP).', 'err'); toggleAcctMenu(true); return; }
  inp.value = '';
  hideSlash();
  updateLeadHint();
  addUser(text);
  if (text.startsWith('/')) {
    const who = attribute({ kind: 'command', text });
    S.lead = who !== 'lider' ? who : null;
  } else {
    const pre = text.match(/^([\w-]+):[\w-]+/);
    const who = pre ? attribute({ kind: 'skill', name: pre[0] }) : 'lider';
    S.lead = who !== 'lider' ? who : null;
  }
  if (S.lead) activity(S.lead, 'işi devraldı: ' + short(text, 50));
  activity('lider', 'istek alındı: ' + short(text, 50));
  try {
    await window.ekip.send(text, S.mode);
  } catch (e) {
    addSys('Gönderilemedi: ' + (e.message || e), 'err');
  }
}

// ---------- Slash menüsü ----------
let slashSel = 0;
function showSlash() {
  const v = $('#input').value;
  const menu = $('#slashMenu');
  if (!v.startsWith('/') || v.includes(' ') || !S.slash.length) return hideSlash();
  const hits = S.slash.filter((s) => s.toLowerCase().startsWith(v.toLowerCase())).slice(0, 12);
  if (!hits.length) return hideSlash();
  slashSel = Math.min(slashSel, hits.length - 1);
  menu.innerHTML = '';
  hits.forEach((h, i) => {
    const b = document.createElement('button');
    b.textContent = h;
    if (i === slashSel) b.className = 'sel';
    b.onmousedown = (e) => { e.preventDefault(); pickSlash(h); };
    menu.appendChild(b);
  });
  menu.classList.remove('hidden');
}
function hideSlash() { $('#slashMenu').classList.add('hidden'); slashSel = 0; }
function pickSlash(h) { const inp = $('#input'); inp.value = h + ' '; hideSlash(); inp.focus(); updateLeadHint(); }

// ---------- İzin / soru penceresi ----------
const permQueue = [];
let permOpen = null;
function onPermission(req) { permQueue.push(req); if (!permOpen) nextPermission(); }
function onPermissionCancel({ id }) {
  const i = permQueue.findIndex((r) => r.id === id);
  if (i >= 0) permQueue.splice(i, 1);
  if (permOpen && permOpen.id === id) { closeModal(); nextPermission(); }
}
function closeModal() { $('#modal').classList.add('hidden'); permOpen = null; }
function reply(r) { window.ekip.replyPermission(Object.assign({ id: permOpen.id }, r)); closeModal(); nextPermission(); }

function nextPermission() {
  const req = permQueue.shift();
  if (!req) return;
  permOpen = req;
  const owner = S.lead || 'lider';
  const m = byId[owner];
  const box = $('#modalBox');
  box.style.borderColor = m.color;
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'modal-head';
  head.appendChild(spriteCanvas(owner, 3));

  if (req.toolName === 'AskUserQuestion') {
    head.insertAdjacentHTML('beforeend', `<div><h3>${esc(m.name)} soruyor</h3><div class="sub" style="color:var(--muted);font-size:12px">Cevabınız işin yönünü belirleyecek</div></div>`);
    box.appendChild(head);
    const answers = {};
    const qs = (req.input && req.input.questions) || [];
    qs.forEach((q) => {
      const wrap = document.createElement('div');
      wrap.className = 'q';
      wrap.innerHTML = `<div class="qh">${esc(q.header || '')}</div><div class="qt">${esc(q.question)}</div>`;
      const chosen = new Set();
      (q.options || []).forEach((o) => {
        const b = document.createElement('button');
        b.className = 'opt';
        b.innerHTML = `${esc(o.label)}${o.description ? `<small>${esc(o.description)}</small>` : ''}`;
        b.onclick = () => {
          if (q.multiSelect) { chosen.has(o.label) ? chosen.delete(o.label) : chosen.add(o.label); }
          else { chosen.clear(); chosen.add(o.label); wrap.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel')); }
          b.classList.toggle('sel', chosen.has(o.label));
          other.value = '';
          answers[q.question] = [...chosen].join(', ');
        };
        wrap.appendChild(b);
      });
      const other = document.createElement('input');
      other.type = 'text';
      other.placeholder = 'Diğer (kendi cevabınız)…';
      other.oninput = () => {
        if (other.value.trim()) { chosen.clear(); wrap.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel')); answers[q.question] = other.value.trim(); }
        else delete answers[q.question];
      };
      wrap.appendChild(other);
      box.appendChild(wrap);
    });
    const act = document.createElement('div');
    act.className = 'modal-actions';
    const skip = document.createElement('button'); skip.className = 'btn'; skip.textContent = 'Cevaplamadan geç';
    skip.onclick = () => reply({ decision: 'deny', message: 'Kullanıcı soruyu cevaplamadı; makul varsayımla devam et.' });
    const ok = document.createElement('button'); ok.className = 'btn btn-primary'; ok.textContent = 'Cevabı gönder';
    ok.onclick = () => {
      if (qs.some((q) => !answers[q.question])) { toast('Lütfen tüm soruları cevaplayın.', 'err'); return; }
      reply({ decision: 'allow', answers });
    };
    act.append(skip, ok);
    box.appendChild(act);
  } else {
    const title = req.title || `${req.toolName} kullanmak istiyor`;
    head.insertAdjacentHTML('beforeend', `<div><h3>${esc(m.name)} izin istiyor</h3><div style="color:var(--muted)">${esc(title)}</div></div>`);
    box.appendChild(head);
    const inp = req.input || {};
    let detail;
    if (req.toolName === 'Bash' || req.toolName === 'PowerShell') detail = `${inp.description ? '# ' + inp.description + '\n' : ''}${inp.command}`;
    else if (req.toolName === 'Edit') detail = `${inp.file_path}\n\n--- eski\n${inp.old_string}\n\n+++ yeni\n${inp.new_string}`;
    else if (req.toolName === 'Write') detail = `${inp.file_path}\n\n${String(inp.content || '').slice(0, 4000)}`;
    else detail = JSON.stringify(inp, null, 2);
    box.insertAdjacentHTML('beforeend', `${req.reason ? `<div class="note">${esc(req.reason)}</div>` : ''}<pre>${esc(detail)}</pre>`);
    const act = document.createElement('div');
    act.className = 'modal-actions';
    const deny = document.createElement('button'); deny.className = 'btn btn-danger'; deny.textContent = 'Reddet';
    deny.onclick = () => reply({ decision: 'deny' });
    const always = document.createElement('button'); always.className = 'btn'; always.textContent = `Bu oturumda ${req.toolName} için hep izin ver`;
    always.onclick = () => reply({ decision: 'always' });
    const allow = document.createElement('button'); allow.className = 'btn btn-primary'; allow.textContent = 'İzin ver';
    allow.onclick = () => reply({ decision: 'allow' });
    act.append(deny, always, allow);
    box.appendChild(act);
  }
  activity(owner, req.toolName === 'AskUserQuestion' ? 'size bir soru sordu' : `izin bekliyor: ${req.toolName}`, { hold: 15000 });
  $('#modal').classList.remove('hidden');
}

// ---------- Plan limitleri ----------
const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
function fmtReset(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const ms = d - Date.now();
  if (ms <= 0) return 'yenilendi';
  if (ms < 24 * 3600e3) {
    const h = Math.floor(ms / 3600e3), m = Math.round((ms % 3600e3) / 60e3);
    return `${h ? h + 's ' : ''}${m}dk sonra yenilenir`;
  }
  return `${DAYS[d.getDay()]} ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} yenilenir`;
}
function limitBox(label, w) {
  if (!w || typeof w.utilization !== 'number') return '';
  const left = Math.max(0, Math.round(100 - w.utilization));
  const cls = left < 20 ? 'low' : left < 50 ? 'mid' : '';
  return `<div class="limit ${cls}" title="${esc(label)}: %${Math.round(w.utilization)} kullanıldı · ${esc(fmtReset(w.resets_at))}">
    <div class="lt"><span>${esc(label)}</span><b>%${left} kaldı</b></div>
    <div class="bar"><i style="width:${left}%"></i></div>
    <div class="rs">${esc(fmtReset(w.resets_at))}</div></div>`;
}
function renderLimits() {
  const el = $('#limits');
  const u = S.limits;
  if (!(S.auth && S.auth.loggedIn)) { el.innerHTML = ''; return; }
  if (!u) { el.innerHTML = S.workspace ? '<span class="na">limitler yükleniyor…</span>' : ''; return; }
  if (!u.rate_limits_available || !u.rate_limits) { el.innerHTML = '<span class="na">plan limiti bilgisi yok</span>'; return; }
  const r = u.rate_limits;
  const modelWin = /opus/.test(S.model) ? ['HAFTA·OPUS', r.seven_day_opus] : /sonnet/.test(S.model) ? ['HAFTA·SONNET', r.seven_day_sonnet] : null;
  let html = limitBox('5 SAAT', r.five_hour) + limitBox('HAFTA', r.seven_day);
  if (modelWin && modelWin[1]) html += limitBox(modelWin[0], modelWin[1]);
  el.innerHTML = html || '<span class="na">plan limiti bilgisi yok</span>';
  const x = r.extra_usage;
  el.title = `Plan: ${u.subscription_type || '?'} · Ek kullanım (limit aşımında ücretli devam): ${x ? (x.is_enabled ? 'AÇIK' : 'kapalı') : 'bilinmiyor'}`;
}
// ---------- Hesap (yalnızca bu uygulamanın profili: ~/.claude-ekip) ----------
function renderAccount() {
  const a = S.auth || {};
  const btn = $('#acctBtn');
  btn.classList.toggle('out', !a.loggedIn);
  $('#acctName').textContent = a.loggedIn ? `${a.email || 'giriş yapıldı'}${a.plan ? ' · ' + a.plan : ''}` : 'Giriş yapılmadı — giriş yap';
  btn.title = a.loggedIn ? `${a.email} · ${a.orgName || ''} · ${a.plan || ''}` : 'Bu uygulama için Claude hesabıyla giriş yapın';
  const b = $('#banner');
  if (!a.loggedIn) {
    b.innerHTML = '<span>Claude Ekip kendi hesabını kullanır (bu masaüstü uygulamasından ve Claude Code\'dan bağımsız). Çalışmak için giriş yapın.</span>';
    const btn2 = document.createElement('button'); btn2.className = 'btn btn-small'; btn2.textContent = 'Giriş yap';
    btn2.onclick = login;
    b.appendChild(btn2);
    b.classList.remove('hidden');
  } else if (b.dataset.kind !== 'claude') b.classList.add('hidden');
}
function toggleAcctMenu(show) {
  const menu = $('#acctMenu');
  if (show === false || (!menu.classList.contains('hidden') && show !== true)) { menu.classList.add('hidden'); return; }
  const a = S.auth || {};
  menu.innerHTML = `<div class="info">${a.loggedIn ? `${esc(a.email)}<br>${esc(a.orgName || '')} · ${esc(a.plan || '')}` : 'Giriş yapılmadı'}<br><span style="color:var(--faint)">Sadece bu uygulamada geçerli</span></div>`;
  const add = (label, fn) => { const x = document.createElement('button'); x.textContent = label; x.onclick = () => { menu.classList.add('hidden'); fn(); }; menu.appendChild(x); };
  if (a.loggedIn) {
    add('⇄  Çıkış yap ve farklı hesapla giriş yap', async () => { await logout(); login(); });
    add('⏻  Çıkış yap', logout);
  } else add('→  Giriş yap', login);
  add('↻  Yenile', refreshAuth);
  menu.classList.remove('hidden');
}
async function refreshAuth() {
  S.auth = await window.ekip.authStatus();
  renderAccount();
  return S.auth;
}
let loginPoll = null;
async function login() {
  const before = S.auth && S.auth.loggedIn ? S.auth.email : null;
  if (!(await window.ekip.login())) { toast('claude.exe bulunamadı.', 'err'); return; }
  toast('Açılan konsol penceresinde ve tarayıcıda girişi tamamlayın. Farklı hesap için tarayıcıda önce claude.ai\'dan çıkış yapmanız gerekebilir.');
  clearInterval(loginPoll);
  let n = 0;
  loginPoll = setInterval(async () => {
    const a = await refreshAuth();
    if ((a.loggedIn && a.email !== before) || ++n > 100) {
      clearInterval(loginPoll);
      if (a.loggedIn && a.email !== before) {
        toast(`Giriş yapıldı: ${a.email}`, 'ok');
        S.limits = null; S.live = null;
        clearChat(); renderLimits(); refreshLimits();
      }
    }
  }, 3000);
}
async function logout() {
  S.auth = await window.ekip.logout();
  S.limits = null; S.live = null;
  renderAccount(); renderLimits(); clearChat();
  toast('Bu uygulamada çıkış yapıldı.');
}

let limitsBusy = false;
async function refreshLimits() {
  if (!S.workspace || limitsBusy || !(S.auth && S.auth.loggedIn)) return;
  limitsBusy = true;
  try {
    const u = await window.ekip.usage();
    if (u) S.limits = u;
  } finally { limitsBusy = false; }
  renderLimits();
}

// ---------- Başlat ----------
async function boot() {
  const ic = $('#brandIcon');
  drawSprite(ic, 'lider', 2);
  const big = document.createElement('canvas');
  drawSprite(big, 'lider', 8);
  const sq = document.createElement('canvas');
  sq.width = 128; sq.height = 128;
  sq.getContext('2d').drawImage(big, 0, -12);
  window.ekip.setIcon(sq.toDataURL('image/png'));

  const info = await window.ekip.init();
  S.recent = info.settings.recent || [];
  S.mode = info.settings.permissionMode || 'default';
  $('#mode').value = S.mode;
  S.model = info.settings.model;
  $('#model').value = S.model;
  $('#model').addEventListener('change', async (e) => {
    S.model = e.target.value;
    await window.ekip.setModel(S.model);
    renderLimits();
    toast(`Model: ${e.target.selectedOptions[0].textContent}. Sonraki mesajlardan itibaren geçerli.`, 'ok');
  });
  setInterval(refreshLimits, 120000);
  if (!info.claudeExe) {
    const b = $('#banner');
    b.innerHTML = '<span>claude.exe bulunamadı — Claude masaüstü uygulaması kurulu olmalı ya da yolunu elle seçin.</span>';
    const btn = document.createElement('button'); btn.className = 'btn btn-small'; btn.textContent = 'claude.exe seç';
    btn.onclick = async () => { if (await window.ekip.pickClaude()) b.classList.add('hidden'); };
    b.appendChild(btn);
    b.dataset.kind = 'claude';
    b.classList.remove('hidden');
  } else {
    await refreshAuth();
  }
  $('#acctBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleWsMenu(false); toggleAcctMenu(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#acctMenu')) toggleAcctMenu(false); });
  if (info.settings.workspace) {
    setWorkspace({ workspace: info.settings.workspace, recent: S.recent, status: info.status });
  } else {
    clearChat();
    renderOffice();
    renderDetail();
  }

  $('#wsBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleAcctMenu(false); toggleWsMenu(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#wsMenu')) toggleWsMenu(false); });
  $('#mode').addEventListener('change', async (e) => {
    S.mode = e.target.value;
    if (S.mode === 'bypassPermissions') toast('Dikkat: Claude komut çalıştırırken ve dosya silerken artık sormayacak.', 'err');
    await window.ekip.setMode(S.mode);
  });
  $('#newSession').addEventListener('click', async () => {
    await window.ekip.reset();
    S.live = null;
    S.status = (await window.ekip.teamStatus()) || S.status;
    clearChat();
    renderOffice();
    renderDetail();
    refreshLimits();
  });
  $('#installAll').addEventListener('click', () => installMembers(TEAM.filter((m) => m.installId && S.status[m.id] && !S.status[m.id].installed).map((m) => m.id)));
  $('#send').addEventListener('click', sendMessage);
  $('#stop').addEventListener('click', () => window.ekip.interrupt());
  const inp = $('#input');
  inp.addEventListener('input', () => { showSlash(); updateLeadHint(); });
  inp.addEventListener('keydown', (e) => {
    const menu = $('#slashMenu');
    if (!menu.classList.contains('hidden')) {
      const items = [...menu.querySelectorAll('button')];
      if (e.key === 'ArrowDown') { e.preventDefault(); slashSel = (slashSel + 1) % items.length; showSlash(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); slashSel = (slashSel - 1 + items.length) % items.length; showSlash(); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); pickSlash(items[slashSel].textContent); return; }
      if (e.key === 'Escape') { hideSlash(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  window.ekip.onEvent(onEvent);
  window.ekip.onState(setState);
  window.ekip.onError((m) => addSys('Hata: ' + m, 'err'));
  let errBuf = '';
  window.ekip.onStderr((d) => { errBuf = (errBuf + d).slice(-4000); window.__stderr = errBuf; });
  window.ekip.onPermission(onPermission);
  window.ekip.onPermissionCancel(onPermissionCancel);
  requestAnimationFrame(tick);
}

boot();
