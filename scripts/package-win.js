// Windows paketleyici — electron-builder/rcedit gibi imzasız exe çalıştırmadan
// (kurumsal EDR bunları engelliyor) imzalı electron.exe'yi kopyalayıp yeniden adlandırır.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const outDir = path.join(root, 'dist', 'ClaudeEkip');
const exeName = 'ClaudeEkip.exe';
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');

if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  console.error('node_modules/electron/dist/electron.exe yok — önce npm install çalıştırın.');
  process.exit(1);
}

console.log('> temizleniyor', outDir);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

console.log('> Electron çalışma zamanı kopyalanıyor');
fs.cpSync(electronDist, outDir, { recursive: true });
fs.renameSync(path.join(outDir, 'electron.exe'), path.join(outDir, exeName));
fs.rmSync(path.join(outDir, 'resources', 'default_app.asar'), { force: true });

const appDir = path.join(outDir, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });

console.log('> uygulama dosyaları kopyalanıyor');
for (const f of ['main.js', 'preload.js', 'team.js', 'renderer']) {
  fs.cpSync(path.join(root, f), path.join(appDir, f), { recursive: true });
}
const runtimePkg = { name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main, private: true };
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(runtimePkg, null, 2));

console.log('> üretim bağımlılıkları kopyalanıyor');
const list = execSync('npm ls --omit=dev --parseable --all', { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/).map((s) => s.trim()).filter((p) => p && path.resolve(p) !== root);
const nm = path.join(root, 'node_modules');
let n = 0;
for (const p of list) {
  const rel = path.relative(nm, p);
  if (rel.startsWith('..')) continue;
  // SDK'nın kendi gömülü claude ikilisi kullanılmıyor (masaüstü uygulamasının imzalı claude.exe'si kullanılır)
  if (/claude-agent-sdk-win32/.test(rel)) continue;
  const dest = path.join(appDir, 'node_modules', rel);
  if (fs.existsSync(dest)) continue;
  fs.cpSync(p, dest, { recursive: true }); // iç içe node_modules da birlikte gelir
  n++;
}
console.log(`  ${n} paket`);

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => {
  const fp = path.join(dir, e.name);
  return s + (e.isDirectory() ? size(fp) : fs.statSync(fp).size);
}, 0);
console.log(`\n✓ Hazır: ${path.join(outDir, exeName)}  (${(size(outDir) / 1048576).toFixed(0)} MB)`);
