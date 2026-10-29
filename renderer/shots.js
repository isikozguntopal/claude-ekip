'use strict';
// Sürükle bırak: resim dosyaları kopyalanır ve yollarıyla birlikte mesaj kutusuna eklenir.
(() => {
  const input = document.getElementById('input');
  const chat = document.querySelector('section.chat');
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

  // Resim dışına bırakılınca Electron'un dosyayı açmasını engelle
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });

  chat.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    chat.classList.add('drop');
  });
  chat.addEventListener('dragleave', (e) => {
    if (!chat.contains(e.relatedTarget)) chat.classList.remove('drop');
  });
  chat.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    chat.classList.remove('drop');
    const paths = Array.from(e.dataTransfer.files).map((f) => window.ekip.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    try {
      const saved = await window.ekip.importShots(paths);
      if (!saved.length) { toast('Yalnızca resim dosyaları eklenebilir.', 'err'); return; }
      const text = saved.map((p) => `"${p}"`).join(' ');
      const pad = input.value && !/\s$/.test(input.value) ? ' ' : '';
      insertAtCursor(input, pad + text + ' ');
      input.focus();
      toast(saved.length + ' ekran resmi eklendi', 'ok');
    } catch (err) {
      toast('Resim eklenemedi: ' + err.message, 'err');
    }
  });

  function insertAtCursor(el, text) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
  }
})();
