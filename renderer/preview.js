'use strict';
// Önizleme paneli: tarayıcı sekmesi (localhost) ve iOS Simulator ekran görüntüsü.
(() => {
  const $ = (sel) => document.querySelector(sel);
  const webview = $('#webview');
  const urlInput = $('#urlInput');
  const simDevice = $('#simDevice');
  const simShot = $('#simShot');
  const simMsg = $('#simMsg');
  let pollTimer = null;
  let busy = false;

  // ---- Sekmeler ----
  const PANES = { web: '#pvWeb', sim: '#pvSim', img: '#pvImg' };
  function showTab(name) {
    document.querySelectorAll('.pv-tab').forEach((t) => t.classList.toggle('active', t.dataset.pv === name));
    for (const [key, sel] of Object.entries(PANES)) $(sel).classList.toggle('hidden', key !== name);
    if (name === 'sim') startSimPolling(); else stopSimPolling();
  }
  document.querySelectorAll('.pv-tab').forEach((tab) => { tab.onclick = () => showTab(tab.dataset.pv); });
  function openPanel() {
    if (!document.querySelector('main').classList.contains('pv-open')) $('#pvToggle').click();
  }

  // ---- Resimler ----
  const images = [];
  function showImageAt(i) {
    const im = images[i];
    if (!im) return;
    const main = $('#imgMain');
    main.src = im.data;
    main.classList.remove('hidden');
    $('#imgEmpty').classList.add('hidden');
    $('#imgCap').textContent = im.caption + '  ·  ' + im.path;
    $('#imgThumbs').querySelectorAll('img').forEach((t, n) => t.classList.toggle('on', n === i));
  }
  $('#imgMain').onclick = () => { const cur = images.find((im) => im.data === $('#imgMain').src); if (cur) window.ekip.openPath(cur.path); };
  window.ekip.onPreviewImage((im) => {
    images.push(im);
    const t = document.createElement('img');
    t.src = im.data;
    t.title = im.caption;
    const idx = images.length - 1;
    t.onclick = () => showImageAt(idx);
    $('#imgThumbs').appendChild(t);
    openPanel();
    showTab('img');
    showImageAt(idx);
  });
  window.ekip.onPreviewFocus(({ tab }) => { if (PANES[tab]) { openPanel(); showTab(tab); } });

  // ---- Tarayıcı ----
  const normalize = (raw) => {
    let url = String(raw || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
    return url;
  };
  $('#urlForm').onsubmit = (e) => {
    e.preventDefault();
    const url = normalize(urlInput.value);
    urlInput.value = url;
    webview.src = url;
  };
  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return; // iptal edildi
    webview.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(
      `<body style="font:14px sans-serif;background:#17141f;color:#ece6f6;padding:24px">Sayfa açılamadı: ${e.validatedURL}<br>Geliştirme sunucusu çalışıyor mu?</body>`
    );
  });

  // ---- iOS Simulator ----
  async function loadDevices() {
    try {
      const devices = await window.ekip.simList();
      simDevice.innerHTML = '';
      for (const d of devices) {
        const opt = document.createElement('option');
        opt.value = d.udid;
        opt.textContent = (d.booted ? '● ' : '') + d.name;
        simDevice.appendChild(opt);
      }
      const booted = devices.find((d) => d.booted);
      if (booted) simDevice.value = booted.udid;
      if (!devices.length) simMsg.textContent = 'Kullanılabilir iPhone simülatörü bulunamadı (Xcode kurulu mu?).';
    } catch (e) {
      simMsg.textContent = 'Simülatör listesi alınamadı: ' + e.message;
    }
  }

  $('#simBoot').onclick = async () => {
    if (!simDevice.value) return;
    simMsg.textContent = 'Simülatör açılıyor…';
    simMsg.classList.remove('hidden');
    try {
      await window.ekip.simBoot(simDevice.value);
      await loadDevices();
      startSimPolling();
    } catch (e) {
      simMsg.textContent = 'Açılamadı: ' + e.message;
    }
  };

  async function refreshShot() {
    if (busy || !simDevice.value) return;
    busy = true;
    try {
      simShot.src = await window.ekip.simShot(simDevice.value);
      simShot.classList.remove('hidden');
      simMsg.classList.add('hidden');
    } catch (e) {
      simShot.classList.add('hidden');
      simMsg.classList.remove('hidden');
      simMsg.textContent = 'Ekran görüntüsü alınamadı. Simülatörü Aç ile başlatın. (' + e.message + ')';
    } finally {
      busy = false;
    }
  }

  function startSimPolling() {
    if (pollTimer) return;
    refreshShot();
    pollTimer = setInterval(refreshShot, 1000);
  }
  function stopSimPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Önizleme paneli sağdan açılır/kapanır
  const main = document.querySelector("main");
  $("#pvToggle").onclick = () => {
    const open = main.classList.toggle("pv-open");
    $("#pvToggle").classList.toggle("active", open);
    if (open && !$("#pvSim").classList.contains("hidden")) startSimPolling();
    if (!open) stopSimPolling();
  };

  // Ajan preview_open aracı: paneli açar ve adresi tarayıcı sekmesinde gösterir
  window.ekip.onPreviewOpen(({ url }) => {
    if (!main.classList.contains('pv-open')) $('#pvToggle').click();
    document.querySelector('[data-pv="web"]').click();
    urlInput.value = url;
    webview.src = url;
  });

  loadDevices();
})();
