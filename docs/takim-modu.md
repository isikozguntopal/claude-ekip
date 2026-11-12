# Takım modu — tasarım

Mevcut Claude Ekibim uygulamasının genişletilmesi. Yeni uygulama yok; yeni dosyalar: `team-mode.js` (ana süreç), `conflict.js` (çakışma tespiti), `renderer/team.js` (arayüz), `firebase/firestore.rules`, `site/join.html`.

## Varsayımlar (soru sormadan ilerlendi)
1. **Sunucu: Firebase (Spark, ücretsiz, kart yok).** Auth (e-posta/şifre) + Firestore + güvenlik kuralları. Supabase ücretsiz proje limiti dolu olduğu için seçildi. Uygulama Firebase SDK'sı yerine **REST** kullanır (ana süreçte oturum saklama sorunu ve bağımlılık yok). Canlı dinleme yok: heartbeat 30 sn, gelen görev yoklaması 60 sn, panel açıkken 20 sn'de bir yenileme. Hesabı ve projeyi **kullanıcı açar**; uygulama `Project ID` ve `Web API Key` ister (gizli değildir, koruma kurallardadır).
2. **Giriş:** e-posta/şifre (GitHub/Google girişi sonraya; ek OAuth istemcisi kurulumu gerektirir).
3. **Davet linki:** takım kimliği + gizli kod (`teamId + inviteCode`). Link `site/join.html?code=…` (GitHub Pages ile yayınlanır): işletim sistemini algılar, indirme sayfasına yönlendirir, "Uygulamada aç" `claude-ekibim://join?code=…` çağırır. Uygulamaya kod/link elle de yapıştırılabilir.
4. **Gizlilik:** sunucuya yalnızca metadata gider (üye, durum, konu, repo özeti, görev başlığı/açıklaması, karar). Sohbet, prompt ve yanıt metinleri sunucuya **yazılmaz**. Çakışma kontrolü **kendi bilgisayarında** çalışır: paylaşılan kayıtlar indirilir, karşılaştırma yerel Haiku çağrısıyla yapılır.
5. **Hesap yok:** Claude kimlik bilgisi/oturumu paylaşılmaz. Görev, alıcının makinesinde alıcının kendi Claude hesabıyla çalışır.
6. **Repo verisi:** her üyenin kendi `gh` CLI'ı özet çıkarır (branch, açık PR, son commit) ve `member_repos`'a yazar; kişiler arası dosya paylaşımı yok. Yerel klon yolu yalnızca yerel `team-local.json`'da.

## Veri modeli (Firestore)
```
users/{uid}                      → { teamId }
teams/{t}                        → { name, inviteCode, createdBy }
  members/{uid}                  → presence: last_seen, topic, active_repo/branch, role, code
  team_repos/{repo} · member_repos/{uid__repo} (installed, branch, commit, açık PR'lar)
  tasks/{id}                     → from→to, repo, status, conflict, result, topic_id
  topics/{id}                    → mevcut durum, iki istek, neden, options[], votes{uid:optionId}, comments[]
  decisions/{id}                 → statement, area, repo, topic_id, task_id, active
  notes/{id}                     → toplantı notu / transkript
```
teams ─< members (presence: last_seen, topic, active_repo/branch)
teams ─< team_repos ─< member_repos (üye başına: installed, branch, commit, açık PR'lar)
teams ─< task_requests (from→to, repo, status, conflict, result, topic_id)
teams ─< topics ─< topic_options ─< topic_votes ; topics ─< topic_comments
teams ─< decisions (statement, area, repo, topic_id, task_id, active)
teams ─< notes (toplantı notu/transkript)
```
Görev durumları: `pending → accepted → running → done|failed`, ya da `declined`, `ignored` (çakışma "yoksayıldı"), `discussion` (Tartışma'ya gitti).

## Çakışma tespiti akışı (`conflict.js`)
```
yeni istek (görev isteği | özellik/değişiklik | yerel prompt*)
  1. Bağlamı topla: aktif kararlar, açık/çalışan görevler, açık konular, son notlar (aynı repo/alan)
  2. Aday süz: anahtar kelime + repo eşleşmesi, en fazla ~20 kayıt (token tasarrufu)
  3. Aday yoksa → LLM çağrısı yok → verdict "none"
  4. Haiku (araçsız, tek tur) → JSON {verdict: none|minor|major, items[], reason, options[]}
  5a. none  → kuyruğa al
  5b. minor → "Yoksay" seçeneği; yoksayılırsa ignore_reason ile kayda geçer, nedeni görünür
  5c. major → otomatik uygulama YOK; Tartışma'da konu aç (iki taraf, mevcut durum, neden,
              2–3 seçenek, biri dengeleyici). Oy + yorum. Karar → decisions'a yazılır
              (görev ve repoya bağlı), eski karar pasifleşir.
```
\* Yerel promptlar sunucuya gitmez; kontrol yalnızca "Takım modu" açıkken ve ayar etkinse yapılır.

## İlk sürüm kapsamı
**Var:** Firestore kuralları, e-posta girişi, takım kur/katıl, davet sayfası, üye listesi + presence + konu, repo bağlama + `gh` özeti, görev isteği (kuyruk → onay → alıcıda çalışma → sonuç bildirimi), çakışma tespiti (none/minor/major), Tartışma sekmesi (konu, seçenek, oy, yorum, karar), notlar.
**Sonraya:** Windows/macOS kurulum paketleri ve imzalı sürümler (indirme bağlantıları yer tutucu), özel protokolün paketlenmiş uygulamada kaydı, otomatik repo klonlama (yalnızca `gh repo clone` komutu önerilir), toplantı transkriptinin otomatik içe aktarımı, yerel promptların sürekli kontrolü, bildirim (OS bildirimi), karar geçmişi aramaları.
