---
etki: minor
---

Yüklenen belge, görsel ve video dosyaları virüs taramasından geçirildi (OG-092; IST-027, ADR 0003 karar 8, DOM-KYN-004).

- API'ye `file.scan` işi eklendi: tarayıcı açıkken ses dışı yükleme `processing` başlar, iş yüklemeyle aynı işlemde kuyruğa girer ve dosyayı ClamAV (`clamd`, `clamscan` paketi) ile tarar. Temiz dosya `ready` olur ve kayda bağlanabilir; zararlı dosya (makrolu Office, şifreli belge ve PDF sezgisi bulguları dahil) `rejected` olur, nesnesi silinir, yükleyici bağlamada "Dosyayı yeniden yükleyin" iletisini alır.
- Tarayıcıya ulaşılamazsa dosya `processing` kalır ve tarama geri çekilmeli yeniden denenir; dosya hiçbir yolda taramasız `ready` olmaz. Kuyruk kapalıyken tarama süreç içinde çalışır, yarım kalanlar açılışta yeniden denenir.
- Yeni ortam değişkenleri `FILE_SCANNER` (`clamav` | `off`), `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS`. Üretimde varsayılan `clamav`'dır ve `off` reddedilir; geliştirme ve testte varsayılan `off`'tur (dosya eskisi gibi `pending` kalır).
- `compose.yaml`'a isteğe bağlı `clamav` profili (`docker compose --profile clamav up -d`) ve `deploy/clamav/clamd.conf` eklendi.
- Ses kayıtları henüz taranmaz (`TODO(ses-taramasi)`).
