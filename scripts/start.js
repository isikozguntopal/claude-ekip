'use strict';
// Geliştirme başlatıcısı (npm start).
// macOS'ta Electron'un bir kopyasını "Claude Ekibim.app" adı ve ekip logosuyla markalayıp onunla açar;
// böylece Dock ve menüde "Electron" yerine uygulama adı görünür. node_modules içindeki orijinale dokunulmaz.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const root = path.join(__dirname, '..');

function run(bin) {
  const child = spawn(bin, ['.'], { cwd: root, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code == null ? 0 : code));
}

function brandedBinary() {
  const src = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
  const dst = path.join(root, 'build', 'Claude Ekibim.app');
  const icns = path.join(root, 'build', 'icon.icns');
  const bin = path.join(dst, 'Contents', 'MacOS', 'Electron');
  if (!fs.existsSync(src) || !fs.existsSync(icns)) return null;

  const stamp = path.join(dst, 'Contents', '.ekibim-stamp');
  const sig = [fs.statSync(icns).mtimeMs, require('electron/package.json').version, 'v1'].join('|');
  if (fs.existsSync(bin) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === sig) return bin;

  console.log('Claude Ekibim uygulaması hazırlanıyor (ilk açılışta birkaç saniye sürer)…');
  execFileSync('ditto', [src, dst]);
  const plist = path.join(dst, 'Contents', 'Info.plist');
  const buddy = (cmd) => execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { stdio: 'ignore' });
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    try { buddy(`Set :${key} "Claude Ekibim"`); } catch { buddy(`Add :${key} string "Claude Ekibim"`); }
  }
  buddy('Set :CFBundleIdentifier "com.ozgun.claude-ekibim"');
  fs.copyFileSync(icns, path.join(dst, 'Contents', 'Resources', 'electron.icns'));
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', dst], { stdio: 'ignore' });   // değişen kopyanın imzasını yenile
  fs.writeFileSync(stamp, sig);
  return bin;
}

let bin = null;
if (process.platform === 'darwin') {
  try { bin = brandedBinary(); } catch (e) { console.warn('Marka kopyası hazırlanamadı, normal Electron ile açılıyor:', e.message); }
}
run(bin || require('electron'));
