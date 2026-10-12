// Basit, güvenli markdown -> HTML (önce kaçış, sonra sınırlı biçimlendirme).
(function (root) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function inline(s) {
    s = esc(s);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => /^https:\/\/github\.com\//.test(u) ? `<a href="${u}" target="_blank">${t}</a>` : `<span class="link">${t}</span>`);
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
    return s;
  }

  function table(lines) {
    const rows = lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    if (!rows.length) return '';
    const [head, ...body] = rows;
    return '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
      body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
  }

  function render(md) {
    const out = [];
    const parts = String(md || '').split(/```/);
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        const nl = part.indexOf('\n');
        const body = nl >= 0 ? part.slice(nl + 1) : part;
        out.push(`<pre><code>${esc(body.replace(/\n$/, ''))}</code></pre>`);
        return;
      }
      const lines = part.split('\n');
      let buf = [];
      let list = null;
      const flushP = () => { if (buf.length) { out.push('<p>' + buf.map(inline).join('<br>') + '</p>'); buf = []; } };
      const flushL = () => { if (list) { out.push(`<${list.t}>` + list.items.map((x) => `<li>${inline(x)}</li>`).join('') + `</${list.t}>`); list = null; } };
      for (let j = 0; j < lines.length; j++) {
        const l = lines[j];
        if (/^\s*\|.*\|\s*$/.test(l)) {
          flushP(); flushL();
          const tl = [];
          while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) tl.push(lines[j++]);
          j--;
          out.push(table(tl));
          continue;
        }
        const h = l.match(/^(#{1,4})\s+(.*)$/);
        if (h) { flushP(); flushL(); out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`); continue; }
        const ul = l.match(/^\s*[-*]\s+(.*)$/);
        const ol = l.match(/^\s*\d+[.)]\s+(.*)$/);
        if (ul || ol) {
          flushP();
          const t = ul ? 'ul' : 'ol';
          if (!list || list.t !== t) { flushL(); list = { t, items: [] }; }
          list.items.push((ul || ol)[1]);
          continue;
        }
        if (!l.trim()) { flushP(); flushL(); continue; }
        flushL();
        buf.push(l);
      }
      flushP(); flushL();
    });
    return out.join('');
  }

  root.MD = { render, esc };
})(this);
