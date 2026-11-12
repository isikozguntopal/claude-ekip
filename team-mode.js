'use strict';
// Takım modu (ana süreç): Supabase auth/DB/realtime, presence, repo özeti (gh), görev kuyruğu,
// çakışma tespiti, Tartışma/karar. Sunucuya yalnızca metadata yazılır; sohbet/prompt/yanıt yazılmaz.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { detectConflict } = require('./conflict');

// Testler için sunucu adresleri değiştirilebilir (varsayılan: gerçek Google uçları)
const AUTH_URL = process.env.EKIP_AUTH_URL || 'https://identitytoolkit.googleapis.com';
const TOKEN_URL = process.env.EKIP_TOKEN_URL || 'https://securetoken.googleapis.com';
const FS_URL = process.env.EKIP_FS_URL || 'https://firestore.googleapis.com';
const HEARTBEAT_MS = 30000;
const INCOMING_POLL_MS = 60000;
const TASK_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(git *)', 'Bash(gh pr *)'];

// ---- Firestore REST değer çevirisi (tarihler ISO metin olarak saklanır) ----
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  const fields = {}; for (const k of Object.keys(v)) if (v[k] !== undefined) fields[k] = toFs(v[k]);
  return { mapValue: { fields } };
}
function fromFs(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  if ('mapValue' in v) { const o = {}; const f = v.mapValue.fields || {}; for (const k of Object.keys(f)) o[k] = fromFs(f[k]); return o; }
  return null;
}
const fieldsOf = (obj) => { const f = {}; for (const k of Object.keys(obj)) if (obj[k] !== undefined) f[k] = toFs(obj[k]); return f; };
const docOut = (d) => { const o = {}; const f = d.fields || {}; for (const k of Object.keys(f)) o[k] = fromFs(f[k]); o.id = d.name.split('/').pop(); return o; };
const nowIso = () => new Date().toISOString();
const rid = () => Math.random().toString(36).slice(2, 12);
const idOf = (full) => String(full).replace(/\//g, '__');

function init(ctx) {
  const { app, ipcMain, shell, send, loadSdk, findClaudeExe, childEnv, oneShot, loadSettings } = ctx;
  const localFile = () => path.join(app.getPath('userData'), 'team-local.json');
  const sessFile = () => path.join(app.getPath('userData'), 'team-session.json');
  let hb = null, incT = null, me = null, teamId = null, seenIncoming = new Set();

  // ---- yerel ayar (apiKey, projectId, seçili takım, repo yolları — repo yolları sunucuya gitmez) ----
  const readLocal = () => { try { return JSON.parse(fs.readFileSync(localFile(), 'utf8')); } catch { return {}; } };
  const writeLocal = (o) => { try { fs.writeFileSync(localFile(), JSON.stringify(o, null, 2), { mode: 0o600 }); } catch { /* yoksay */ } };
  const patchLocal = (p) => { const l = Object.assign(readLocal(), p); writeLocal(l); return l; };
  const readSess = () => { try { return JSON.parse(fs.readFileSync(sessFile(), 'utf8')); } catch { return null; } };
  const writeSess = (o) => { if (!o) { try { fs.unlinkSync(sessFile()); } catch { /* yok */ } return; } fs.writeFileSync(sessFile(), JSON.stringify(o), { mode: 0o600 }); };
  const configured = () => { const l = readLocal(); return !!(l.apiKey && l.projectId); };

  // ---- Firebase Auth (e-posta/şifre) — REST; yalnızca yenileme belirteci diske yazılır ----
  async function authCall(endpoint, body) {
    const key = readLocal().apiKey;
    const r = await fetch(`${AUTH_URL}/v1/accounts:${endpoint}?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) { const m = (j.error && j.error.message) || 'Hata'; throw new Error({ EMAIL_EXISTS: 'Bu e-posta zaten kayıtlı; "Giriş yap"ı deneyin.', INVALID_LOGIN_CREDENTIALS: 'E-posta veya şifre yanlış.', INVALID_PASSWORD: 'Şifre yanlış.', EMAIL_NOT_FOUND: 'Bu e-posta kayıtlı değil.', WEAK_PASSWORD: 'Şifre en az 6 karakter olmalı.', OPERATION_NOT_ALLOWED: 'Firebase\'de E-posta/Şifre girişi etkin değil (Authentication › Sign-in method).', API_KEY_INVALID: 'API anahtarı geçersiz.' }[m.split(' ')[0]] || m); }
    return j;
  }
  function storeAuth(j, name) {
    const prev = readSess() || {};
    writeSess({ uid: j.localId, email: j.email || prev.email, name: name || j.displayName || prev.name || (j.email || '').split('@')[0], refresh: j.refreshToken, idToken: j.idToken, exp: Date.now() + (Number(j.expiresIn) || 3600) * 1000 });
  }
  async function signIn({ email, password, name, signUp }) {
    if (!configured()) throw new Error('Önce Firebase proje bilgilerini girin.');
    const j = await authCall(signUp ? 'signUp' : 'signInWithPassword', { email: String(email).trim(), password, returnSecureToken: true });
    storeAuth(j, signUp ? String(name || '').trim() : j.displayName);
    return true;
  }
  async function token() {
    const s = readSess(); if (!s) return null;
    if (s.exp - Date.now() > 5 * 60 * 1000) return s.idToken;
    const r = await fetch(`${TOKEN_URL}/v1/token?key=${readLocal().apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refresh)}` });
    const j = await r.json();
    if (!r.ok) { writeSess(null); return null; }
    writeSess(Object.assign(s, { idToken: j.id_token, refresh: j.refresh_token, exp: Date.now() + Number(j.expires_in) * 1000 }));
    return j.id_token;
  }
  async function currentUser() {
    if (!configured()) return null;
    const t = await token(); const s = readSess();
    return t && s ? { id: s.uid, name: s.name || 'Üye', avatar: null, email: s.email } : null;
  }

  // ---- Firestore REST ----
  const base = () => `${FS_URL}/v1/projects/${readLocal().projectId}/databases/(default)/documents`;
  async function fs_(method, url, body) {
    const t = await token(); if (!t) throw new Error('Oturum açık değil.');
    const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const m = (j.error && j.error.message) || r.statusText; throw new Error(r.status === 403 ? 'Yetki yok (Firestore kurallarını yayınladınız mı?): ' + m : m); }
    return j;
  }
  const fsGet = async (p) => { try { return docOut(await fs_('GET', `${base()}/${p}`)); } catch (e) { if (/not.?found|NOT_FOUND|No document/i.test(e.message)) return null; throw e; } };
  const fsList = async (p, { order, limit = 200 } = {}) => { const j = await fs_('GET', `${base()}/${p}?pageSize=${limit}${order ? '&orderBy=' + encodeURIComponent(order) : ''}`); return (j.documents || []).map(docOut); };
  const fsSet = (p, obj) => fs_('PATCH', `${base()}/${p}`, { fields: fieldsOf(obj) });
  const fsUpdate = (p, obj, paths) => fs_('PATCH', `${base()}/${p}?${(paths || Object.keys(obj)).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&')}&currentDocument.exists=true`, { fields: fieldsOf(obj) });
  const fsAdd = async (p, obj) => docOut(await fs_('POST', `${base()}/${p}`, { fields: fieldsOf(obj) })).id;
  async function fsWhere(parent, coll, filters) {   // eşitlik filtreleri (bileşik indeks gerekmez)
    const f = filters.map(([field, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toFs(value) } }));
    const j = await fs_('POST', `${base()}${parent ? '/' + parent : ''}:runQuery`, { structuredQuery: { from: [{ collectionId: coll }], where: f.length === 1 ? f[0] : { compositeFilter: { op: 'AND', filters: f } }, limit: 200 } });
    return (Array.isArray(j) ? j : []).filter((x) => x.document).map((x) => docOut(x.document));
  }
  const T_ = () => `teams/${teamId}`;
  const sh = (cmd, args, cwd) => new Promise((resolve) => execFile(cmd, args, { cwd, timeout: 60000, maxBuffer: 4e6, env: process.env }, (err, out, errOut) => resolve({ ok: !err, out: String(out || '').trim(), err: String(errOut || (err && err.message) || '').trim() })));

  // ---- presence (heartbeat) + gelen görev yoklaması; Firestore REST'te canlı dinleme yok, kısa aralıkla yoklanır ----
  async function startRealtime() {
    stopRealtime();
    if (!configured() || !teamId || !me) return;
    const beat = async () => {
      const ws = loadSettings().workspace || null;
      let branch = null;
      if (ws) { const b = await sh('git', ['branch', '--show-current'], ws); if (b.ok) branch = b.out || null; }
      try { await fsUpdate(`${T_()}/members/${me.id}`, { last_seen: nowIso(), active_repo: ws ? path.basename(ws) : null, active_branch: branch }); } catch { /* ağ yok */ }
    };
    const poll = async () => {
      try {
        const mine = await fsWhere(T_(), 'tasks', [['to_user', me.id], ['status', 'pending']]);
        let fresh = false;
        for (const t of mine) if (!seenIncoming.has(t.id)) { seenIncoming.add(t.id); fresh = true; send('team:incoming', { id: t.id, title: t.title }); }
        if (fresh) send('team:changed', true);
      } catch { /* ağ yok */ }
    };
    beat(); poll();
    hb = setInterval(beat, HEARTBEAT_MS);
    incT = setInterval(poll, INCOMING_POLL_MS);
  }
  function stopRealtime() { clearInterval(hb); clearInterval(incT); hb = null; incT = null; }

  // ---- anlık görüntü (arayüz için) ----
  // Firestore şeması: teams/{t} · members/{uid} · team_repos/{repo} · member_repos/{uid__repo} · tasks · topics (seçenek/oy/yorum gömülü) · decisions · notes
  async function snapshot() {
    const l = readLocal();
    const out = { configured: configured(), projectId: l.projectId || '', signedIn: false, user: null, team: null, local: { repoPaths: l.repoPaths || {} } };
    if (!out.configured) return out;
    me = await currentUser();
    if (!me) return out;
    out.signedIn = true; out.user = me;
    const u = await fsGet(`users/${me.id}`);
    teamId = (u && u.teamId) || l.teamId || null;
    if (!teamId) return out;
    const team = await fsGet(T_());
    if (!team) { teamId = null; return out; }
    out.team = { id: teamId, name: team.name, invite_code: teamId + team.inviteCode };
    const L = (c, o) => fsList(`${T_()}/${c}`, o).catch(() => []);
    const [members, teamRepos, memberRepos, tasks, topics, decisions, notes] = await Promise.all([
      L('members'), L('team_repos'), L('member_repos'), L('tasks', { order: 'created_at desc', limit: 100 }),
      L('topics', { order: 'created_at desc', limit: 60 }), L('decisions', { order: 'created_at desc', limit: 100 }), L('notes', { order: 'created_at desc', limit: 30 })
    ]);
    Object.assign(out, {
      members, teamRepos, memberRepos, tasks, decisions, notes,
      topics: topics.map((t) => ({ ...t, options: t.options || [], votes: Object.entries(t.votes || {}).map(([user_id, option_id]) => ({ user_id, option_id, topic_id: t.id })), comments: t.comments || [] }))
    });
    if (!hb) startRealtime();
    return out;
  }
  const needTeam = () => { if (!teamId || !me) throw new Error('Önce bir takıma katılın.'); };

  // ---- repo: gh özeti ----
  async function syncRepos() {
    needTeam();
    const paths = readLocal().repoPaths || {};
    const teamRepos = await fsList(`${T_()}/team_repos`);
    let n = 0;
    for (const { full_name } of teamRepos) {
      const local = paths[full_name];
      const installed = !!(local && fs.existsSync(local));
      const row = { user_id: me.id, full_name, installed, branch: null, last_commit_sha: null, last_commit_msg: null, last_commit_at: null, open_prs: [], synced_at: nowIso() };
      if (installed) { const b = await sh('git', ['branch', '--show-current'], local); if (b.ok) row.branch = b.out || null; }
      const prs = await sh('gh', ['pr', 'list', '-R', full_name, '--state', 'open', '--limit', '10', '--json', 'number,title,url,author,headRefName']);
      if (prs.ok) { try { row.open_prs = JSON.parse(prs.out || '[]').map((p) => ({ number: p.number, title: p.title, url: p.url, author: (p.author && p.author.login) || '', branch: p.headRefName || '' })); } catch { /* yoksay */ } }
      const cm = await sh('gh', ['api', `repos/${full_name}/commits?per_page=1`, '--jq', '.[0] | [.sha, .commit.message, .commit.author.date] | @tsv']);
      if (cm.ok && cm.out) { const [sha, msg, at] = cm.out.split('\t'); row.last_commit_sha = sha; row.last_commit_msg = String(msg || '').split('\n')[0].slice(0, 200); row.last_commit_at = at; }
      await fsSet(`${T_()}/member_repos/${me.id}__${idOf(full_name)}`, row);
      n++;
    }
    return n;
  }

  // ---- çakışma bağlamı ----
  async function loadContext() {
    needTeam();
    const L = (c) => fsList(`${T_()}/${c}`, { limit: 200 }).catch(() => []);
    const [decisions, tasks, topics, notes] = await Promise.all([L('decisions'), L('tasks'), L('topics'), L('notes')]);
    return { decisions: decisions.filter((d) => d.active !== false), tasks, topics: topics.filter((t) => t.status === 'open'), notes: notes.slice(0, 30) };
  }
  const checkConflict = async (req) => detectConflict(req, await loadContext(), oneShot);

  // ---- görev isteği ----
  async function submitTask({ req, verdict, action, ignoreReason }) {
    needTeam();
    const row = { team_id: teamId, from_user: me.id, to_user: req.to_user, title: req.title, description: req.description || '', repo: req.repo || null, conflict: verdict || null, ignore_reason: null, topic_id: null, result: null, created_at: nowIso(), updated_at: nowIso() };
    if (action === 'discuss' && verdict && verdict.verdict === 'major') {
      const taskId = await fsAdd(`${T_()}/tasks`, { ...row, status: 'discussion' });
      const cur = (verdict.items || []).map((i) => `[${i.kind}] ${i.why}`).join('\n');
      const options = (verdict.options || []).map((o) => ({ id: rid(), label: o.label, detail: o.detail, kind: o.kind }));
      const topicId = await fsAdd(`${T_()}/topics`, { team_id: teamId, opened_by: me.id, title: `Çakışma: ${req.title}`.slice(0, 120), current_state: cur, request_a: (verdict.items[0] && verdict.items[0].why) || '', request_b: `${req.title}\n${req.description || ''}`.trim(), reason: verdict.reason || '', repo: req.repo || null, task_id: taskId, status: 'open', created_at: nowIso(), options, votes: {}, comments: [] });
      await fsUpdate(`${T_()}/tasks/${taskId}`, { topic_id: topicId, updated_at: nowIso() });
      return { status: 'discussion', topic_id: topicId };
    }
    if (action === 'ignore') { await fsAdd(`${T_()}/tasks`, { ...row, status: 'ignored', ignore_reason: String(ignoreReason || 'Küçük çakışma, yoksayıldı').slice(0, 300) }); return { status: 'ignored' }; }
    await fsAdd(`${T_()}/tasks`, { ...row, status: 'pending' });
    return { status: 'pending' };
  }

  // Alıcı: kabul/ret. Kabulde iş alıcının makinesinde, alıcının Claude hesabıyla çalışır.
  async function respondTask(id, accept) {
    needTeam();
    const t = await fsGet(`${T_()}/tasks/${id}`);
    if (!t) throw new Error('Görev bulunamadı.');
    if (t.to_user !== me.id) throw new Error('Bu görev size ait değil.');
    if (t.status !== 'pending') throw new Error('Görev artık beklemede değil.');
    if (!accept) { await fsUpdate(`${T_()}/tasks/${id}`, { status: 'declined', updated_at: nowIso() }); return true; }
    const local = (readLocal().repoPaths || {})[t.repo];
    if (!local || !fs.existsSync(local)) throw new Error(`"${t.repo}" bu bilgisayarda kurulu değil. Takım sekmesinden bağlayın veya klonlayın, sonra tekrar deneyin.`);
    await fsUpdate(`${T_()}/tasks/${id}`, { status: 'running', updated_at: nowIso() });
    runTask(t, local).catch(() => { /* durum runTask içinde işlenir */ });
    return true;
  }

  async function runTask(t, cwd) {
    const finish = async (status, result) => { try { await fsUpdate(`${T_()}/tasks/${t.id}`, { status, result, updated_at: nowIso() }); } catch { /* ağ */ } send('team:changed', true); };
    try {
      const exe = findClaudeExe(); if (!exe) throw new Error('claude bulunamadı');
      const { query } = await loadSdk();
      const slug = t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'gorev';
      const prompt = `Takım arkadaşından gelen görev isteği.\nBaşlık: ${t.title}\nAçıklama: ${t.description || '-'}\nRepo: ${t.repo}\n\nYapılacaklar: Gerekli değişikliği yap. Yeni bir dal aç (ekip/${slug}), commit'le. Uzak depoya itme ve PR açma yalnızca işi tamamen bitirdiysen ve testler/derleme geçtiyse: önce git push -u origin ekip/${slug}, sonra gh pr create. Son mesajında 3-5 cümlelik Türkçe özet yaz; PR açtıysan adresini yaz.`;
      let text = '';
      const q = query({ prompt, options: { cwd, pathToClaudeCodeExecutable: exe, model: 'claude-sonnet-5-5', settingSources: ['project'], permissionMode: 'dontAsk', allowedTools: TASK_TOOLS, maxTurns: 40, env: childEnv() } });
      for await (const m of q) if (m.type === 'result') text = m.result || '';
      const st = await sh('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], cwd);
      const pr = (text.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/) || [])[0] || null;
      await finish('done', { summary: text.slice(0, 1500), files: st.ok ? st.out.split('\n').filter(Boolean).slice(0, 40) : [], pr_url: pr });
    } catch (e) { await finish('failed', { summary: 'Çalıştırılamadı: ' + (e && e.message || e), files: [], pr_url: null }); }
  }

  // ---- Tartışma / karar ----
  async function decideTopic(topicId, optionId) {
    needTeam();
    const topic = await fsGet(`${T_()}/topics/${topicId}`);
    const opt = (topic.options || []).find((o) => o.id === optionId);
    if (!opt) throw new Error('Seçenek bulunamadı.');
    const task = topic.task_id ? await fsGet(`${T_()}/tasks/${topic.task_id}`) : null;
    const conflicting = task && task.conflict && task.conflict.items ? task.conflict.items.filter((i) => i.kind === 'karar').map((i) => i.id) : [];
    if (opt.kind !== 'a') for (const id of conflicting) await fsUpdate(`${T_()}/decisions/${id}`, { active: false }).catch(() => {});
    if (opt.kind !== 'a' || !conflicting.length) await fsAdd(`${T_()}/decisions`, { team_id: teamId, statement: `${opt.label}${opt.detail ? ' — ' + opt.detail : ''}`.slice(0, 400), area: null, repo: topic.repo || null, topic_id: topicId, task_id: topic.task_id || null, decided_by: me.id, active: true, created_at: nowIso() });
    await fsUpdate(`${T_()}/topics/${topicId}`, { status: 'decided' });
    if (task) { const apply = opt.kind !== 'a'; await fsUpdate(`${T_()}/tasks/${task.id}`, { status: apply ? 'pending' : 'declined', description: apply ? `${task.description}\n\nTakım kararı: ${opt.label} — ${opt.detail}` : task.description, updated_at: nowIso() }); }
    return true;
  }

  // ---- takım kur / katıl ----
  const newSecret = () => Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  async function createTeam(name) {
    await snapshot(); if (!me) throw new Error('Önce giriş yapın.');
    const secret = newSecret();
    const id = await fsAdd('teams', { name, inviteCode: secret, createdBy: me.id, created_at: nowIso() });
    await fsSet(`teams/${id}/members/${me.id}`, { user_id: me.id, team_id: id, display_name: me.name, role: 'owner', code: secret, joined_at: nowIso(), last_seen: nowIso(), topic: '', active_repo: null, active_branch: null, last_activity_at: null });
    await fsSet(`users/${me.id}`, { teamId: id });
    patchLocal({ teamId: id }); teamId = id;
    return true;
  }
  async function joinTeam(raw) {
    await snapshot(); if (!me) throw new Error('Önce giriş yapın.');
    const m = String(raw).match(/code=([0-9a-zA-Z]+)/); const code = (m ? m[1] : String(raw)).trim();
    if (code.length < 21) throw new Error('Davet kodu geçersiz.');
    const id = code.slice(0, 20), secret = code.slice(20);
    try { await fsSet(`teams/${id}/members/${me.id}`, { user_id: me.id, team_id: id, display_name: me.name, role: 'member', code: secret, joined_at: nowIso(), last_seen: nowIso(), topic: '', active_repo: null, active_branch: null, last_activity_at: null }); }
    catch (e) { throw new Error('Katılınamadı: davet kodu yanlış olabilir. (' + e.message + ')'); }
    await fsSet(`users/${me.id}`, { teamId: id });
    patchLocal({ teamId: id }); teamId = id;
    return true;
  }

  // ---- IPC ----
  const H = (name, fn) => ipcMain.handle(name, async (_e, a) => { try { return { ok: true, data: await fn(a) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } });
  H('team:snapshot', snapshot);
  H('team:config', async ({ apiKey, projectId }) => { const k = String(apiKey || '').trim(); patchLocal(Object.assign({ projectId: String(projectId).trim() }, k ? { apiKey: k } : {})); return true; });
  H('team:signIn', signIn);
  H('team:signOut', async () => { stopRealtime(); writeSess(null); me = null; teamId = null; return true; });
  H('team:create', ({ name }) => createTeam(name));
  H('team:join', ({ code }) => joinTeam(code));
  H('team:setTopic', async (topic) => { needTeam(); await fsUpdate(`${T_()}/members/${me.id}`, { topic: String(topic || '').slice(0, 140), last_activity_at: nowIso() }); return true; });
  H('team:ghRepos', async () => { const r = await sh('gh', ['repo', 'list', '--limit', '60', '--json', 'nameWithOwner,isPrivate']); if (!r.ok) throw new Error('gh çalışmadı (gh auth login yapın): ' + r.err); return JSON.parse(r.out || '[]'); });
  H('team:addRepo', async (full) => { needTeam(); await fsSet(`${T_()}/team_repos/${idOf(full)}`, { full_name: full, added_by: me.id, added_at: nowIso() }); return true; });
  H('team:connectRepo', async ({ full_name, path: p }) => { if (!fs.existsSync(path.join(p, '.git'))) throw new Error('Seçilen klasör bir git deposu değil.'); const l = readLocal(); patchLocal({ repoPaths: Object.assign({}, l.repoPaths, { [full_name]: p }) }); return syncRepos(); });
  H('team:cloneRepo', async ({ full_name, dir }) => { const dest = path.join(dir, full_name.split('/')[1]); const r = await sh('gh', ['repo', 'clone', full_name, dest]); if (!r.ok) throw new Error('Klonlanamadı: ' + r.err); const l = readLocal(); patchLocal({ repoPaths: Object.assign({}, l.repoPaths, { [full_name]: dest }) }); return syncRepos(); });
  H('team:syncRepos', syncRepos);
  H('team:check', checkConflict);
  H('team:submitTask', submitTask);
  H('team:respondTask', ({ id, accept }) => respondTask(id, accept));
  H('team:withdrawTask', async (id) => { needTeam(); await fsUpdate(`${T_()}/tasks/${id}`, { status: 'declined', updated_at: nowIso() }); return true; });
  H('team:vote', async ({ topicId, optionId }) => { needTeam(); await fs_('PATCH', `${base()}/${T_()}/topics/${topicId}?updateMask.fieldPaths=votes.${'`' + me.id + '`'}&currentDocument.exists=true`, { fields: { votes: { mapValue: { fields: { [me.id]: toFs(optionId) } } } } }); return true; });
  H('team:comment', async ({ topicId, body }) => { needTeam(); const t = await fsGet(`${T_()}/topics/${topicId}`); const comments = (t.comments || []).concat([{ user_id: me.id, body: String(body).slice(0, 2000), created_at: nowIso() }]); await fsUpdate(`${T_()}/topics/${topicId}`, { comments }); return true; });
  H('team:decide', ({ topicId, optionId }) => decideTopic(topicId, optionId));
  H('team:addNote', async ({ title, body, repo }) => { needTeam(); await fsAdd(`${T_()}/notes`, { team_id: teamId, title, body: String(body).slice(0, 20000), repo: repo || null, created_by: me.id, created_at: nowIso() }); return true; });
  H('team:addDecision', async ({ statement, area, repo }) => { needTeam(); await fsAdd(`${T_()}/decisions`, { team_id: teamId, statement, area: area || null, repo: repo || null, topic_id: null, task_id: null, decided_by: me.id, active: true, created_at: nowIso() }); return true; });
  H('team:pickDir', async () => { const { dialog } = require('electron'); const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });

  return { handleJoinUrl: (url) => { try { const u = new URL(url); const code = u.searchParams.get('code'); if (code) send('team:join-link', code); } catch { /* yoksay */ } } };
}

module.exports = { init };
