# Önizleme paneli kurulumu (tarayıcı + iOS Simulator)

Bu notlar Mac'te yeniden kurulum için. Panel, uygulamanın sağındaki **Önizleme** düğmesiyle açılır.

## iOS Simulator
- Xcode ve en az bir iPhone simülatörü kurulu olmalı (`xcrun simctl list devices`).
- Ekran görüntüsü ve açma: `xcrun simctl` (Xcode ile gelir).
- Dokunma, kaydırma, yazı ve öğe listesi: `idb` (Facebook).
  - `brew tap facebook/fb` ve `brew trust --formula facebook/fb/idb-companion`, ardından `brew install idb-companion`
  - Python tarafı, genel ortamı bozmamak için ayrı bir sanal ortamda:
    ```bash
    python3 -m venv ~/.local/share/ekip-idb-venv
    ~/.local/share/ekip-idb-venv/bin/pip install fb-idb
    ```
  - Uygulama `idb`'yi önce `~/.local/share/ekip-idb-venv/bin/idb`, yoksa `/opt/homebrew/bin/idb` yolunda arar.

## Tarayıcı
- Yalnızca `localhost` / `127.0.0.1` adresleri açılır (ör. `npm run dev` ile çalışan Parti Ligi: `http://localhost:8888`).

## Ajan araçları (ekip-preview)
Ajan şu araçları kullanabilir: `sim_screenshot`, `sim_describe`, `sim_tap`, `sim_swipe`, `sim_type`, `preview_open`.

## Sohbet geçmişi
- Konuşma `chat-log.jsonl` dosyasında, uygulama veri klasöründe (`~/Library/Application Support/Claude Ekip/`) tutulur.
- Açılışta aynı workspace için son 400 kayıt yeniden çizilir; Claude oturumu `resume` ile devam ettirilir.
- **Yeni oturum** düğmesi bu geçmişi ve oturum kimliğini siler.
