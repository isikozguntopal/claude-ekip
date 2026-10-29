'use strict';
// Komut düğmeleri: tek tıkla shell komutu çalıştırır (örn. Xcode'da projeyi açmak).
(() => {
  const bar = document.getElementById('cmdBar');
  let list = [];

  function render() {
    bar.innerHTML = '';
    list.forEach((c, i) => {
      const wrap = document.createElement('span');
      wrap.className = 'cmd-item';
      const b = document.createElement('button');
      b.className = 'btn btn-small';
      b.textContent = c.label;
      b.title = c.cmd;
      b.onclick = () => run(c, b);
      const del = document.createElement('button');
      del.className = 'cmd-del';
      del.textContent = '×';
      del.title = 'Komutu sil';
      del.onclick = async () => { list.splice(i, 1); await window.ekip.cmdSave(list); render(); };
      wrap.append(b, del);
      bar.appendChild(wrap);
    });
    const add = document.createElement('button');
    add.className = 'btn btn-small';
    add.textContent = '+ Komut';
    add.onclick = openForm;
    bar.appendChild(add);
  }

  function openForm() {
    if (bar.querySelector('form')) return;
    const f = document.createElement('form');
    f.className = 'cmd-form';
    f.innerHTML = '<input name="label" placeholder="Ad (ör. Xcode\'da aç)" required />' +
      '<input name="cmd" placeholder="Komut (ör. open -a Xcode ...)" required />' +
      '<button class="btn btn-small btn-primary" type="submit">Ekle</button>' +
      '<button class="btn btn-small" type="button">İptal</button>';
    f.querySelector('[type=button]').onclick = () => f.remove();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const label = f.elements.label.value.trim();
      const cmd = f.elements.cmd.value.trim();
      if (!label || !cmd) return;
      list.push({ label, cmd });
      await window.ekip.cmdSave(list);
      render();
    };
    bar.appendChild(f);
    f.elements.label.focus();
  }

  async function run(c, btn) {
    btn.disabled = true;
    try {
      const r = await window.ekip.cmdRun(c.cmd);
      if (r.code === 0) toast(c.label + ': tamam', 'ok');
      else toast(c.label + ' hata verdi (kod ' + r.code + '): ' + r.output.trim().slice(-200), 'err');
    } catch (e) {
      toast(c.label + ': ' + e.message, 'err');
    } finally {
      btn.disabled = false;
    }
  }

  window.ekip.cmdList().then((l) => { list = l; render(); });
})();
