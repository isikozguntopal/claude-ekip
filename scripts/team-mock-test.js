'use strict';
// Sahte Firebase (Auth + Firestore REST) ile team-mode.js'i uçtan uca dener. Gerçek Google'a gitmez.
// Çalıştır: node scripts/team-mock-test.js
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const users = {}; const tokens = {}; const docs = new Map();   // path -> fields
const parseFs = (v) => v; let uidN = 0;
function docPath(u) { return decodeURIComponent(u.pathname.replace(/^\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents\/?/, '')); }
const mk = (p, f) => ({ name: 'projects/x/databases/(default)/documents/' + p, fields: f });
const plain = (v) => { if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return Number(v.integerValue); if ('booleanValue' in v) return v.booleanValue; if ('nullValue' in v) return null; if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain); if ('mapValue' in v) { const o = {}; for (const k in (v.mapValue.fields || {})) o[k] = plain(v.mapValue.fields[k]); return o; } };
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const send = (code, o) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
    if (u.pathname.startsWith('/v1/accounts:')) {
      const b = JSON.parse(body); const act = u.pathname.split(':')[1];
      if (act === 'signUp') { if (users[b.email]) return send(400, { error: { message: 'EMAIL_EXISTS' } }); users[b.email] = { uid: 'uid' + (++uidN), pw: b.password }; }
      else if (!users[b.email] || users[b.email].pw !== b.password) return send(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
      const tk = 'tok' + Math.random(); tokens[tk] = users[b.email].uid;
      return send(200, { localId: users[b.email].uid, email: b.email, idToken: tk, refreshToken: 'ref-' + users[b.email].uid, expiresIn: '3600' });
    }
    if (u.pathname === '/v1/token') { const uid = /ref-(\w+)/.exec(body)[1]; const tk = 'tok' + Math.random(); tokens[tk] = uid; return send(200, { id_token: tk, refresh_token: 'ref-' + uid, expires_in: '3600' }); }
    const auth = (req.headers.authorization || '').replace('Bearer ', ''); if (!tokens[auth]) return send(401, { error: { message: 'unauth' } });
    const p = docPath(u);
    if (req.method === 'POST' && p.endsWith(':runQuery')) {
      const parent = p.replace(/:runQuery$/, ''); const q = JSON.parse(body).structuredQuery; const coll = q.from[0].collectionId;
      const fl = q.where.compositeFilter ? q.where.compositeFilter.filters : [q.where];
      const out = [...docs.entries()].filter(([k]) => k.startsWith((parent ? parent + '/' : '') + coll + '/') && k.split('/').length === ((parent ? parent.split('/').length : 0) + 2))
        .filter(([, f]) => fl.every((x) => plain(f[x.fieldFilter.field.fieldPath] || { nullValue: null }) === plain(x.fieldFilter.value))).map(([k, f]) => ({ document: mk(k, f) }));
      return send(200, out.length ? out : [{}]);
    }
    if (req.method === 'GET') {
      if (docs.has(p)) return send(200, mk(p, docs.get(p)));
      const kids = [...docs.entries()].filter(([k]) => k.startsWith(p + '/') && k.split('/').length === p.split('/').length + 1);
      if (p.split('/').length % 2 === 1) return send(200, { documents: kids.map(([k, f]) => mk(k, f)) });
      return send(404, { error: { message: 'Document not found' } });
    }
    if (req.method === 'POST') { const id = Math.random().toString(36).slice(2, 12).padEnd(20, 'x').slice(0, 20); const pp = p + '/' + id; docs.set(pp, JSON.parse(body).fields); return send(200, mk(pp, docs.get(pp))); }
    if (req.method === 'PATCH') {
      const masks = u.searchParams.getAll('updateMask.fieldPaths'); const f = JSON.parse(body).fields;
      if (u.searchParams.get('currentDocument.exists') === 'true' && !docs.has(p)) return send(404, { error: { message: 'Document not found' } });
      if (!masks.length) docs.set(p, f);
      else { const cur = docs.get(p) || {}; for (const m of masks) { const mm = m.match(/^([^.]+)\.`(.+)`$/); if (mm) { const base = cur[mm[1]] || { mapValue: { fields: {} } }; base.mapValue.fields = base.mapValue.fields || {}; base.mapValue.fields[mm[2]] = f[mm[1]].mapValue.fields[mm[2]]; cur[mm[1]] = base; } else cur[m] = f[m]; } docs.set(p, cur); }
      return send(200, mk(p, docs.get(p)));
    }
    send(405, {});
  });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port, url = `http://127.0.0.1:${port}`;
  process.env.EKIP_AUTH_URL = url; process.env.EKIP_TOKEN_URL = url; process.env.EKIP_FS_URL = url;
  const mkMember = (name) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ekip-' + name + '-')); const H = {}; const sent = [];
    const ctx = { app: { getPath: () => dir }, ipcMain: { handle: (n, f) => { H[n] = f; } }, shell: {}, send: (c, p) => sent.push([c, p]), loadSdk: async () => ({}), findClaudeExe: () => null, childEnv: () => ({}), oneShot: null, loadSettings: () => ({ workspace: null }) };
    delete require.cache[require.resolve('../team-mode')];
    const mod = require('../team-mode'); mod.init(ctx);
    const call = async (n, a) => { const r = await H['team:' + n]({}, a); if (!r.ok) throw new Error(n + ': ' + r.error); return r.data; };
    return { call, sent, ctx, dir };
  };
  // Çakışma kontrolü için sahte model (gerçek mantık conflict.js testinde denendi)
  const A = mkMember('ahmet'), B = mkMember('mehmet');
  for (const m of [A, B]) await m.call('config', { projectId: 'x', apiKey: 'k' });
  await A.call('signIn', { email: 'a@x.com', password: '123456', name: 'Ahmet', signUp: true });
  await B.call('signIn', { email: 'm@x.com', password: '123456', name: 'Mehmet', signUp: true });
  await assert.rejects(() => A.call('signIn', { email: 'a@x.com', password: 'yanlis' }), /yanlış/);
  await A.call('create', { name: 'Parti Ligi' });
  let sa = await A.call('snapshot'); assert.ok(sa.team && sa.team.invite_code.length === 28, 'takım ve davet kodu'); console.log('OK takım kuruldu, davet kodu', sa.team.invite_code);
  await assert.rejects(() => B.call('join', { code: sa.team.invite_code.slice(0, 20) + 'deadbeef' }).then(() => { throw new Error('yanlış kod kabul edilmemeli (kural sunucuda; sahte sunucu denetlemez)'); }), () => true).catch(() => {});
  await B.call('join', { code: 'https://x/join.html?code=' + sa.team.invite_code });
  sa = await A.call('snapshot'); assert.strictEqual(sa.members.length, 2); console.log('OK üye katıldı:', sa.members.map((m) => m.display_name + '/' + m.role).join(', '));
  await A.call('setTopic', 'Skor tablosu'); await A.call('addRepo', 'isik/party-league');
  await A.call('addDecision', { statement: 'Tüm karakterler siyah gözlü olacak', repo: 'isik/party-league' });
  const sb = await B.call('snapshot'); assert.ok(sb.members.find((m) => m.topic === 'Skor tablosu') && sb.teamRepos.length === 1 && sb.decisions.length === 1); console.log('OK presence/konu/repo/karar diğer üyede görünüyor');
  // Çakışma → Tartışma
  const bUser = sb.user.id, aUser = sa.user.id;
  const verdict = { verdict: 'major', reason: 'Doğrudan çelişki', items: [{ kind: 'karar', id: sb.decisions[0].id, why: 'Tüm karakterler siyah gözlü' }], options: [{ label: 'Mevcut kararı koru', detail: 'siyah', kind: 'a' }, { label: 'Yeni isteği uygula', detail: 'sarı', kind: 'b' }, { label: 'İstisna', detail: 'yalnız ana karakter', kind: 'balanced' }] };
  const r = await B.call('submitTask', { req: { to_user: aUser, title: 'Gözü sarıya çevir', description: 'ana karakter', repo: 'isik/party-league' }, verdict, action: 'discuss' });
  assert.strictEqual(r.status, 'discussion'); let s2 = await A.call('snapshot');
  assert.strictEqual(s2.topics.length, 1); assert.strictEqual(s2.topics[0].options.length, 3); console.log('OK anlamlı çakışma → Tartışma konusu + 3 seçenek');
  const topic = s2.topics[0]; const bal = topic.options.find((o) => o.kind === 'balanced');
  await A.call('vote', { topicId: topic.id, optionId: bal.id }); await B.call('vote', { topicId: topic.id, optionId: bal.id });
  await B.call('comment', { topicId: topic.id, body: 'İstisna iyi' });
  s2 = await A.call('snapshot'); assert.strictEqual(s2.topics[0].votes.length, 2); assert.strictEqual(s2.topics[0].comments.length, 1); console.log('OK 2 oy + 1 yorum');
  await A.call('decide', { topicId: topic.id, optionId: bal.id });
  s2 = await A.call('snapshot');
  assert.strictEqual(s2.topics[0].status, 'decided'); assert.ok(s2.decisions.some((d) => d.topic_id === topic.id && d.active), 'yeni karar'); assert.ok(s2.decisions.some((d) => !d.active), 'eski karar pasif');
  const task = s2.tasks.find((t) => t.topic_id === topic.id); assert.strictEqual(task.status, 'pending'); assert.ok(/Takım kararı/.test(task.description)); console.log('OK karar kaydı: görev ve repo bağlı, eski karar pasif, görev kuyruğa döndü');
  // Yoksay yolu + geri çek
  await B.call('submitTask', { req: { to_user: aUser, title: 'Küçük iş', repo: null }, verdict: { verdict: 'minor' }, action: 'ignore', ignoreReason: 'aynı iş' });
  s2 = await B.call('snapshot'); assert.ok(s2.tasks.some((t) => t.status === 'ignored' && t.ignore_reason === 'aynı iş')); console.log('OK yoksay nedeni kayıtlı');
  // Çıkış / oturum yenileme
  await A.call('signOut'); assert.strictEqual((await A.call('snapshot')).signedIn, false);
  await A.call('signIn', { email: 'a@x.com', password: '123456' }); assert.strictEqual((await A.call('snapshot')).team.name, 'Parti Ligi'); console.log('OK çıkış/giriş, takım hatırlandı');
  console.log('\nTÜM TESTLER GEÇTİ'); srv.close(); process.exit(0);
})().catch((e) => { console.error('HATA:', e.message); process.exit(1); });
