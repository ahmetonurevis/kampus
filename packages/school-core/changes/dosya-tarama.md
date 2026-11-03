---
etki: minor
---

Yüklenen belge, görsel ve video dosyaları virüs taramasından geçirildi (OG-092; IST-027, ADR 0003 karar 8, DOM-KYN-004).

- API'ye `file.scan` işi eklendi: tarayıcı açıkken ses dışı yükleme `processing` başlar, iş yüklemeyle aynı işlemde kuyruğa girer ve dosyayı ClamAV (`clamd`, kendi küçük INSTREAM istemcimizle) ile tarar. Temiz dosya `ready` olur ve kayda bağlanabilir; zararlı dosya (makrolu Office, şifreli belge, PDF sezgisi ve tarama sınırını aşan içerik dahil) `rejected` olur, nesnesi silinir; yükleyen okumada ve bağlamada 422 `file_rejected` ile "Dosya güvenlik taramasından geçmedi. Başka bir dosya yükleyin." iletisini alır (başkası 404).
- Tarayıcıya ulaşılamazsa dosya `processing` kalır ve tarama geri çekilmeli yeniden denenir; dosya hiçbir yolda taramasız `ready` olmaz. Denemeleri biten taramalar 15 dakikada bir (`file.scan-requeue`) yeniden kuyruğa girer; tarama bekleyen bağsız dosya 24 saatte değil 7 gün sonra silinir. Kuyruk kapalıyken tarama süreç içinde çalışır, yarım kalanlar açılışta yeniden denenir.
- Yeni ortam değişkenleri `FILE_SCANNER` (`clamav` | `off`), `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`. Üretimde varsayılan `clamav`'dır ve `off` reddedilir; geliştirme ve testte varsayılan `off`'tur (dosya eskisi gibi `pending` kalır).
- `compose.yaml`'a isteğe bağlı `clamav` profili (`docker compose --profile clamav up -d`) ve `deploy/clamav/clamd.conf` eklendi (`AlertExceedsMax yes`; akış ve dosya sınırları en büyük yükleme sınırının üstünde).
- Geç taranan bağsız dosyanın 24 saatlik temizlik süresi yüklemeden değil, taramanın bittiği andan sayıldı (OG-995): `clamd` kesintisinden sonra `ready` olan dosya bağlanmaya fırsat bulmadan silinmedi; taramasız (`pending`) dosyada süre eskisi gibi yüklemeden sayıldı.
- Ses kayıtları da virüs taramasından geçirildi (OG-988): tarayıcı açıkken dönüşüm ve tarama aynı yüklemede kuyruğa alındı, dönüşüm taramayı beklemedi; dosya dönüşüm bitip tarama temiz çıkınca `ready` oldu. Zararlı ses reddedildi, özgün ve dönüşmüş nesnesi silindi. Tarayıcı kapalıyken ses eskisi gibi dönüşümle `ready` oldu.
