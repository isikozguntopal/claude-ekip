'use strict';
// Animasyonlu pixel-art ofis: masalar rütbeye göre dizilir, ajanlar kahve/WC için dolaşır,
// sebilde sohbet eder; görev varken birlikte çalışanlar toplantı alanında konuşur.
// app.js'ten kullanılan globaller: S, byId, select, isActive, drawSprite.
(() => {
  const W = 720, H = 410, A = 3;           // sahne boyutu ve piksel birimi
  const CORR = 250;                          // koridor (ayak hizası)
  const SPEED = 64;                          // px / sn
  const SPR_W = 48, SPR_H = 54;              // 16x18 sprite, ölçek 3

  // Rütbe: üst sıra liderlik (Süper Mimar · Claude · Müdür), alt sıra ekip (Dedektif · Piksel · Bekçi)
  const SEATS = {
    mimar: { x: 125, y: 130, col: 1 }, lider: { x: 360, y: 130, col: 2 }, ceo: { x: 595, y: 130, col: 3 },
    inceleyici: { x: 125, y: 350, col: 1 }, tasarimci: { x: 360, y: 350, col: 2 }, guvenlik: { x: 595, y: 350, col: 3 }
  };
  const GAPS = { 1: [30, 232], 2: [232, 488], 3: [488] };   // masalar arası geçitler
  const WC = { x: 40, y: 78 };
  const COOLER_SPOTS = [{ x: 650, y: 244 }, { x: 650, y: 278 }];
  const MEET_SPOTS = [{ x: 285, y: 258 }, { x: 335, y: 252 }, { x: 385, y: 252 }, { x: 435, y: 258 }];

  // Balonlar son isteğe bağlıdır; iş yokken ekip yalnızca bekler.
  let task = '';
  const lower = (s) => (s ? s.charAt(0).toLocaleLowerCase('tr') + s.slice(1) : s);
  const STOP = new Set(['bana', 'ben', 'sen', 'bir', 'bu', 'şu', 'o', 've', 'ile', 'de', 'da', 'mi', 'mı', 'mu', 'mü', 'için', 'lütfen', 'şunu', 'bunu', 'biraz', 'hemen', 'gibi', 'ama', 'sonra', 'önce', 'şey', 'yap', 'yapar', 'mısın', 'misin', 'olsun', 'istiyorum', 'lazım', 'bi', 'çok', 'daha', 'şöyle', 'böyle']);
  // Özet gelene kadar kaba özet: dolgu sözcükleri atıp ilk birkaç anlamlı sözcüğü al
  const roughSummary = (text) => {
    const words = String(text || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w.toLocaleLowerCase('tr')));
    const s = words.slice(0, 4).join(' ');
    return s ? s.charAt(0).toLocaleUpperCase('tr') + s.slice(1) : '';
  };
  const L = (id, t) => ({
    mimar: [`${t} için planı gözden geçiriyorum`, `${t} işinde testleri unutmayalım`],
    lider: [`${t} işi nasıl gitti, Patron?`, `${t} tamamsa yenisine hazırız`],
    ceo: [`${t} yayına hazır mı?`, `${t} için QA listesine bakayım`],
    inceleyici: [`${t} değişikliklerini bir daha okuyayım`, `${t} kodunda bir şey kaçmış mı?`],
    tasarimci: [`${t} arayüzde nasıl görünüyor?`, `${t} için boşlukları gözden geçireyim`],
    guvenlik: [`${t} için güvenlik taraması temiz mi?`, `${t} sonrası bir kez daha tarayayım`]
  })[id];
  const ownLines = (id) => (task ? L(id, task) : null);
  const chatLines = () => (task
    ? [`${task} hakkında ne düşünüyorsun?`, `${task} iyi gitti sanki`, `Patron ${lower(task)} için memnun mu acaba?`]
    : ['Patron\'dan iş bekliyoruz', 'Yeni bir iş gelirse hazırız', '☕ bir yudum alayım']);
  const meetLines = () => (task
    ? [`${task} için işi paylaşalım`, 'Ben kendi kısmımı alıyorum', 'Bu bitince birlikte gözden geçirelim', 'Bir engel görürsem haber veririm']
    : ['İşi paylaşalım', 'Bende tamam', 'Bir engel görürsem haber veririm']);

  const actors = {};
  const lastAct = {};
  let container = null, scene = null, overlay = null;
  let k = 1, offX = 0, offY = 0;
  let meeting = null, nextMeetingAt = 0, nextTick = 0, started = false;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const nowMs = () => Date.now();

  // ---------- Çizim ----------
  function drawBackground(c) {
    const g = c.getContext('2d');
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x * A, y * A, w * A, h * A); };
    for (let ty = 22; ty < 138; ty += 8) for (let tx = 0; tx < 240; tx += 8) R(tx, ty, 8, 8, ((tx + ty) / 8) % 2 ? '#2f2943' : '#352e4b');
    R(0, 0, 240, 22, '#2a2440'); R(0, 0, 240, 2, '#3b3360'); R(0, 20, 240, 2, '#1f1a2e'); R(0, 22, 240, 1, '#4a3f66');
    // pencereler
    for (const wx of [57, 163]) {
      R(wx - 1, 3, 22, 14, '#1d2540'); R(wx, 4, 20, 12, '#5aa0d8'); R(wx + 9, 4, 2, 12, '#1d2540'); R(wx, 9, 20, 1, '#1d2540');
      R(wx + 2, 6, 4, 1, '#cfe6f7'); R(wx + 12, 12, 5, 1, '#cfe6f7');
    }
    // saat ve posterler
    R(116, 5, 8, 8, '#f5efe6'); R(117, 4, 6, 10, '#f5efe6'); R(115, 6, 10, 6, '#f5efe6'); R(120, 7, 1, 3, '#1b1626'); R(120, 9, 3, 1, '#1b1626');
    R(30, 5, 10, 12, '#e9c46a'); R(31, 6, 8, 6, '#d97757'); R(33, 13, 4, 1, '#1b1626');
    R(198, 5, 10, 12, '#5f9ea0'); R(199, 6, 8, 5, '#e9c46a'); R(201, 13, 4, 1, '#1b1626');
    // WC kapısı
    R(4, 3, 15, 19, '#4b2e1f'); R(5, 4, 13, 18, '#7a5236'); R(15, 13, 2, 2, '#e9c46a'); R(7, 5, 9, 4, '#e8e1d0');
    // bitkiler
    const plant = (x, y) => { R(x, y + 6, 6, 4, '#8a4b2e'); R(x + 1, y + 10, 4, 1, '#5d3b26'); R(x + 2, y, 2, 7, '#3f8f4f'); R(x, y + 2, 6, 3, '#4fae61'); R(x + 1, y + 1, 4, 2, '#63c477'); };
    plant(2, 124); plant(230, 124); plant(212, 26);
    // mutfak köşesi: tezgâh, kahve makinesi, sebil
    R(224, 34, 16, 12, '#6b452c'); R(224, 33, 16, 2, '#b07a52'); R(231, 36, 1, 10, '#4a2f1d');
    R(228, 26, 8, 8, '#2a2a3a'); R(229, 27, 6, 3, '#c0392b'); R(230, 31, 4, 3, '#1b1626'); R(236, 30, 2, 3, '#f5efe6');
    R(227, 70, 1, 13, '#9aa4b5'); R(228, 70, 8, 13, '#cfd6e0'); R(236, 70, 1, 13, '#9aa4b5');
    R(229, 62, 6, 8, '#7cc4f0'); R(230, 63, 2, 5, '#a8dcf8'); R(230, 60, 4, 2, '#5aa0d8');
    R(231, 74, 2, 2, '#c0392b'); R(230, 79, 4, 1, '#9aa4b5');
    // toplantı halısı ve ayakta masa
    R(84, 75, 72, 16, '#432850'); R(84, 75, 72, 1, '#5b3a69'); R(84, 90, 72, 1, '#5b3a69'); R(84, 75, 1, 16, '#5b3a69'); R(155, 75, 1, 16, '#5b3a69');
    R(107, 70, 20, 3, '#b07a52'); R(107, 73, 20, 1, '#8a5a3b'); R(115, 74, 4, 6, '#5d3b26'); R(112, 80, 10, 1, '#3b2616');
    R(110, 68, 2, 2, '#f5efe6'); R(121, 68, 2, 2, '#f5efe6');
    // sandalyeler (masa boşken görünür)
    for (const s of Object.values(SEATS)) {
      g.fillStyle = '#3d3258'; g.fillRect(s.x - 22, s.y - 50, 44, 38);
      g.fillStyle = '#4a3d69'; g.fillRect(s.x - 18, s.y - 46, 36, 30);
    }
  }

  function deskCanvas(lead) {
    const aw = lead ? 58 : 44, ah = 18;
    const c = document.createElement('canvas');
    c.width = aw * A; c.height = ah * A;
    const g = c.getContext('2d');
    const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x * A, y * A, w * A, h * A); };
    R(0, 8, aw, 1, '#c98f63'); R(0, 9, aw, 3, '#b07a52'); R(0, 12, aw, 1, '#8a5a3b');
    R(1, 13, aw - 2, 5, '#6b452c'); R(1, 17, aw - 2, 1, '#4a2f1d');
    R(3, 14, aw / 2 - 4, 3, '#5d3b26'); R(aw / 2 + 1, 14, aw / 2 - 4, 3, '#5d3b26'); R(aw / 2 - 1, 13, 2, 5, '#4a2f1d');
    R(3, 0, 11, 7, '#2b2b3d'); R(4, 1, 9, 5, '#3a3a52'); R(8, 7, 3, 1, '#2b2b3d');
    R(aw - 12, 5, 3, 3, '#f5efe6'); R(aw - 9, 6, 1, 1, '#f5efe6'); R(aw - 7, 6, 5, 2, '#d8d0c0');
    if (lead) R(aw / 2 - 4, 10, 8, 1, '#e9c46a');
    c.className = 'odesk';
    c.dataset.w = aw * A;
    return c;
  }

  // ---------- Kurulum ----------
  function build(host) {
    container = host;
    container.innerHTML = '';
    scene = document.createElement('div');
    scene.className = 'oscene';
    overlay = document.createElement('div');
    overlay.className = 'oover';
    container.append(scene, overlay);

    const bg = document.createElement('canvas');
    bg.width = W; bg.height = H;
    drawBackground(bg);
    scene.appendChild(bg);

    for (const [id, s] of Object.entries(SEATS)) {
      const m = byId[id];
      const desk = deskCanvas(id === 'lider');
      desk.style.left = (s.x - desk.width / 2) + 'px';
      desk.style.top = (s.y + 12 - desk.height) + 'px';
      desk.style.zIndex = String(s.y + 12);
      desk.addEventListener('click', () => select(id));
      scene.appendChild(desk);

      const el = document.createElement('div');
      el.className = 'oactor';
      el.style.setProperty('--member', m.color);
      const cv = document.createElement('canvas');
      cv.dataset.sprite = id;
      drawSprite(cv, id, 3);
      el.appendChild(cv);
      el.addEventListener('click', () => select(id));
      scene.appendChild(el);

      const label = document.createElement('div');
      label.className = 'olabel';
      label.style.setProperty('--member', m.color);
      label.innerHTML = `<span class="od"></span>${MD.esc(m.name)}<small>${MD.esc(m.title)}</small>`;
      label.addEventListener('click', () => select(id));
      overlay.appendChild(label);

      const bubble = document.createElement('div');
      bubble.className = 'obubble';
      overlay.appendChild(bubble);

      actors[id] = {
        id, el, label, bubble, x: s.x, y: s.y, facing: 1, state: 'sit', path: [], onArrive: null,
        until: 0, spot: null, nextThink: nowMs() + 1500 + Math.random() * 5000, nextTalk: 0, bubbleText: '', bubbleUntil: 0
      };
    }
    const wc = document.createElement('div');
    wc.className = 'owc';
    wc.textContent = 'WC';
    wc.dataset.x = '37'; wc.dataset.y = '20';
    overlay.appendChild(wc);

    new ResizeObserver(layout).observe(container);
    layout();
    if (!started) { started = true; requestAnimationFrame(frame); }
  }

  function layout() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    k = Math.max(0.2, Math.min(w / W, h / H));
    offX = (w - W * k) / 2;
    offY = (h - H * k) / 2;
    scene.style.transform = `translate(${offX}px, ${offY}px) scale(${k})`;
    for (const s of Object.entries(SEATS)) {
      const a = actors[s[0]];
      a.label.style.left = (offX + s[1].x * k) + 'px';
      a.label.style.top = (offY + (s[1].y + 15) * k) + 'px';
    }
    const wc = overlay.querySelector('.owc');
    if (wc) { wc.style.left = (offX + 37 * k) + 'px'; wc.style.top = (offY + 20 * k) + 'px'; }
  }

  // ---------- Hareket ----------
  const seatOf = (id) => SEATS[id];
  const gapFor = (col, towardX) => GAPS[col].reduce((best, g) => (Math.abs(g - towardX) < Math.abs(best - towardX) ? g : best), GAPS[col][0]);

  function walk(a, path, state, onArrive) {
    a.path = path;
    a.state = state;
    a.onArrive = onArrive;
  }

  function pathFromSeat(a, dest, viaX) {
    const s = seatOf(a.id);
    const ex = gapFor(s.col, viaX);
    const p = [{ x: ex, y: s.y }, { x: ex, y: CORR }, { x: dest.x, y: CORR }];
    if (dest.y !== CORR) p.push({ x: dest.x, y: dest.y });
    return p;
  }

  function pathToSeat(a) {
    const s = seatOf(a.id);
    if (Math.abs(a.y - s.y) < 2) return [{ x: s.x, y: s.y }];
    const ex = gapFor(s.col, a.x);
    const p = [];
    if (a.x <= WC.x + 6 && a.y < CORR - 10) p.push({ x: WC.x, y: CORR });
    else if (Math.abs(a.y - CORR) > 0.5) p.push({ x: a.x, y: CORR });
    p.push({ x: ex, y: CORR }, { x: ex, y: s.y }, { x: s.x, y: s.y });
    return p;
  }

  function returnToSeat(a) {
    a.spot = null;
    a.el.style.visibility = '';
    walk(a, pathToSeat(a), 'toSeat', () => { a.state = 'sit'; a.facing = 1; a.nextThink = nowMs() + 2000 + Math.random() * 3000; });
  }

  function goCooler(a) {
    const spot = COOLER_SPOTS.find((sp) => !Object.values(actors).some((o) => o.spot === sp));
    if (!spot) return;
    a.spot = spot;
    walk(a, pathFromSeat(a, spot, spot.x), 'toCooler', () => {
      a.state = 'cooler'; a.facing = 1; a.until = nowMs() + 10000 + Math.random() * 8000; a.nextTalk = nowMs() + 600;
    });
  }

  function goWC(a) {
    walk(a, pathFromSeat(a, WC, WC.x), 'toWC', () => {
      a.state = 'wc'; a.el.style.visibility = 'hidden'; a.until = nowMs() + 6000 + Math.random() * 6000;
    });
  }

  function goMeet(a, spot, centerX) {
    walk(a, pathFromSeat(a, spot, spot.x), 'toMeet', () => { a.state = 'meet'; a.facing = spot.x < centerX ? 1 : -1; });
  }

  function stepActor(a, dt) {
    if (!a.path.length) return;
    const p = a.path[0];
    const dx = p.x - a.x, dy = p.y - a.y;
    const dist = Math.hypot(dx, dy), step = SPEED * dt;
    if (dist <= step) {
      a.x = p.x; a.y = p.y; a.path.shift();
      if (!a.path.length && a.onArrive) { const f = a.onArrive; a.onArrive = null; f(a); }
    } else {
      a.x += dx / dist * step; a.y += dy / dist * step;
      if (Math.abs(dx) > 0.5) a.facing = dx > 0 ? 1 : -1;
    }
  }

  function placeActor(a) {
    a.el.style.left = (a.x - SPR_W / 2) + 'px';
    a.el.style.top = (a.y - SPR_H) + 'px';
    a.el.style.zIndex = String(Math.round(a.y));
    a.el.classList.toggle('flip', a.facing < 0);
  }

  function placeBubble(a) {
    const show = a.bubbleText && a.bubbleUntil > nowMs() && a.state !== 'wc';
    a.bubble.classList.toggle('show', !!show);
    if (!show) return;
    if (a.bubble.textContent !== a.bubbleText) a.bubble.textContent = a.bubbleText;
    const w = container.clientWidth;
    const x = Math.max(90, Math.min(w - 90, offX + a.x * k));
    a.bubble.style.left = x + 'px';
    a.bubble.style.top = Math.max(26, offY + (a.y - SPR_H - 2) * k) + 'px';
  }

  // ---------- Davranış ----------
  function say(id, text, hold = 4000) {
    const a = actors[id];
    if (!a) return;
    a.bubbleText = String(text).slice(0, 110);
    a.bubbleUntil = nowMs() + hold;
  }

  function ambient(a) {
    if (a.bubbleUntil > nowMs()) return;
    const lines = ownLines(a.id);
    if (!lines || Math.random() > 0.5) return;   // iş yoksa sessiz kal
    say(a.id, pick(lines), 3800);
  }

  function goWander(a) {
    const dest = { x: 70 + Math.random() * 560, y: CORR - 25 + Math.random() * 55 };
    walk(a, pathFromSeat(a, dest, dest.x), 'toWander', () => { a.state = 'wander'; a.until = nowMs() + 2500 + Math.random() * 3500; });
  }

  function working() { return S.state === 'calisiyor'; }

  function decide(a) {
    if (isActive(a.id)) return;
    const away = Object.values(actors).filter((o) => o.state !== 'sit').length;
    const r = Math.random();
    if (!working()) {
      if (away < 3) {
        if (r < 0.18) return goCooler(a);
        if (r < 0.25 && !Object.values(actors).some((o) => o.state === 'wc' || o.state === 'toWC')) return goWC(a);
        if (r < 0.4) return goWander(a);
      }
      if (r < 0.6) ambient(a);
    } else {
      if (r < 0.04 && away < 1) return goCooler(a);
      if (r < 0.2) ambient(a);
    }
  }

  function maybeMeeting(t) {
    if (meeting || t < nextMeetingAt) return;
    const crew = Object.keys(actors).filter((id) => t - ((lastAct[id] && lastAct[id].t) || 0) < 20000 && actors[id].state === 'sit').slice(0, 4);
    if (crew.length < 2) return;
    crew.sort((x, y) => SEATS[x].x - SEATS[y].x);
    meeting = { crew, until: t + 10000 + 2000 * crew.length, nextLine: t + 2500, turn: 0 };
    const mid = (MEET_SPOTS[0].x + MEET_SPOTS[MEET_SPOTS.length - 1].x) / 2;
    crew.forEach((id, i) => goMeet(actors[id], MEET_SPOTS[i], mid));
  }

  function talk(t) {
    const cooler = Object.values(actors).filter((o) => o.state === 'cooler');
    for (const a of cooler) {
      if (t < a.nextTalk) continue;
      a.nextTalk = t + (cooler.length > 1 ? 3200 : 5000) + Math.random() * 1500;
      if (a.bubbleUntil > t) continue;
      say(a.id, cooler.length > 1 ? pick(chatLines()) : (task ? '☕ bir yudum alayım' : pick(chatLines())), 3000);
    }
    if (meeting && t > meeting.nextLine) {
      meeting.nextLine = t + 2600;
      const id = meeting.crew[meeting.turn++ % meeting.crew.length];
      const a = actors[id];
      if (a.state === 'meet') {
        const la = lastAct[id];
        const fresh = la && t - la.t < 20000 && meeting.turn % 2 === 0;
        say(id, fresh ? la.text : pick(meetLines()), 3200);
      }
    }
  }

  function schedule(t) {
    if (t < nextTick) return;
    nextTick = t + 400;
    const all = Object.values(actors);
    for (const a of all) {
      if ((a.state === 'cooler' || a.state === 'toCooler' || a.state === 'wc' || a.state === 'toWC' || a.state === 'wander' || a.state === 'toWander') && isActive(a.id)) returnToSeat(a);
      else if (a.state === 'cooler' && t > a.until) returnToSeat(a);
      else if ((a.state === 'wc' || a.state === 'wander') && t > a.until) returnToSeat(a);
      else if (a.state === 'sit' && t > a.nextThink) {
        a.nextThink = t + 2500 + Math.random() * 3500;
        decide(a);
      }
      a.label.classList.toggle('active', isActive(a.id));
    }
    if (meeting && t > meeting.until) {
      for (const id of meeting.crew) if (actors[id].state === 'meet' || actors[id].state === 'toMeet') returnToSeat(actors[id]);
      meeting = null;
      nextMeetingAt = t + 45000;
    }
    if (working() || all.some((a) => isActive(a.id))) maybeMeeting(t);
    talk(t);
  }

  let last = performance.now();
  function frame(ts) {
    const dt = Math.min(0.1, (ts - last) / 1000);
    last = ts;
    for (const a of Object.values(actors)) { stepActor(a, dt); placeActor(a); placeBubble(a); }
    schedule(nowMs());
    requestAnimationFrame(frame);
  }

  // ---------- Dışa açılan arayüz ----------
  window.Office = {
    render(host) {
      if (!container || container !== host) build(host);
      this.refresh();
    },
    refresh() {
      for (const [id, a] of Object.entries(actors)) {
        const st = S.status[id];
        const uninstalled = !!(st && !st.installed);
        a.el.classList.toggle('uninstalled', uninstalled);
        a.el.classList.toggle('selected', S.selected === id);
        a.label.classList.toggle('selected', S.selected === id);
        a.label.querySelector('.od').classList.toggle('on', !!(st && st.installed));
      }
    },
    say(id, text, hold) {
      if (/hook|^\s*[{\[]|"async"/i.test(String(text))) return;   // teknik gürültüyü balona koyma
      say(id, text, hold);
      lastAct[id] = { t: nowMs(), text: String(text).slice(0, 38) };
    },
    setTask(text, summarized) {
      const t = summarized ? String(text || '').trim() : roughSummary(text);
      task = t.length > 40 ? t.slice(0, 39) + '…' : t;
    },
    isMoving(id) { return !!(actors[id] && actors[id].path.length); }
  };
})();
