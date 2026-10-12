'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { TEAM } = require('./team.js');

let win = null;
let session = null;

// Uygulamanın kendi Claude profili: ana Claude Code / masaüstü hesabından bağımsız giriş.
const PROFILE_DIR = path.join(os.homedir(), '.claude-ekip');
const childEnv = () => Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: PROFILE_DIR });

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
        const p = path.join(vdir, h, 'claude');
        if (fs.existsSync(p)) return p;
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
  constructor(ws, mode, model) {
    this.ws = ws;
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
    this.q = query({
      prompt: this.queue,
      options: {
        cwd: this.ws,
        pathToClaudeCodeExecutable: exe,
        settingSources: ['user', 'project', 'local'],
        model: this.model,
        permissionMode: this.mode,
        allowDangerouslySkipPermissions: this.mode === 'bypassPermissions',
        includeHookEvents: true,
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
        if (msg.session_id) this.sessionId = msg.session_id;
        if (msg.type === 'result') { this.busy = false; send('agent:state', { state: 'bosta' }); }
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
  const sess = new AgentSession(s.workspace, s.permissionMode || 'default', s.model || DEFAULT_MODEL);
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
ipcMain.handle('agent:reset', () => resetSession());
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
  if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url);
});
ipcMain.handle('app:open-folder', () => {
  const ws = loadSettings().workspace;
  if (ws) shell.openPath(ws);
});
ipcMain.on('app:set-icon', (_e, dataUrl) => {
  try { if (win) win.setIcon(nativeImage.createFromDataURL(dataUrl)); } catch { /* yoksay */ }
});

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
      sandbox: true
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  resetSession();
  app.quit();
});
