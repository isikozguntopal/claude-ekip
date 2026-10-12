# Claude Ekip

Claude Code'u pixel-art bir "ofis"te 5 kişilik geliştirici ekibi olarak yöneten masaüstü uygulaması.

| Üye | Plugin | Görev |
|---|---|---|
| Claude (lider) | yerleşik | Sohbeti alır, işi ekibe dağıtır |
| Süper Mimar | `superpowers` | Beyin fırtınası → plan → TDD → doğrulama |
| Piksel | `frontend-design` | Özgün, üretim kalitesinde arayüz |
| Dedektif | `code-review` | Paralel ajanlarla kod incelemesi |
| Bekçi | `security-guidance` | Her düzenlemede güvenlik taraması (hook) |
| Patron | `gstack` (elle kurulum) | CEO/mühendis/QA gözüyle plan ve yayın |

## Çalıştırma

- Paketlenmiş: `dist\ClaudeEkip\ClaudeEkip.exe`
- Geliştirme: `npm start`
- Yeniden paketleme: `npm run package`

## Notlar

- Claude masaüstü uygulamasının imzalı `claude.exe`'sini kullanır (`%APPDATA%\Claude\claude-code\<sürüm>\…`). Bulunamazsa uygulama yolunu sorar.
- Paketleme electron-builder kullanmaz: kurumsal EDR imzasız exe'leri engellediği için imzalı `electron.exe` kopyalanıp `ClaudeEkip.exe` olarak yeniden adlandırılır.
- Plugin'ler seçilen workspace'e **proje kapsamında** kurulur (`<workspace>\.claude\settings.json`).
- Ayarlar: `%APPDATA%\Claude Ekip\settings.json`.
- Ekran görüntüsü testi: `EKIP_SNAPSHOT=<png>` (+ isteğe bağlı `EKIP_SNAPSHOT_JS`, `EKIP_SNAPSHOT_WAIT`).
