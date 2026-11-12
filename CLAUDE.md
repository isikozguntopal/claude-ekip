# Claude Ekip

Claude Code'u pixel-art bir "ofis"te 5 kişilik geliştirici ekibi (lider + Süper Mimar, Piksel, Dedektif,
Bekçi, Müdür) olarak yöneten Electron masaüstü uygulaması. Claude Agent SDK ile Claude Code'u çalıştırır;
her ekip üyesi bir plugin'e karşılık gelir (bkz. `team.js`, README).

Önceki konuşmalar (neden böyle yapıldığı, kullanıcının istekleri): `docs/sohbet-gecmisi/claude-ekip-sohbetleri.md`.

## Kullanıcıyla çalışma

- Kullanıcıyla **Türkçe** konuş. Yeni süreçlerde adım adım yönlendir.
- Uygulama, kullanıcının oyun projesi **Parti Ligi** (`party-league` deposu, eski adı `lazer-kafes`) üzerinde
  çalışmak için kullanılıyor.

## Yapı

```
main.js       Electron ana süreç: ayarlar, claude ikili dosyasını bulma, oturum, plugin kurulum durumu
preload.js    Ana süreç ↔ arayüz köprüsü
team.js       Ekip üyeleri, plugin eşleşmeleri, sistem talimatları
renderer/     Arayüz (app.js, index.html, style.css, markdown.js) — pixel-art ofis, sohbet, limitler
scripts/package-win.js   Windows paketleme (imzalı electron.exe'yi kopyalayıp yeniden adlandırır)
```

- Gerçek alt ajanlar `main.js` içindeki `TEAM_AGENTS`: supermimar, piksel (Sonnet), dedektif, bekci (Haiku, salt okunur). Lider (`LEAD_PERSONA`) yalnızca büyük işi böler, küçük işi kendi yapar; arayüz `team.js` `AGENT_MEMBER` ile alt ajan türünü üyeye eşler. Müdür (gstack) alt ajan değil, skill paketidir.
- Uygulamanın ayrı bir Claude profili var: `~/.claude-ekip` (`CLAUDE_CONFIG_DIR`). Ana Claude hesabından bağımsız giriş.
- Ayarlar: Electron `userData` klasöründe `settings.json` (`claudePath`, son çalışma klasörü, model…).

## Çalıştırma

```bash
npm install
npm start          # geliştirme
```

## Mac'e geçiş notları

- Windows'ta masaüstü uygulamasının `claude.exe`'si `%APPDATA%\Claude\claude-code\<sürüm>` altında aranır.
  Mac/Linux'ta `findClaudeUnix()` şunlara bakar: `~/Library/Application Support/Claude/claude-code/<sürüm>`,
  `~/.local/bin/claude`, Homebrew ve PATH. Bulunamazsa uygulama yolu kullanıcıya sorar.
- `scripts/package-win.js` yalnızca Windows içindir (kurumsal EDR yüzünden electron-builder kullanılmadı).
  Mac'te paket gerekiyorsa `electron-builder` ya da `@electron/packager` ile bir `.app` üretilebilir; şimdilik
  `npm start` yeterli.
- `dist/` (paketlenmiş Windows exe) depoya konmaz.

## Takım modu (yeni)

Tasarım ve varsayımlar: `docs/takim-modu.md`. Dosyalar: `team-mode.js` (Firebase Auth + Firestore REST, presence, gh repo özeti, görev kuyruğu),
`conflict.js` (çakışma tespiti, saf mantık; `node scripts/conflict-test.js` gerçek Haiku ile dener), `renderer/team.js` (Takım paneli),
`firebase/firestore.rules` (güvenlik kuralları), `scripts/team-mock-test.js` (sahte Firebase ile uçtan uca test), `site/join.html` (davet sayfası; GitHub Pages ile yayınlanabilir).
Sunucuya yalnızca metadata gider; sohbet/prompt/yanıt yerel kalır. Kurulum: Firebase projesi aç → Authentication'da E-posta/Şifre → Firestore oluştur → kuralları yapıştır → Web API Key + Project ID'yi uygulamada Takım › Bağlantı'ya gir.
