'use strict';
// Takım modu (ana süreç): Supabase auth/DB/realtime, presence, repo özeti (gh), görev kuyruğu,
// çakışma tespiti, Tartışma/karar. Sunucuya yalnızca metadata yazılır; sohbet/prompt/yanıt yazılmaz.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const { detectConflict } = require('./conflict');

const AUTH_PORT = 54821;                       // Supabase > Auth > Redirect URLs: http://127.0.0.1:54821/cb
const HEARTBEAT_MS = 30000;
const TASK_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(git *)', 'Bash(gh pr *)'];

function init(ctx) {
  const { app, ipcMain, shell, send, loadSdk, findClaudeExe, childEnv, oneShot, loadSettings } = ctx;
  const localFile = () => path.join(app.getPath('userData'), 'team-local.json');
  const sessFile = () => path.join(app.getPath('userData'), 'team-session.json');
  let client = null, channel = null, hb = null, refreshT = null, me = null, teamId = null;

  // ---- yerel ayar (URL, anon key, seçili takım, repo yolları — repo yolları sunucuya gitmez) ----
  const readLocal = () => { try { return JSON.parse(fs.readFileSync(localFile(), 'utf8')); } catch { return {}; } };
  const writeLocal = (o) => { try { fs.writeFileSync(localFile(), JSON.stringify(o, null, 2), { mode: 0o600 }); } catch { /* yoksay */ } };
  const patchLocal = (p) => { const l = Object.assign(readLocal(), p); writeLocal(l); return l; };

  // Supabase oturumu diske yazılır (yalnızca bu bilgisayar)
  const storage = {
    getItem: (k) => { try { return JSON.parse(fs.readFileSync(sessFile(), 'utf8'))[k] || null; } catch { return null; } },
    setItem: (k, v) => { let o = {}; try { o = JSON.parse(fs.readFileSync(sessFile(), 'utf8')); } catch { /* yeni */ } o[k] = v; fs.writeFileSync(sessFile(), JSON.stringify(o), { mode: 0o600 }); },
    removeItem: (k) => { let o = {}; try { o = JSON.parse(fs.readFileSync(sessFile(), 'utf8')); } catch { return; } delete o[k]; fs.writeFileSync(sessFile(), JSON.stringify(o), { mode: 0o600 }); }
  };

  function getClient() {
    const l = readLocal();
    if (!l.url || !l.anonKey) return null;
    if (client && client.__url === l.url) return client;
    const { createClient } = require('@supabase/supabase-js');
    client = createClient(l.url, l.anonKey, { auth: { flowType: 'pkce', storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } });
    client.__url = l.url;
    return client;
  }
  const must = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  const sh = (cmd, args, cwd) => new Promise((resolve) => execFile(cmd, args, { cwd, timeout: 60000, maxBuffer: 4e6, env: process.env }, (err, out, errOut) => resolve({ ok: !err, out: String(out || '').trim(), err: String(errOut || (err && err.message) || '').trim() })));

  // ---- giriş (sistem tarayıcısı + 127.0.0.1 geri dönüşü + PKCE) ----
  function signIn(provider) {
    const c = getClient();
    if (!c) throw new Error('Önce Supabase adresi ve anon key girin.');
    return new Promise(async (resolve, reject) => {
      const redirectTo = `http://127.0.0.1:${AUTH_PORT}/cb`;
      const srv = http.createServer(async (req, res) => {
        const u = new URL(req.url, redirectTo);
        if (u.pathname !== '/cb') { res.statusCode = 404; return res.end(); }
        const code = u.searchParams.get('code');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<body style="font:16px system-ui;background:#17141f;color:#ece6f6;padding:40px"><h2>Giriş tamamlandı</h2>Bu sekmeyi kapatıp Claude Ekibim\'e dönebilirsiniz.</body>');
        srv.close();
        try {
          if (!code) throw new Error(u.searchParams.get('error_description') || 'Giriş kodu alınamadı');
          must(await c.auth.exchangeCodeForSession(code));
          resolve(true);
        } catch (e) { reject(e); }
      });
      srv.on('error', (e) => reject(new Error('Giriş için ' + AUTH_PORT + ' portu kullanılamıyor: ' + e.message)));
      srv.listen(AUTH_PORT, '127.0.0.1', async () => {
        try {
          const { data, error } = await c.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
          if (error) throw error;
          shell.openExternal(data.url);
          setTimeout(() => { try { srv.close(); } catch { /* yoksay */ } reject(new Error('Giriş zaman aşımına uğradı')); }, 5 * 60 * 1000);
        } catch (e) { try { srv.close(); } catch { /* yoksay */ } reject(e); }
      });
    });
  }

  async function currentUser() {
    const c = getClient();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    const u = data && data.session && data.session.user;
    if (!u) return null;
    const m = u.user_metadata || {};
    return { id: u.id, name: m.full_name || m.name || m.user_name || (u.email || '').split('@')[0] || 'Üye', avatar: m.avatar_url || null, email: u.email };
  }

  // ---- presence: heartbeat + realtime değişim bildirimi ----
  async function startRealtime() {
    stopRealtime();
    const c = getClient();
    if (!c || !teamId || !me) return;
    const beat = async () => {
      const ws = loadSettings().workspace || null;
      let branch = null;
      if (ws) { const b = await sh('git', ['branch', '--show-current'], ws); if (b.ok) branch = b.out || null; }
      try { await c.from('members').update({ last_seen: new Date().toISOString(), active_repo: ws ? path.basename(ws) : null, active_branch: branch }).match({ team_id: teamId, user_id: me.id }); } catch { /* ağ yok */ }
    };
    beat();
    hb = setInterval(beat, HEARTBEAT_MS);
    const bump = () => { clearTimeout(refreshT); refreshT = setTimeout(() => send('team:changed', true), 400); };
    channel = c.channel('team-' + teamId);
    for (const table of ['members', 'task_requests', 'topics', 'topic_options', 'topic_votes', 'topic_comments', 'decisions', 'member_repos', 'team_repos', 'notes']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
        if (table === 'task_requests' && p.eventType === 'INSERT' && p.new && p.new.to_user === (me && me.id)) send('team:incoming', { id: p.new.id, title: p.new.title });
        bump();
      });
    }
    channel.subscribe();
  }
  function stopRealtime() {
    clearInterval(hb); hb = null;
    if (channel && client) { try { client.removeChannel(channel); } catch { /* yoksay */ } }
    channel = null;
  }

  // ---- anlık görüntü (arayüz için) ----
  async function snapshot() {
    const l = readLocal();
    const base = { configured: !!(l.url && l.anonKey), url: l.url || '', signedIn: false, user: null, team: null, local: { repoPaths: l.repoPaths || {} } };
    const c = getClient();
    if (!c) return base;
    me = await currentUser();
    if (!me) return base;
    base.signedIn = true; base.user = me;
    const mine = (await c.from('members').select('team_id, teams(*)').eq('user_id', me.id)).data || [];
    const pick = mine.find((m) => m.team_id === l.teamId) || mine[0];
    if (!pick) return Object.assign(base, { teams: [] });
    teamId = pick.team_id;
    base.team = pick.teams;
    const q = (t, f) => { let r = c.from(t).select('*'); if (f) r = f(r); return r.then((x) => x.data || []); };
    const [members, teamRepos, memberRepos, tasks, topics, options, votes, comments, decisions, notes] = await Promise.all([
      q('members', (r) => r.eq('team_id', teamId)), q('team_repos', (r) => r.eq('team_id', teamId)), q('member_repos', (r) => r.eq('team_id', teamId)),
      q('task_requests', (r) => r.eq('team_id', teamId).order('created_at', { ascending: false }).limit(100)),
      q('topics', (r) => r.eq('team_id', teamId).order('created_at', { ascending: false }).limit(60)),
      q('topic_options'), q('topic_votes'), q('topic_comments', (r) => r.order('created_at')),
      q('decisions', (r) => r.eq('team_id', teamId).order('created_at', { ascending: false }).limit(100)),
      q('notes', (r) => r.eq('team_id', teamId).order('created_at', { ascending: false }).limit(30))
    ]);
    const tids = new Set(topics.map((t) => t.id));
    Object.assign(base, {
      members, teamRepos, memberRepos, tasks, decisions, notes,
      topics: topics.map((t) => ({ ...t, options: options.filter((o) => o.topic_id === t.id), votes: votes.filter((v) => v.topic_id === t.id), comments: comments.filter((x) => x.topic_id === t.id) })).filter((t) => tids.has(t.id))
    });
    if (!hb) startRealtime();
    return base;
  }

  async function myMember() { return { c: getClient(), me: me || await currentUser() }; }

  // ---- repo: gh özeti ----
  async function syncRepos() {
    const c = getClient(); if (!c || !teamId || !me) return 0;
    const paths = readLocal().repoPaths || {};
    const teamRepos = (await c.from('team_repos').select('full_name').eq('team_id', teamId)).data || [];
    let n = 0;
    for (const { full_name } of teamRepos) {
      const local = paths[full_name];
      const installed = !!(local && fs.existsSync(local));
      const row = { team_id: teamId, user_id: me.id, full_name, installed, synced_at: new Date().toISOString() };
      if (installed) { const b = await sh('git', ['branch', '--show-current'], local); if (b.ok) row.branch = b.out || null; }
      const prs = await sh('gh', ['pr', 'list', '-R', full_name, '--state', 'open', '--limit', '10', '--json', 'number,title,url,author,headRefName']);
      if (prs.ok) { try { row.open_prs = JSON.parse(prs.out || '[]').map((p) => ({ number: p.number, title: p.title, url: p.url, author: p.author && p.author.login, branch: p.headRefName })); } catch { /* yoksay */ } }
      const cm = await sh('gh', ['api', `repos/${full_name}/commits?per_page=1`, '--jq', '.[0] | [.sha, .commit.message, .commit.author.date] | @tsv']);
      if (cm.ok && cm.out) { const [sha, msg, at] = cm.out.split('\t'); row.last_commit_sha = sha; row.last_commit_msg = String(msg || '').split('\n')[0].slice(0, 200); row.last_commit_at = at; }
      await c.from('member_repos').upsert(row);
      n++;
    }
    return n;
  }

  // ---- çakışma bağlamı ----
  async function loadContext() {
    const c = getClient();
    const [decisions, tasks, topics, notes] = await Promise.all([
      c.from('decisions').select('*').eq('team_id', teamId).eq('active', true).limit(200),
      c.from('task_requests').select('id,title,description,repo,status').eq('team_id', teamId).in('status', ['pending', 'accepted', 'running', 'discussion']).limit(200),
      c.from('topics').select('*').eq('team_id', teamId).eq('status', 'open').limit(100),
      c.from('notes').select('id,title,body,repo').eq('team_id', teamId).order('created_at', { ascending: false }).limit(30)
    ]);
    return { decisions: decisions.data || [], tasks: tasks.data || [], topics: topics.data || [], notes: notes.data || [] };
  }
  const checkConflict = async (req) => detectConflict(req, await loadContext(), oneShot);

  // ---- görev isteği ----
  async function submitTask({ req, verdict, action, ignoreReason }) {
    const c = getClient();
    const base = { team_id: teamId, to_user: req.to_user, title: req.title, description: req.description || '', repo: req.repo || null, conflict: verdict || null };
    if (action === 'discuss' && verdict && verdict.verdict === 'major') {
      const task = must(await c.from('task_requests').insert({ ...base, status: 'discussion' }).select().single());
      const cur = (verdict.items || []).map((i) => `[${i.kind}] ${i.why}`).join('\n');
      const topic = must(await c.from('topics').insert({ team_id: teamId, title: `Çakışma: ${req.title}`.slice(0, 120), current_state: cur, request_a: (verdict.items[0] && verdict.items[0].why) || '', request_b: `${req.title}\n${req.description || ''}`.trim(), reason: verdict.reason, repo: req.repo || null, task_id: task.id }).select().single());
      if (verdict.options && verdict.options.length) must(await c.from('topic_options').insert(verdict.options.map((o) => ({ topic_id: topic.id, label: o.label, detail: o.detail, kind: o.kind }))));
      must(await c.from('task_requests').update({ topic_id: topic.id, updated_at: new Date().toISOString() }).eq('id', task.id));
      return { status: 'discussion', topic_id: topic.id };
    }
    if (action === 'ignore') {
      must(await c.from('task_requests').insert({ ...base, status: 'ignored', ignore_reason: String(ignoreReason || 'Küçük çakışma, yoksayıldı').slice(0, 300) }));
      return { status: 'ignored' };
    }
    must(await c.from('task_requests').insert({ ...base, status: 'pending' }));
    return { status: 'pending' };
  }

  // Alıcı: kabul/ret. Kabulde iş alıcının makinesinde, alıcının Claude hesabıyla çalışır.
  async function respondTask(id, accept) {
    const c = getClient();
    const t = must(await c.from('task_requests').select('*').eq('id', id).single());
    if (t.to_user !== me.id) throw new Error('Bu görev size ait değil.');
    if (t.status !== 'pending') throw new Error('Görev artık beklemede değil.');
    if (!accept) { must(await c.from('task_requests').update({ status: 'declined', updated_at: new Date().toISOString() }).eq('id', id)); return true; }
    const local = (readLocal().repoPaths || {})[t.repo];
    if (!local || !fs.existsSync(local)) throw new Error(`"${t.repo}" bu bilgisayarda kurulu değil. Takım sekmesinden bağlayın veya klonlayın, sonra tekrar deneyin.`);
    must(await c.from('task_requests').update({ status: 'running', updated_at: new Date().toISOString() }).eq('id', id));
    runTask(t, local).catch(() => { /* durum runTask içinde işlenir */ });
    return true;
  }

  async function runTask(t, cwd) {
    const c = getClient();
    const finish = async (status, result) => { await c.from('task_requests').update({ status, result, updated_at: new Date().toISOString() }).eq('id', t.id); send('team:changed', true); };
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
    const c = getClient();
    const topic = must(await c.from('topics').select('*').eq('id', topicId).single());
    const opt = must(await c.from('topic_options').select('*').eq('id', optionId).single());
    const task = topic.task_id ? (await c.from('task_requests').select('*').eq('id', topic.task_id).single()).data : null;
    // Karar kaydı: ilgili görev ve repo ile bağlı; çelişen eski karar pasifleşir
    const conflicting = task && task.conflict && task.conflict.items ? task.conflict.items.filter((i) => i.kind === 'karar').map((i) => i.id) : [];
    if (opt.kind !== 'a' && conflicting.length) must(await c.from('decisions').update({ active: false }).in('id', conflicting));
    if (opt.kind !== 'a' || !conflicting.length) must(await c.from('decisions').insert({ team_id: teamId, statement: `${opt.label}${opt.detail ? ' — ' + opt.detail : ''}`.slice(0, 400), area: null, repo: topic.repo, topic_id: topic.id, task_id: topic.task_id }));
    must(await c.from('topics').update({ status: 'decided' }).eq('id', topicId));
    if (task) {
      const apply = opt.kind !== 'a';
      must(await c.from('task_requests').update({ status: apply ? 'pending' : 'declined', description: apply ? `${task.description}\n\nTakım kararı: ${opt.label} — ${opt.detail}` : task.description, updated_at: new Date().toISOString() }).eq('id', task.id));
    }
    return true;
  }

  // ---- IPC ----
  const H = (name, fn) => ipcMain.handle(name, async (_e, a) => { try { return { ok: true, data: await fn(a) }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } });
  H('team:snapshot', snapshot);
  H('team:config', async ({ url, anonKey }) => { const k = String(anonKey || '').trim(); patchLocal(Object.assign({ url: String(url).trim().replace(/\/+$/, '') }, k ? { anonKey: k } : {})); client = null; return true; });
  H('team:signIn', async (provider) => { await signIn(provider); return true; });
  H('team:signOut', async () => { stopRealtime(); const c = getClient(); if (c) await c.auth.signOut(); me = null; teamId = null; return true; });
  H('team:create', async ({ name }) => { await snapshot(); const t = must(await getClient().rpc('create_team', { p_name: name, p_display: me.name, p_avatar: me.avatar })); patchLocal({ teamId: t.id }); return t; });
  H('team:join', async ({ code }) => {
    await snapshot();
    const m = String(code).match(/code=([0-9a-fA-F]+)/); const c0 = (m ? m[1] : String(code)).trim();
    const t = must(await getClient().rpc('join_team', { p_code: c0, p_display: me.name, p_avatar: me.avatar })); patchLocal({ teamId: t.id }); return t;
  });
  H('team:setTopic', async (topic) => { const { c, me: u } = await myMember(); must(await c.from('members').update({ topic: String(topic || '').slice(0, 140), last_activity_at: new Date().toISOString() }).match({ team_id: teamId, user_id: u.id })); return true; });
  H('team:ghRepos', async () => { const r = await sh('gh', ['repo', 'list', '--limit', '60', '--json', 'nameWithOwner,isPrivate']); if (!r.ok) throw new Error('gh çalışmadı (gh auth login yapın): ' + r.err); return JSON.parse(r.out || '[]'); });
  H('team:addRepo', async (full) => { const { c } = await myMember(); must(await c.from('team_repos').upsert({ team_id: teamId, full_name: full })); return true; });
  H('team:connectRepo', async ({ full_name, path: p }) => { if (!fs.existsSync(path.join(p, '.git'))) throw new Error('Seçilen klasör bir git deposu değil.'); const l = readLocal(); patchLocal({ repoPaths: Object.assign({}, l.repoPaths, { [full_name]: p }) }); return syncRepos(); });
  H('team:cloneRepo', async ({ full_name, dir }) => { const dest = path.join(dir, full_name.split('/')[1]); const r = await sh('gh', ['repo', 'clone', full_name, dest]); if (!r.ok) throw new Error('Klonlanamadı: ' + r.err); const l = readLocal(); patchLocal({ repoPaths: Object.assign({}, l.repoPaths, { [full_name]: dest }) }); return syncRepos(); });
  H('team:syncRepos', syncRepos);
  H('team:check', checkConflict);
  H('team:submitTask', submitTask);
  H('team:respondTask', ({ id, accept }) => respondTask(id, accept));
  H('team:withdrawTask', async (id) => { const { c } = await myMember(); must(await c.from('task_requests').update({ status: 'declined', updated_at: new Date().toISOString() }).eq('id', id).eq('from_user', me.id)); return true; });
  H('team:vote', async ({ topicId, optionId }) => { const { c, me: u } = await myMember(); must(await c.from('topic_votes').upsert({ topic_id: topicId, option_id: optionId, user_id: u.id })); return true; });
  H('team:comment', async ({ topicId, body }) => { const { c } = await myMember(); must(await c.from('topic_comments').insert({ topic_id: topicId, body: String(body).slice(0, 2000) })); return true; });
  H('team:decide', ({ topicId, optionId }) => decideTopic(topicId, optionId));
  H('team:addNote', async ({ title, body, repo }) => { const { c } = await myMember(); must(await c.from('notes').insert({ team_id: teamId, title, body: String(body).slice(0, 20000), repo: repo || null })); return true; });
  H('team:addDecision', async ({ statement, area, repo }) => { const { c } = await myMember(); must(await c.from('decisions').insert({ team_id: teamId, statement, area: area || null, repo: repo || null })); return true; });
  H('team:pickDir', async () => { const { dialog } = require('electron'); const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });

  return { handleJoinUrl: (url) => { try { const u = new URL(url); const code = u.searchParams.get('code'); if (code) send('team:join-link', code); } catch { /* yoksay */ } } };
}

module.exports = { init };
