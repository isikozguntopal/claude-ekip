'use strict';
// Uygulama ikonunu üretir: ekibin tüm üyelerinin kafası + "EKİBİM".
// Kullanım: npx electron scripts/make-icon.js  →  build/icon.png ve build/icon.icns (macOS)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { TEAM, spriteGrid } = require('../team.js');

const OUT = path.join(__dirname, '..', 'build');
const ORDER = ['mimar', 'lider', 'ceo', 'inceleyici', 'tasarimci', 'guvenlik'];   // masa düzeniyle aynı sıra

const members = ORDER.map((id) => {
  const m = TEAM.find((t) => t.id === id);
  const { grid, palette } = spriteGrid(m);
  return { color: m.color, rows: grid.slice(0, 11), palette };
});

const draw = `(() => {
  const members = ${JSON.stringify(members)};
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  // zemin
  rr(24, 24, 976, 976, 210); g.fillStyle = '#221d2e'; g.fill();
  rr(24, 24, 976, 976, 210); g.lineWidth = 18; g.strokeStyle = '#51466b'; g.stroke();
  rr(48, 48, 928, 928, 190); g.lineWidth = 6; g.strokeStyle = '#3d3452'; g.stroke();
  // kafalar
  const S = 15, tileW = 240, tileH = 186, gap = 12;
  const x0 = (1024 - (3 * tileW + 2 * gap)) / 2, y0 = 150;
  members.forEach((m, i) => {
    const tx = x0 + (i % 3) * (tileW + gap), ty = y0 + Math.floor(i / 3) * (tileH + gap);
    rr(tx, ty, tileW, tileH, 22); g.fillStyle = '#2d2640'; g.fill();
    rr(tx, ty, tileW, tileH, 22); g.lineWidth = 6; g.strokeStyle = m.color; g.stroke();
    m.rows.forEach((row, y) => {
      for (let x = 0; x < 16; x++) {
        const col = m.palette[row[x]];
        if (!col || row[x] === '.' || row[x] === ' ') continue;
        g.fillStyle = col;
        g.fillRect(tx + x * S, ty + 10 + y * S, S, S);
      }
    });
  });
  // yazı
  g.textAlign = 'center';
  g.fillStyle = '#ece6f6'; g.font = 'bold 84px Menlo, monospace';
  g.fillText('CLAUDE', 512, 690);
  g.fillStyle = '#d97757'; g.font = 'bold 172px Menlo, monospace';
  g.fillText('EKİBİM', 512, 860);
  return c.toDataURL('image/png');
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024 });
  await win.loadURL('data:text/html,<canvas id="c" width="1024" height="1024"></canvas>');
  const url = await win.webContents.executeJavaScript(draw);
  fs.mkdirSync(OUT, { recursive: true });
  const png = path.join(OUT, 'icon.png');
  fs.writeFileSync(png, Buffer.from(url.split(',')[1], 'base64'));
  if (process.platform === 'darwin') {
    const set = path.join(OUT, 'icon.iconset');
    fs.rmSync(set, { recursive: true, force: true });
    fs.mkdirSync(set);
    for (const [size, name] of [[16, '16x16'], [32, '16x16@2x'], [32, '32x32'], [64, '32x32@2x'], [128, '128x128'], [256, '128x128@2x'], [256, '256x256'], [512, '256x256@2x'], [512, '512x512'], [1024, '512x512@2x']]) {
      execFileSync('sips', ['-z', String(size), String(size), png, '--out', path.join(set, `icon_${name}.png`)], { stdio: 'ignore' });
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(OUT, 'icon.icns')]);
    fs.rmSync(set, { recursive: true, force: true });
  }
  console.log('ikon hazır:', OUT);
  app.quit();
});
