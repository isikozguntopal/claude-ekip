'use strict';
// Takım modu arayüzü: Takım · Görevler · Tartışma · Kararlar. Sunucuya yalnızca metadata gider.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = { snap: null, tab: 'takim', check: null, req: null, busy: false, err: '', draft: { to: '', title: '', desc: '', repo: '' } };
  const SITE = 'https://isikozguntopal.github.io/claude-ekip/join.html';
  const call = async (name, arg) => { const r = await window.ekip.team(name, arg); if (!r.ok) throw new Error(r.error); return r.data; };
  const say = (t, k) => { if (window.toast) window.toast(t, k); };
  const ago = (iso) => { if (!iso) return '—'; const s = (Date.now() - new Date(iso)) / 1000; return s < 90 ? 'şimdi' : s < 3600 ? Math.round(s / 60) + ' dk önce' : s < 86400 ? Math.round(s / 3600) + ' sa önce' : Math.round(s / 86400) + ' gün önce'; };
  const online = (m) => m.last_seen && (Date.now() - new Date(m.last_seen)) < 90000;
  const STATUS = { pending: 'beklemede', accepted: 'kabul edildi', running: 'çalışıyor', done: 'tamamlandı', failed: 'başarısız', declined: 'reddedildi/geri çekildi', ignored: 'yoksayıldı', discussion: 'tartışmada' };

  async function refresh() {
    try { T.snap = await call('snapshot'); T.err = ''; } catch (e) { T.err = e.message; }
    render();
  }
  async function act(fn, okMsg) {
    T.busy = true; render();
    try { await fn(); if (okMsg) say(okMsg); } catch (e) { say(e.message, 'err'); T.err = e.message; }
    T.busy = false;
    await refresh();
  }
  const name = (id) => { const m = (T.snap.members || []).find((x) => x.user_id === id); return m ? m.display_name : 'Üye'; };

  // ---------- Bölümler ----------
  function setupView() {
    return `<div class="tm-card"><h3>1 · Sunucu bağlantısı (Firebase)</h3>
      <p class="tm-muted">Takımın Firebase projesi: Authentication'da E-posta/Şifre açık, Firestore oluşturulmuş ve <code>firebase/firestore.rules</code> yayınlanmış olmalı. Bu iki değer paylaşılabilir; korumayı sunucudaki kurallar sağlar.</p>
      <input id="tmProj" class="tm-in" placeholder="Project ID (ör. claude-ekibim-ab12c)" value="${esc(T.snap.projectId)}">
      <input id="tmKey" class="tm-in" placeholder="Web API Key (AIza…)">
      <button class="btn" data-act="saveCfg">Kaydet</button></div>`;
  }
  function loginView() {
    return `<div class="tm-card"><h3>2 · Giriş / kayıt</h3><p class="tm-muted">Her üye kendi e-postasıyla kayıt olur. Claude hesabı/oturumu paylaşılmaz.</p>
      <input id="tmUser" class="tm-in" placeholder="Adın (yalnızca kayıtta)">
      <input id="tmMail" class="tm-in" type="email" placeholder="E-posta">
      <input id="tmPass" class="tm-in" type="password" placeholder="Şifre (en az 6 karakter)">
      <button class="btn" data-act="login" data-p="in">Giriş yap</button> <button class="btn" data-act="login" data-p="up">Kayıt ol</button>
      <button class="btn" data-act="cfg">Bağlantıyı değiştir</button></div>`;
  }
  function noTeamView() {
    return `<div class="tm-card"><h3>3 · Takıma katıl</h3>
      <input id="tmCode" class="tm-in" placeholder="Davet linki veya kodu" value="${esc(T.joinCode || '')}"><button class="btn" data-act="join">Katıl</button></div>
      <div class="tm-card"><h3>…ya da yeni takım kur</h3><input id="tmName" class="tm-in" placeholder="Takım adı"><button class="btn" data-act="create">Takım kur</button></div>`;
  }
  function teamTab() {
    const s = T.snap, myId = s.user.id;
    const code = s.team.invite_code;
    const invite = `${SITE}?code=${code}`;
    const mem = (s.members || []).map((m) => `<div class="tm-row"><span class="tm-dot ${online(m) ? 'on' : ''}"></span><b>${esc(m.display_name)}</b>${m.role === 'owner' ? ' <span class="tm-tag">kurucu</span>' : ''}
      <span class="tm-muted"> · ${online(m) ? 'çevrimiçi' : 'son görülme ' + ago(m.last_seen)}${m.active_repo ? ' · ' + esc(m.active_repo) + (m.active_branch ? ' @ ' + esc(m.active_branch) : '') : ''}</span>
      <div class="tm-topic">${m.user_id === myId ? `<input id="tmTopic" class="tm-in tm-inline" placeholder="Şu an üzerinde çalıştığım konu…" value="${esc(m.topic || '')}"><button class="btn" data-act="topic">Kaydet</button>` : (m.topic ? '▸ ' + esc(m.topic) : '<span class="tm-muted">konu belirtilmemiş</span>')}
      ${m.last_activity_at ? `<span class="tm-muted"> · aktivite ${ago(m.last_activity_at)}</span>` : ''}</div></div>`).join('');
    const repos = (s.teamRepos || []).map((r) => {
      const mine = (s.memberRepos || []).find((x) => x.full_name === r.full_name && x.user_id === myId);
      const others = (s.memberRepos || []).filter((x) => x.full_name === r.full_name);
      const rows = others.map((x) => `<div class="tm-sub">${esc(name(x.user_id))}: ${x.installed ? 'kurulu' + (x.branch ? ' · ' + esc(x.branch) : '') : 'kurulu değil'}${x.last_commit_msg ? ` · son commit: ${esc(x.last_commit_msg)} (${ago(x.last_commit_at)})` : ''}${(x.open_prs || []).length ? ' · açık PR: ' + x.open_prs.map((p) => `#${p.number} ${esc(p.title)}`).join(', ') : ''}</div>`).join('');
      return `<div class="tm-row"><b>${esc(r.full_name)}</b> ${mine && mine.installed ? '<span class="tm-tag ok">bende kurulu</span>' : '<span class="tm-tag">bende yok</span>'}
        <button class="btn" data-act="connect" data-r="${esc(r.full_name)}">Mevcut klasörü bağla</button>
        ${mine && mine.installed ? '' : `<button class="btn" data-act="clone" data-r="${esc(r.full_name)}">Klonla</button>`}${rows}</div>`;
    }).join('') || '<div class="tm-muted">Henüz takım reposu yok.</div>';
    return `<div class="tm-card"><h3>Davet</h3><p class="tm-muted">Arkadaşına bu linki gönder: indirme yönlendirmesi + takıma katılım.</p>
      <div class="tm-copy"><code>${esc(invite)}</code><button class="btn" data-act="copy" data-v="${esc(invite)}">Kopyala</button></div>
      <div class="tm-copy"><span class="tm-muted">Uygulama içi bağlantı / kod:</span> <code>claude-ekibim://join?code=${esc(code)}</code> · <code>${esc(code)}</code></div></div>
      <div class="tm-card"><h3>Üyeler · ${esc(s.team.name)}</h3>${mem}</div>
      <div class="tm-card"><h3>Repolar</h3>${repos}
        <div><button class="btn" data-act="addRepo">+ GitHub'dan repo ekle</button> <button class="btn" data-act="sync">Özetleri yenile</button></div><div id="tmRepoPick"></div></div>`;
  }
  function taskLine(t, mine) {
    const sent = t.from_user === T.snap.user.id;
    let extra = '';
    if (t.status === 'pending' && t.to_user === T.snap.user.id) extra = `<button class="btn" data-act="accept" data-id="${t.id}">Onayla ve çalıştır</button> <button class="btn" data-act="decline" data-id="${t.id}">Reddet</button>`;
    if (t.status === 'pending' && sent) extra = `<button class="btn" data-act="withdraw" data-id="${t.id}">Geri çek</button>`;
    const r = t.result ? `<div class="tm-sub">${esc(t.result.summary || '')}${(t.result.files || []).length ? '<br>Değişen dosyalar: ' + t.result.files.map(esc).join(', ') : ''}${t.result.pr_url ? `<br><a href="#" data-link="${esc(t.result.pr_url)}">${esc(t.result.pr_url)}</a>` : ''}</div>` : '';
    return `<div class="tm-row"><b>${esc(t.title)}</b> <span class="tm-tag st-${t.status}">${STATUS[t.status] || t.status}</span>
      <span class="tm-muted"> · ${sent ? '→ ' + esc(name(t.to_user)) : 'kimden: ' + esc(name(t.from_user))}${t.repo ? ' · ' + esc(t.repo) : ''} · ${ago(t.created_at)}</span>
      ${t.description ? `<div class="tm-sub">${esc(t.description)}</div>` : ''}${t.ignore_reason ? `<div class="tm-sub">Yoksayma nedeni: ${esc(t.ignore_reason)}</div>` : ''}${r}<div>${extra}</div></div>`;
  }
  function checkPanel() {
    const c = T.check; if (!c) return '';
    const items = (c.items || []).map((i) => `<li>[${esc(i.kind)}] ${esc(i.why)}</li>`).join('');
    if (c.verdict === 'none') return '';
    const head = { minor: 'Küçük çakışma', major: 'Anlamlı çakışma', unknown: 'Kontrol yapılamadı' }[c.verdict];
    const opts = (c.options || []).map((o) => `<li><b>${esc(o.label)}</b> — ${esc(o.detail)}</li>`).join('');
    let btns = '';
    if (c.verdict === 'minor') btns = `<input id="tmIgn" class="tm-in" placeholder="Yoksayma nedeni (isteğe bağlı)"><button class="btn" data-act="sendAnyway">Yine de kuyruğa al</button> <button class="btn" data-act="ignoreReq">Yoksay (kayda geç)</button>`;
    if (c.verdict === 'major') btns = `<button class="btn" data-act="discuss">Tartışmada konu aç (önerilen)</button> <button class="btn" data-act="cancelReq">Vazgeç</button>`;
    if (c.verdict === 'unknown') btns = `<button class="btn" data-act="sendAnyway">Yine de kuyruğa al</button> <button class="btn" data-act="cancelReq">Vazgeç</button>`;
    return `<div class="tm-card tm-${c.verdict}"><h3>${head}</h3><p>${esc(c.reason)}</p>${items ? `<ul>${items}</ul>` : ''}${opts ? `<p class="tm-muted">Olası seçenekler:</p><ul>${opts}</ul>` : ''}<div>${btns}</div></div>`;
  }
  function tasksTab() {
    const s = T.snap, me = s.user.id;
    const others = (s.members || []).filter((m) => m.user_id !== me);
    const inbox = (s.tasks || []).filter((t) => t.to_user === me && ['pending', 'running', 'done', 'failed'].includes(t.status));
    const sent = (s.tasks || []).filter((t) => t.from_user === me);
    const d = T.draft;
    return `<div class="tm-card"><h3>Gelen kutusu (benim onayımı bekleyen / benim yaptığım)</h3>${inbox.map((t) => taskLine(t)).join('') || '<div class="tm-muted">Boş. Onayınız olmadan hiçbir görev çalışmaz.</div>'}</div>
      <div class="tm-card"><h3>Yeni görev isteği</h3>
        <select id="tmTo" class="tm-in">${others.map((m) => `<option value="${m.user_id}" ${d.to === m.user_id ? 'selected' : ''}>${esc(m.display_name)}</option>`).join('') || '<option value="">(takımda başka üye yok)</option>'}</select>
        <select id="tmRepo" class="tm-in"><option value="">(repo seç)</option>${(s.teamRepos || []).map((r) => `<option ${d.repo === r.full_name ? 'selected' : ''}>${esc(r.full_name)}</option>`).join('')}</select>
        <input id="tmTitle" class="tm-in" placeholder="Başlık" value="${esc(d.title)}">
        <textarea id="tmDesc" class="tm-in" rows="3" placeholder="Açıklama">${esc(d.desc)}</textarea>
        <button class="btn" data-act="check" ${T.busy ? 'disabled' : ''}>${T.busy ? 'Kontrol ediliyor…' : 'Çakışma kontrolü yap ve gönder'}</button></div>
      ${checkPanel()}
      <div class="tm-card"><h3>Gönderdiklerim</h3>${sent.map((t) => taskLine(t)).join('') || '<div class="tm-muted">Henüz yok.</div>'}</div>`;
  }
  function topicsTab() {
    const s = T.snap;
    const list = (s.topics || []).map((t) => {
      const total = t.votes.length;
      const opts = t.options.map((o) => {
        const n = t.votes.filter((v) => v.option_id === o.id).length;
        const mineV = t.votes.some((v) => v.option_id === o.id && v.user_id === s.user.id);
        return `<div class="tm-opt ${mineV ? 'mine' : ''}"><b>${esc(o.label)}</b> <span class="tm-tag">${{ a: 'mevcut', b: 'yeni istek', balanced: 'dengeli', alt: 'alternatif' }[o.kind]}</span><div class="tm-sub">${esc(o.detail)}</div>
          <span class="tm-muted">${n}/${total} oy</span> ${t.status === 'open' ? `<button class="btn" data-act="vote" data-t="${t.id}" data-o="${o.id}">${mineV ? 'Oyum ✓' : 'Oy ver'}</button> <button class="btn" data-act="decide" data-t="${t.id}" data-o="${o.id}">Karar ver</button>` : ''}</div>`;
      }).join('');
      const dec = (s.decisions || []).find((d) => d.topic_id === t.id);
      return `<div class="tm-card"><h3>${esc(t.title)} <span class="tm-tag">${t.status === 'open' ? 'açık' : 'karara bağlandı'}</span></h3>
        ${t.current_state ? `<div class="tm-sub"><b>Mevcut durum:</b> ${esc(t.current_state)}</div>` : ''}
        <div class="tm-sub"><b>İstek A (mevcut):</b> ${esc(t.request_a)}</div><div class="tm-sub"><b>İstek B (yeni):</b> ${esc(t.request_b)}</div>
        <div class="tm-sub"><b>Çakışma nedeni:</b> ${esc(t.reason)}</div>${t.repo ? `<div class="tm-muted">repo: ${esc(t.repo)}${t.task_id ? ' · bağlı görev: ' + esc(((s.tasks || []).find((x) => x.id === t.task_id) || {}).title || '') : ''}</div>` : ''}
        ${opts}${dec ? `<div class="tm-sub ok"><b>Karar:</b> ${esc(dec.statement)}</div>` : ''}
        ${t.comments.map((c) => `<div class="tm-cm"><b>${esc(name(c.user_id))}</b> ${esc(c.body)} <span class="tm-muted">${ago(c.created_at)}</span></div>`).join('')}
        ${t.status === 'open' ? `<input class="tm-in tm-cin" data-t="${t.id}" placeholder="Yorum yaz…"><button class="btn" data-act="comment" data-t="${t.id}">Gönder</button>` : ''}</div>`;
    }).join('');
    return list || '<div class="tm-card tm-muted">Henüz tartışma konusu yok. Anlamlı bir çakışma bulununca burada otomatik açılır.</div>';
  }
  function decisionsTab() {
    const s = T.snap;
    const dec = (s.decisions || []).map((d) => `<div class="tm-row ${d.active ? '' : 'tm-off'}"><b>${esc(d.statement)}</b> <span class="tm-tag">${d.active ? 'geçerli' : 'geçersiz'}</span>
      <span class="tm-muted"> · ${esc(name(d.decided_by))} · ${ago(d.created_at)}${d.repo ? ' · ' + esc(d.repo) : ''}${d.area ? ' · ' + esc(d.area) : ''}${d.topic_id ? ' · tartışmadan' : ''}${d.task_id ? ' · göreve bağlı' : ''}</span></div>`).join('') || '<div class="tm-muted">Kayıtlı karar yok.</div>';
    const notes = (s.notes || []).map((n) => `<div class="tm-row"><b>${esc(n.title)}</b> <span class="tm-muted">${ago(n.created_at)}${n.repo ? ' · ' + esc(n.repo) : ''}</span><div class="tm-sub">${esc(String(n.body).slice(0, 300))}${n.body.length > 300 ? '…' : ''}</div></div>`).join('') || '<div class="tm-muted">Not yok.</div>';
    return `<div class="tm-card"><h3>Kararlar</h3>${dec}<input id="tmDec" class="tm-in" placeholder="Yeni karar (ör. Tüm karakterler siyah gözlü olacak)"><button class="btn" data-act="addDec">Karar ekle</button></div>
      <div class="tm-card"><h3>Toplantı notları / transkriptler</h3>${notes}<input id="tmNT" class="tm-in" placeholder="Not başlığı"><textarea id="tmNB" class="tm-in" rows="4" placeholder="Not veya transkript metni (çakışma taramasında okunur)"></textarea><button class="btn" data-act="addNote">Not ekle</button></div>`;
  }

  function render() {
    const box = $('#teamBody'); if (!box) return;
    const keep = { y: box.scrollTop };
    const s = T.snap;
    let html = '';
    if (!s) html = '<div class="tm-muted">yükleniyor…</div>';
    else if (!s.configured || T.editCfg) html = setupView();
    else if (!s.signedIn) html = loginView();
    else if (!s.team) html = noTeamView();
    else {
      const tabs = [['takim', 'Takım'], ['gorev', 'Görevler'], ['tartisma', 'Tartışma'], ['karar', 'Kararlar']];
      const pend = (s.tasks || []).filter((t) => t.to_user === s.user.id && t.status === 'pending').length;
      const open = (s.topics || []).filter((t) => t.status === 'open').length;
      html = `<div class="tm-tabs">${tabs.map(([k, l]) => `<button class="tm-tab ${T.tab === k ? 'on' : ''}" data-tab="${k}">${l}${k === 'gorev' && pend ? ` <i>${pend}</i>` : ''}${k === 'tartisma' && open ? ` <i>${open}</i>` : ''}</button>`).join('')}<span class="spacer"></span><span class="tm-muted">${esc(s.user.name)}</span> <button class="btn" data-act="logout">Çıkış</button></div>`
        + (T.tab === 'takim' ? teamTab() : T.tab === 'gorev' ? tasksTab() : T.tab === 'tartisma' ? topicsTab() : decisionsTab());
    }
    if (T.err && s && !s.signedIn) html = `<div class="tm-card tm-major">${esc(T.err)}</div>` + html;
    box.innerHTML = html;
    box.scrollTop = keep.y;
  }

  // ---------- Olaylar ----------
  const val = (id) => { const e = $('#' + id); return e ? e.value.trim() : ''; };
  const pickDraft = () => { T.draft = { to: val('tmTo'), repo: val('tmRepo'), title: val('tmTitle'), desc: val('tmDesc') }; };
  async function onClick(e) {
    const tab = e.target.closest('[data-tab]'); if (tab) { T.tab = tab.dataset.tab; return render(); }
    const link = e.target.closest('[data-link]'); if (link) { e.preventDefault(); return window.ekip.openExternal(link.dataset.link); }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const d = b.dataset;
    switch (d.act) {
      case 'saveCfg': return act(async () => { await call('config', { projectId: val('tmProj'), apiKey: val('tmKey') }); T.editCfg = false; }, 'Kaydedildi');
      case 'cfg': T.editCfg = true; return render();
      case 'login': return act(() => call('signIn', { email: val('tmMail'), password: val('tmPass'), name: val('tmUser'), signUp: d.p === 'up' }), d.p === 'up' ? 'Kayıt tamamlandı' : 'Giriş yapıldı');
      case 'logout': return act(() => call('signOut'));
      case 'create': return act(() => call('create', { name: val('tmName') || 'Takımım' }), 'Takım kuruldu');
      case 'join': return act(() => call('join', { code: val('tmCode') }), 'Takıma katıldın');
      case 'copy': navigator.clipboard.writeText(d.v).then(() => say('Kopyalandı')); return;
      case 'topic': return act(() => call('setTopic', val('tmTopic')), 'Konu güncellendi');
      case 'addRepo': {
        const list = await call('ghRepos').catch((x) => { say(x.message, 'err'); return []; });
        const el = $('#tmRepoPick');
        el.innerHTML = list.map((r) => `<button class="btn" data-act="pickRepo" data-r="${esc(r.nameWithOwner)}">${esc(r.nameWithOwner)}${r.isPrivate ? ' 🔒' : ''}</button>`).join(' ');
        return;
      }
      case 'pickRepo': return act(() => call('addRepo', d.r), 'Repo eklendi');
      case 'sync': return act(() => call('syncRepos'), 'Özetler yenilendi');
      case 'connect': { const p = await call('pickDir'); if (p) act(() => call('connectRepo', { full_name: d.r, path: p }), 'Bağlandı'); return; }
      case 'clone': { const p = await call('pickDir'); if (p) act(() => call('cloneRepo', { full_name: d.r, dir: p }), 'Klonlandı'); return; }
      case 'check': {
        pickDraft();
        if (!T.draft.to || !T.draft.title) return say('Alıcı ve başlık gerekli.', 'err');
        T.req = { to_user: T.draft.to, title: T.draft.title, description: T.draft.desc, repo: T.draft.repo || null };
        T.busy = true; T.check = null; render();
        try {
          const v = await call('check', T.req);
          T.busy = false;
          if (v.verdict === 'none') { await call('submitTask', { req: T.req, verdict: v, action: 'queue' }); say('Çakışma yok; istek kuyruğa alındı.'); T.draft = { to: T.draft.to, title: '', desc: '', repo: T.draft.repo }; T.check = null; }
          else T.check = v;
        } catch (x) { T.busy = false; say(x.message, 'err'); }
        return refresh();
      }
      case 'sendAnyway': return act(async () => { await call('submitTask', { req: T.req, verdict: T.check, action: 'queue' }); T.check = null; T.draft.title = ''; T.draft.desc = ''; }, 'Kuyruğa alındı');
      case 'ignoreReq': return act(async () => { await call('submitTask', { req: T.req, verdict: T.check, action: 'ignore', ignoreReason: val('tmIgn') }); T.check = null; T.draft.title = ''; T.draft.desc = ''; }, 'Yoksayıldı ve kayda geçti');
      case 'discuss': return act(async () => { await call('submitTask', { req: T.req, verdict: T.check, action: 'discuss' }); T.check = null; T.draft.title = ''; T.draft.desc = ''; T.tab = 'tartisma'; }, 'Tartışma konusu açıldı');
      case 'cancelReq': T.check = null; return render();
      case 'accept': return act(() => call('respondTask', { id: d.id, accept: true }), 'Görev başlatıldı');
      case 'decline': return act(() => call('respondTask', { id: d.id, accept: false }), 'Reddedildi');
      case 'withdraw': return act(() => call('withdrawTask', d.id), 'Geri çekildi');
      case 'vote': return act(() => call('vote', { topicId: d.t, optionId: d.o }));
      case 'decide': if (!confirm('Bu seçenek karar olarak kaydedilsin mi?')) return; return act(() => call('decide', { topicId: d.t, optionId: d.o }), 'Karar kaydedildi');
      case 'comment': { const i = $(`.tm-cin[data-t="${d.t}"]`); const v = i && i.value.trim(); if (!v) return; return act(() => call('comment', { topicId: d.t, body: v })); }
      case 'addDec': return act(() => call('addDecision', { statement: val('tmDec') }), 'Karar eklendi');
      case 'addNote': return act(() => call('addNote', { title: val('tmNT') || 'Not', body: val('tmNB') }), 'Not eklendi');
    }
  }

  function open() { $('#team').classList.remove('hidden'); refresh(); }
  function boot() {
    if (!$('#team')) return;
    $('#teamBtn').addEventListener('click', open);
    $('#teamClose').addEventListener('click', () => $('#team').classList.add('hidden'));
    $('#teamBody').addEventListener('click', onClick);
    window.ekip.onTeamChanged(() => { if (!$('#team').classList.contains('hidden') && !T.busy) { const f = document.activeElement; if (!(f && f.closest && f.closest('#teamBody') && /INPUT|TEXTAREA/.test(f.tagName))) refresh(); } });
    window.ekip.onTeamIncoming((t) => { say(`Yeni görev isteği: ${t.title}`); const b = $('#teamBtn'); b.classList.add('ping'); });
    window.ekip.onTeamJoinLink((code) => { T.joinCode = code; open(); });
    setInterval(() => { if (!$('#team').classList.contains('hidden') && !T.busy) { const f = document.activeElement; if (!(f && f.closest && f.closest('#teamBody') && /INPUT|TEXTAREA|SELECT/.test(f.tagName))) refresh(); } }, 20000);   // sunucudan canlı dinleme yok: panel açıkken yokla
    // Takım modu açıksa uygulama açılışında sessizce bağlan (heartbeat/realtime başlasın)
    window.ekip.team('snapshot').then((r) => { if (r.ok && r.data.team) T.snap = r.data; });
  }
  window.__teamPreview = (snap, tab) => { T.snap = snap; T.tab = tab || 'takim'; $('#team').classList.remove('hidden'); render(); };   // arayüz denemesi için (sahte veri)
  document.addEventListener('DOMContentLoaded', boot);
})();
