'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { TEAM } = require('./team.js');

let win = null;
let session = null;

// Uygulamanın kendi Claude profili: ana Claude Code / masaüstü hesabından bağımsız giriş.
const PROFILE_DIR = path.join(os.homedir(), '.claude-ekip');
const childEnv = () => Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: PROFILE_DIR });

// Lider persona: kullanıcıya "Patron" diye hitap eder ve her ekip üyesinin ne yaptığını adıyla bildirir.
const LEAD_PERSONA = [
  'Sen Claude Ekip\'in ekip lideri Claude\'sun. Kullanıcıya her zaman "Patron" diye hitap et ve ona patronuna rapor veren bir ekip lideri gibi konuş: kısa, net, Türkçe.',
  'Ekip üyeleri: Süper Mimar (planlama ve TDD), Piksel (arayüz tasarımı), Dedektif (kod incelemesi), Bekçi (güvenlik taraması), Müdür (planı mühendislik müdürü ve QA gözüyle sorgular, yayına hazırlar). "Patron" ekipte kimse değil, kullanıcının kendisidir; "Patron" adıyla bir ekip üyesi anma.',
  'Her iş için yanıtının İLK satırında işi yapan üyenin adını yaz, ör: "**Bekçi (güvenlik):** taramaya başlıyorum." İşi kendin yapıyorsan: "**Claude (ekip lideri):** hemen yapıyorum."',
  'Her araç çağrısından (komut, dosya okuma/yazma, arama) önce o üyenin ne yaptığını tek cümleyle yaz, ör: "**Piksel (arayüz):** ana sayfa şablonunu düzenliyor." Sonucu gelince kısa durumu yaz.',
  'Patron bir şey istediğinde sormadan işi yap; "çalıştır" ya da "bana sorma" dediyse terminalde kendin çalıştır.',
  'Patron "seçeneklerimi göster", "örnek ver" gibi bir şey istediğinde (font, renk, tasarım…) hemen yap: her seçenek için örnek bir görsel üret (ör. Python/Pillow ile PNG ya da HTML sayfası), workspace içindeki ".ekip-onizleme" klasörüne kaydet ve yanıtta her seçeneğin altına tıklanabilir bağlantı koy: "[Resmi aç](/mutlak/yol/dosya.png)" ve varsa "[Kaynak](https://…)". Dosya yollarını her zaman mutlak yaz.',
  'Alt ajan başlatırken açıklamasını "<Ad>: <ne yaptığı>" biçiminde yaz.'
].join('\n');

// ---------- Ayarlar ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function saveSettings(patch) {
  const s = Object.assign(loadSettings(), patch);
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  return s;
}

// ---------- Sohbet geçmişi ----------
// Her satır: { ws, item } — item ya { kind: "user", text } ya { kind: "event", msg } (SDK mesajı).
const chatFile = () => path.join(app.getPath('userData'), 'chat-log.jsonl');
function readChatLines() {
  try {
    return fs.readFileSync(chatFile(), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function logChat(ws, item) {
  try { fs.appendFileSync(chatFile(), JSON.stringify({ ws, item }) + '\n'); } catch (e) { console.error('Sohbet kaydedilemedi:', e.message); }
}
function clearChatLog(ws) {
  try { fs.writeFileSync(chatFile(), readChatLines().filter((l) => l.ws !== ws).map((l) => JSON.stringify(l) + '\n').join('')); } catch { /* yoksay */ }
}

// ---------- claude.exe bulma ----------
// Masaüstü uygulamasının imzalı claude.exe'si: %APPDATA%\Claude\claude-code\<sürüm>\<hash>\claude.exe
function cmpVer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
function findClaudeExe() {
  const custom = loadSettings().claudePath;
  if (custom && fs.existsSync(custom)) return custom;
  const base = path.join(process.env.APPDATA || '', 'Claude', 'claude-code');
  try {
    const versions = fs.readdirSync(base).filter((v) => /^\d+(\.\d+)*$/.test(v)).sort(cmpVer).reverse();
    for (const v of versions) {
      const vdir = path.join(base, v);
      const direct = path.join(vdir, 'claude.exe');
      if (fs.existsSync(direct)) return direct;
      for (const h of fs.readdirSync(vdir)) {
        const p = path.join(vdir, h, 'claude.exe');
        if (fs.existsSync(p)) return p;
      }
    }
  } catch { /* yoksa aşağı düş */ }
  const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe');
  if (fs.existsSync(local)) return local;
  if (process.platform !== 'win32') return findClaudeUnix();
  return null;
}

// macOS / Linux: masaüstü uygulamasının Claude Code kopyası, yaygın kurulum yerleri ve PATH
function findClaudeUnix() {
  const home = os.homedir();
  const appBase = path.join(home, 'Library', 'Application Support', 'Claude', 'claude-code');
  try {
    const versions = fs.readdirSync(appBase).filter((v) => /^\d+(\.\d+)*$/.test(v)).sort(cmpVer).reverse();
    for (const v of versions) {
      const vdir = path.join(appBase, v);
      const direct = path.join(vdir, 'claude');
      if (fs.existsSync(direct)) return direct;
      for (const h of fs.readdirSync(vdir)) {
        // Yeni sürümler: <sürüm>/<hash>/claude.app/Contents/MacOS/claude
        for (const p of [path.join(vdir, h, 'claude'), path.join(vdir, h, 'claude.app', 'Contents', 'MacOS', 'claude')])
          if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
      }
    }
  } catch { /* yoksa aşağı düş */ }
  const cands = [path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) cands.push(path.join(dir, 'claude'));
  return cands.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// ---------- Ekip kurulum durumu ----------
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function teamStatus(ws) {
  const files = [
    { scope: 'proje', p: ws && path.join(ws, '.claude', 'settings.json') },
    { scope: 'yerel', p: ws && path.join(ws, '.claude', 'settings.local.json') },
    { scope: 'kullanıcı', p: path.join(PROFILE_DIR, 'settings.json') }
  ];
  const enabled = [];
  for (const f of files) {
    const j = f.p && readJson(f.p);
    if (j && j.enabledPlugins) for (const [k, v] of Object.entries(j.enabledPlugins)) if (v) enabled.push({ key: k, scope: f.scope });
  }
  const out = {};
  for (const m of TEAM) {
    if (m.builtIn) { out[m.id] = { installed: true, scope: 'yerleşik' }; continue; }
    if (m.id === 'ceo') {
      const cands = [path.join(PROFILE_DIR, 'skills', 'gstack'), ws && path.join(ws, '.claude', 'skills', 'gstack'), ws && path.join(ws, '.claude', 'skills', 'plan-ceo-review')];
      const hit = cands.find((c) => c && fs.existsSync(c));
      out[m.id] = { installed: !!hit, scope: hit ? (hit.startsWith(PROFILE_DIR) ? 'kullanıcı' : 'proje') : null };
      continue;
    }
    const pname = m.installId.split('@')[0];
    const e = enabled.find((x) => x.key.split('@')[0] === pname || x.key.split('@')[0] === m.plugin);
    out[m.id] = { installed: !!e, scope: e ? e.scope : null };
  }
  return out;
}

function runClaudeCli(args, cwd) {
  return new Promise((resolve) => {
    const exe = findClaudeExe();
    if (!exe) return resolve({ ok: false, out: 'claude.exe bulunamadı.' });
    const p = spawn(exe, args, { cwd: cwd || PROFILE_DIR, windowsHide: true, env: childEnv() });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => resolve({ ok: false, out: String(e) }));
    p.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }));
  });
}

// ---------- Agent oturumu ----------
let sdkPromise = null;
const loadSdk = () => (sdkPromise ||= import('@anthropic-ai/claude-agent-sdk'));

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

class InputQueue {
  constructor() { this.items = []; this.waiters = []; this.closed = false; }
  push(v) {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: v, done: false }); else this.items.push(v);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => this.waiters.push(r));
      }
    };
  }
}

class AgentSession {
  constructor(ws, mode, model, resume) {
    this.ws = ws;
    this.resume = resume;
    this.mode = mode;
    this.model = model;
    this.queue = new InputQueue();
    this.abort = new AbortController();
    this.pending = new Map(); // izin istekleri
    this.alwaysAllow = new Set();
    this.q = null;
    this.alive = true;
    this.busy = false;
    this.sessionId = null;
  }

  async start() {
    const exe = findClaudeExe();
    if (!exe) throw new Error('claude.exe bulunamadı. Ayarlardan yolunu seçin.');
    const { query } = await loadSdk();
    const previewMcp = await previewServer();
    this.q = query({
      prompt: this.queue,
      options: {
        cwd: this.ws,
        pathToClaudeCodeExecutable: exe,
        settingSources: ['user', 'project', 'local'],
        model: this.model,
        resume: this.resume || undefined,
        permissionMode: this.mode,
        allowDangerouslySkipPermissions: this.mode === 'bypassPermissions',
        includeHookEvents: true,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: LEAD_PERSONA },
        mcpServers: { 'ekip-preview': previewMcp },
        abortController: this.abort,
        env: childEnv(),
        canUseTool: (toolName, input, opts) => this.askPermission(toolName, input, opts),
        stderr: (d) => send('agent:stderr', String(d))
      }
    });
    send('agent:state', { state: 'bosta', ws: this.ws, exe });
    this.pump();
  }

  // Plan limitleri (5 saat / haftalık). SDK'da deneysel; başarısız olursa null döner.
  async usage() {
    const fn = this.q && this.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (!fn) return null;
    const timeout = new Promise((r) => setTimeout(() => r(null), 20000));
    try {
      const u = await Promise.race([fn.call(this.q), timeout]);
      return u ? { subscription_type: u.subscription_type, rate_limits_available: u.rate_limits_available, rate_limits: u.rate_limits } : null;
    } catch { return null; }
  }

  async setModel(model) {
    this.model = model;
    try { await this.q.setModel(model); } catch (e) { send('agent:error', 'Model değiştirilemedi: ' + e.message); }
  }

  async pump() {
    try {
      for await (const msg of this.q) {
        if (msg.session_id && msg.session_id !== this.sessionId) {
          this.sessionId = msg.session_id;
          saveSettings({ sessionId: msg.session_id, sessionWs: this.ws });
        }
        if (msg.type === 'result') { this.busy = false; send('agent:state', { state: 'bosta' }); }
        logChat(this.ws, { kind: 'event', msg });
        send('agent:event', msg);
      }
    } catch (e) {
      if (this.alive) send('agent:error', String(e && e.message || e));
    } finally {
      this.busy = false;
      if (this.alive) send('agent:state', { state: 'kapandi' });
      this.alive = false;
    }
  }

  sendUser(text) {
    this.busy = true;
    logChat(this.ws, { kind: 'user', text });
    send('agent:state', { state: 'calisiyor' });
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: this.sessionId || ''
    });
  }

  askPermission(toolName, input, opts) {
    if (this.alwaysAllow.has(toolName) && toolName !== 'AskUserQuestion') {
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    }
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, toolName, input, suggestions: opts && opts.suggestions });
      const onAbort = () => {
        if (this.pending.delete(id)) { send('agent:permission-cancel', { id }); resolve({ behavior: 'deny', message: 'İptal edildi' }); }
      };
      if (opts && opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
      send('agent:permission', {
        id, toolName, input,
        title: opts && opts.title,
        reason: opts && opts.decisionReason,
        blockedPath: opts && opts.blockedPath
      });
    });
  }

  answerPermission({ id, decision, answers, message }) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (decision === 'deny') return p.resolve({ behavior: 'deny', message: message || 'Kullanıcı reddetti' });
    if (p.toolName === 'AskUserQuestion') {
      return p.resolve({ behavior: 'allow', updatedInput: Object.assign({}, p.input, { answers: answers || {} }) });
    }
    if (decision === 'always') {
      this.alwaysAllow.add(p.toolName);
      return p.resolve({ behavior: 'allow', updatedInput: p.input, updatedPermissions: p.suggestions || [] });
    }
    p.resolve({ behavior: 'allow', updatedInput: p.input });
  }

  async interrupt() {
    try { await this.q.interrupt(); } catch (e) { send('agent:error', 'Durdurulamadı: ' + e.message); }
  }

  async setMode(mode) {
    this.mode = mode;
    try { await this.q.setPermissionMode(mode); } catch (e) { send('agent:error', 'İzin modu değiştirilemedi: ' + e.message); }
  }

  close() {
    this.alive = false;
    for (const [id, p] of this.pending) { p.resolve({ behavior: 'deny', message: 'Oturum kapatıldı' }); send('agent:permission-cancel', { id }); }
    this.pending.clear();
    this.queue.close();
    try { this.abort.abort(); } catch { /* yoksay */ }
  }
}

function resetSession() {
  if (session) { session.close(); session = null; }
  send('agent:state', { state: 'yok' });
}

// ---------- IPC ----------
ipcMain.handle('app:init', () => {
  const s = loadSettings();
  return {
    settings: Object.assign({ model: DEFAULT_MODEL }, s),
    claudeExe: findClaudeExe(),
    status: s.workspace ? teamStatus(s.workspace) : null,
    version: app.getVersion()
  };
});

ipcMain.handle('ws:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Geliştirme yapılacak workspace', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return selectWorkspace(r.filePaths[0]);
});
ipcMain.handle('ws:select', (_e, ws) => (fs.existsSync(ws) ? selectWorkspace(ws) : null));
function selectWorkspace(ws) {
  resetSession();
  const s = loadSettings();
  const recent = [ws, ...(s.recent || []).filter((x) => x !== ws)].slice(0, 8);
  saveSettings({ workspace: ws, recent });
  return { workspace: ws, recent, status: teamStatus(ws) };
}

ipcMain.handle('team:status', () => {
  const ws = loadSettings().workspace;
  return ws ? teamStatus(ws) : null;
});

ipcMain.handle('team:install', async (_e, memberId) => {
  const ws = loadSettings().workspace;
  if (!ws) return { ok: false, out: 'Önce bir workspace seçin.' };
  const m = TEAM.find((x) => x.id === memberId);
  if (!m || !m.installId) return { ok: false, out: 'Bu üye otomatik kurulamıyor.' };
  const r = await runClaudeCli(['plugin', 'install', m.installId, '--scope', 'project'], ws);
  return Object.assign(r, { status: teamStatus(ws) });
});

const DEFAULT_MODEL = 'claude-sonnet-5-5'; // fiyat/performans

let starting = null;
async function ensureSession() {
  if (session && session.alive) return session;
  if (starting) return starting;
  const s = loadSettings();
  if (!s.workspace) throw new Error('Önce bir workspace seçin.');
  // Önceki sohbet aynı workspace'teyse Claude'un oturumunu devam ettir.
  const resume = s.sessionWs === s.workspace ? s.sessionId : undefined;
  const sess = new AgentSession(s.workspace, s.permissionMode || 'default', s.model || DEFAULT_MODEL, resume);
  starting = sess.start().then(() => { session = sess; return sess; }).finally(() => { starting = null; });
  return starting;
}

ipcMain.handle('agent:send', async (_e, { text }) => {
  const sess = await ensureSession();
  sess.sendUser(text);
  return true;
});
ipcMain.handle('agent:model', (_e, model) => {
  saveSettings({ model });
  if (session && session.alive) return session.setModel(model);
});
// Limitler oturum üzerinden okunur; oturum yoksa (model çağrısı yapmadan) bekleme oturumu açılır.
ipcMain.handle('usage:get', async () => {
  try {
    const sess = await ensureSession();
    return await sess.usage();
  } catch { return null; }
});
ipcMain.handle('agent:interrupt', () => session && session.interrupt());
ipcMain.handle('agent:reset', () => {
  resetSession();
  const ws = loadSettings().workspace;
  if (ws) clearChatLog(ws);
  saveSettings({ sessionId: null, sessionWs: null });
});
ipcMain.handle('chat:history', () => {
  const ws = loadSettings().workspace;
  return readChatLines().filter((l) => l.ws === ws).slice(-400).map((l) => l.item);
});
ipcMain.handle('agent:mode', (_e, mode) => {
  saveSettings({ permissionMode: mode });
  if (session && session.alive) return session.setMode(mode);
});
ipcMain.on('agent:permission-reply', (_e, reply) => session && session.answerPermission(reply));

// ---------- Hesap (yalnızca bu uygulamanın profili) ----------
async function authStatus() {
  const r = await runClaudeCli(['auth', 'status']);
  try {
    const j = JSON.parse(r.out.slice(r.out.indexOf('{')));
    return { loggedIn: !!j.loggedIn, email: j.email || null, orgName: j.orgName || null, plan: j.subscriptionType || null, method: j.authMethod || null };
  } catch { return { loggedIn: false, error: r.out.slice(0, 300) }; }
}
ipcMain.handle('auth:status', () => authStatus());
ipcMain.handle('auth:login', () => {
  const exe = findClaudeExe();
  if (!exe) return false;
  resetSession();
  // Yeni bir konsol penceresinde tarayıcı tabanlı giriş akışı; kullanıcı kendisi tamamlar.
  if (process.platform !== 'win32') {
    // Mac: profil ortamıyla giriş komutunu çalıştıran bir .command betiğini Terminal'de aç.
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    const script = path.join(PROFILE_DIR, 'giris.command');
    const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
    fs.writeFileSync(script, `#!/bin/sh\nexport CLAUDE_CONFIG_DIR=${q(PROFILE_DIR)}\n${q(exe)} auth login --claudeai\necho\necho "Giriş tamamlandı, bu pencereyi kapatabilirsiniz."\n`, { mode: 0o755 });
    spawn('open', ['-a', 'Terminal', script], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  const p = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `start "Claude Ekip - Giris" "${exe}" auth login --claudeai`], {
    env: childEnv(), cwd: PROFILE_DIR, detached: true, stdio: 'ignore', windowsVerbatimArguments: true
  });
  p.unref();
  return true;
});
ipcMain.handle('auth:logout', async () => {
  resetSession();
  const r = await runClaudeCli(['auth', 'logout']);
  return Object.assign(await authStatus(), { out: r.out });
});

ipcMain.handle('app:pick-claude', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'claude.exe seç', properties: ['openFile'], filters: [{ name: 'claude.exe', extensions: ['exe'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  saveSettings({ claudePath: r.filePaths[0] });
  return r.filePaths[0];
});
ipcMain.handle('app:open-external', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});
// Sohbetteki dosya bağlantıları: yalnızca resim/belge türleri varsayılan uygulamada açılır.
ipcMain.handle('app:open-path', async (_e, p) => {
  const file = String(p);
  if (!path.isAbsolute(file) || !/\.(png|jpe?g|gif|webp|svg|pdf|html?|txt|md|ttf|otf)$/i.test(file) || !fs.existsSync(file)) return 'Dosya açılamadı: ' + file;
  return shell.openPath(file);
});
ipcMain.handle('app:open-folder', () => {
  const ws = loadSettings().workspace;
  if (ws) shell.openPath(ws);
});
ipcMain.on('app:set-icon', (_e, dataUrl) => {
  try { if (win) win.setIcon(nativeImage.createFromDataURL(dataUrl)); } catch { /* yoksay */ }
});

// ---------- iOS Simulator (xcrun simctl) ----------
const UDID_RE = /^[0-9A-F-]{36}$/i;
function simctl(args) {
  return new Promise((resolve, reject) => {
    execFile('xcrun', ['simctl', ...args], { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
}

ipcMain.handle('sim:list', async () => {
  const data = JSON.parse((await simctl(['list', 'devices', 'available', '-j'])).toString());
  const devices = [];
  for (const [runtime, list] of Object.entries(data.devices)) {
    if (!/iOS/.test(runtime)) continue;
    const version = runtime.replace(/^.*iOS-/, '').replace(/-/g, '.');
    for (const d of list) if (/iPhone/.test(d.name)) devices.push({ udid: d.udid, name: `${d.name} · iOS ${version}`, booted: d.state === 'Booted' });
  }
  return devices;
});

ipcMain.handle('sim:boot', async (_e, udid) => {
  if (!UDID_RE.test(udid)) throw new Error('Geçersiz simülatör');
  await simctl(['boot', udid]).catch((e) => { if (!/current state: Booted/.test(e.message)) throw e; });
  execFile('open', ['-a', 'Simulator']);
  return true;
});

ipcMain.handle('sim:shot', async (_e, udid) => {
  if (!UDID_RE.test(udid)) throw new Error('Geçersiz simülatör');
  const file = path.join(os.tmpdir(), `ekip-sim-${process.pid}.png`);
  await simctl(['io', udid, 'screenshot', '--type=png', file]);
  return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
});

// ---------- Sürükle bırak ekran resmi ----------
// Bırakılan resimler "ekran resmi N" adıyla kopyalanır; N uygulama genelinde artar.
const shotDir = () => path.join(app.getPath('userData'), 'ekran-resimleri');
ipcMain.handle('shot:import', (_e, srcs) => {
  fs.mkdirSync(shotDir(), { recursive: true });
  let n = loadSettings().shotSeq || 0;
  const saved = [];
  for (const src of srcs) {
    const ext = path.extname(src).toLowerCase();
    if (!/^\.(png|jpe?g|gif|webp|heic)$/.test(ext)) continue;
    n += 1;
    const dest = path.join(shotDir(), `ekran resmi ${n}${ext}`);
    fs.copyFileSync(src, dest);
    saved.push(dest);
  }
  saveSettings({ shotSeq: n });
  return saved;
});

// ---------- Komut düğmeleri ----------
const DEFAULT_COMMANDS = [
  { label: "Xcode'da Unity iOS", cmd: 'open -a /Applications/Xcode-27.1.0.app /Users/isikozguntopal/Documents/Projeler/party-league/unity/Builds/iOS/Unity-iPhone.xcodeproj' }
];
ipcMain.handle('cmd:list', () => loadSettings().commands || DEFAULT_COMMANDS);
ipcMain.handle('cmd:save', (_e, list) => {
  saveSettings({ commands: list.map((c) => ({ label: String(c.label).slice(0, 60), cmd: String(c.cmd).slice(0, 2000) })) });
  return true;
});
ipcMain.handle('cmd:run', (_e, cmd) => new Promise((resolve) => {
  execFile('/bin/zsh', ['-lc', String(cmd)], { cwd: loadSettings().workspace || os.homedir(), timeout: 300000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
    resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, output: String(stdout) + String(stderr) });
  });
}));

// ---------- Ajan önizleme araçları (simülatör + tarayıcı) ----------
const IDB = [path.join(os.homedir(), '.local/share/ekip-idb-venv/bin/idb'), '/opt/homebrew/bin/idb'].find((p) => fs.existsSync(p)) || 'idb';
function idb(args) {
  return new Promise((resolve, reject) => {
    execFile(IDB, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve(String(stdout));
    });
  });
}
async function bootedUdid() {
  const data = JSON.parse((await simctl(['list', 'devices', 'booted', '-j'])).toString());
  const d = Object.values(data.devices).flat().find((x) => x.state === 'Booted');
  if (!d) throw new Error('Açık bir iOS simülatörü yok. Önce simülatörü açın.');
  return d.udid;
}

let previewServerPromise = null;
function previewServer() {
  return (previewServerPromise ||= loadSdk().then(({ createSdkMcpServer, tool }) => {
    const { z } = require('zod');
    const text = (t) => ({ content: [{ type: 'text', text: t }] });
    const run = (fn) => async (args) => {
      try { return await fn(args); } catch (e) { return { content: [{ type: 'text', text: 'Hata: ' + e.message }], isError: true }; }
    };
    return createSdkMcpServer({
      name: 'ekip-preview',
      version: '1.0.0',
      tools: [
        tool('sim_screenshot', 'Açık iOS simülatörünün ekran görüntüsünü alır.', {}, run(async () => {
          const udid = await bootedUdid();
          const file = path.join(os.tmpdir(), `ekip-agent-${Date.now()}.png`);
          await simctl(['io', udid, 'screenshot', '--type=png', file]);
          return { content: [{ type: 'image', data: fs.readFileSync(file).toString('base64'), mimeType: 'image/png' }] };
        })),
        tool('sim_describe', 'Ekrandaki öğeleri erişilebilirlik ağacı olarak verir. Dokunmadan önce hedef koordinatları bulmak için kullanın.', {}, run(async () => {
          const udid = await bootedUdid();
          return text((await idb(['ui', 'describe-all', '--udid', udid])).slice(0, 12000));
        })),
        tool('sim_tap', 'Simülatörde verilen noktaya dokunur (393x852 nokta, sol üst 0,0).', { x: z.number(), y: z.number() }, run(async ({ x, y }) => {
          const udid = await bootedUdid();
          await idb(['ui', 'tap', String(x), String(y), '--udid', udid]);
          return text(`Dokunuldu: ${x},${y}`);
        })),
        tool('sim_swipe', 'Simülatörde bir noktadan diğerine kaydırır.', { x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }, run(async (a) => {
          const udid = await bootedUdid();
          await idb(['ui', 'swipe', String(a.x1), String(a.y1), String(a.x2), String(a.y2), '--udid', udid]);
          return text('Kaydırıldı');
        })),
        tool('sim_type', 'Simülatörde aktif metin alanına yazı yazar.', { text: z.string() }, run(async ({ text: t }) => {
          const udid = await bootedUdid();
          await idb(['ui', 'text', t, '--udid', udid]);
          return text('Yazıldı');
        })),
        tool('preview_open', 'Önizleme panelinin tarayıcı sekmesinde verilen localhost adresini açar (ör. http://localhost:8888).', { url: z.string() }, run(async ({ url }) => {
          if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) throw new Error('Yalnızca localhost adresleri açılabilir.');
          if (win && !win.isDestroyed()) win.webContents.send('preview:open', { url });
          return text('Önizleme açıldı: ' + url);
        })),
      ],
    });
  }));
}

// ---------- Pencere ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#17141f',
    title: 'Claude Ekip',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });

  // Geliştirme: EKIP_SNAPSHOT=<png yolu> verilirse ekran görüntüsü alıp kapanır.
  if (process.env.EKIP_SNAPSHOT) {
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) console.log('[renderer]', message); });
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.EKIP_SNAPSHOT_JS) await win.webContents.executeJavaScript(process.env.EKIP_SNAPSHOT_JS).catch((e) => console.log('[js]', e.message));
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.EKIP_SNAPSHOT, img.toPNG());
        app.quit();
      }, Number(process.env.EKIP_SNAPSHOT_WAIT || 800));
    }, 1500));
  }
}

// Önizleme etiketi (webview) yalnızca bu bilgisayardaki geliştirme sunucularını açabilir.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(params.src || '')) event.preventDefault();
  });
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  resetSession();
  app.quit();
});
