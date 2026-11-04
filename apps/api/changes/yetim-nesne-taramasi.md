---
etki: minor
---

Dosya deposunda satırsız (yetim) nesne taraması (OG-093; IST-027; ADR 0003 karar 4, 5, 13).

- Depo arayüzüne `list(prefix, log?)` eklendi: kurum öneki (`<kurum>/`) altındaki tamamlanmış nesneleri anahtar ve son değişiklik zamanıyla akışla verir; disk sürücüsü `opendir` ile dolaşır, geçici `.part` dosyalarını ve anahtar biçimine uymayan girdileri atlar. Listelemeden önce `realpath` ile önek yolunun kök altında olduğu doğrulanır: kurum klasörü kök dışını gösteren sembolik bağsa liste boştur, `storage.list_outside_root` uyarısı yazılır, hiçbir şey silinmez. S3 sürücüsü `ListObjectsV2` ile aynı arayüzü uygulayacak (`TODO(F3c2-s3)`).
- Yeni zamanlanmış iş `files.purge-orphans` (her gün 04:45, Europe/Istanbul, kurum başına): hiçbir `files` satırının tutmadığı nesneleri siler. Tutan: `pending`/`processing`/`ready` satırın anahtarı ve silinmeyi bekleyen özgün ses nesnesi (`superseded_storage_key`); `rejected` ve `deleted` satırın silinemeyip kalan nesnesi yetimdir. Son değişikliği 24 saatten yeni nesne silinmez (yükleme ve dönüşüm nesneyi satırdan önce yazar).
- Sınırlar: çalıştırma başına en çok 500 BAŞARILI silme (`stopped: 'limit'`; silinemeyen nesne bu sınırı doldurmaz, böylece kalıcı hata veren nesneler arkadaki yetimlerin önünü tıkamaz), en çok 50 silme hatası (`stopped: 'failures'`) ve en çok 100 000 taranan nesne (`stopped: 'scan_limit'`); iptal sinyaline silme döngüsünde de bakılır (`stopped: 'aborted'`). Kalanlar ertesi güne kalır.
- Silme hatası öteki nesneleri durdurmaz, yalnız kurum kimliği ve depo anahtarıyla loglanır (`file.orphan_delete_failed`); iş sonucu ve `file.orphans_purged` logu taranan, aday, silinen, hatalı ve yeni (atlanan) sayılarını verir.
- KVKK: kurum başına en az bir silme olan çalıştırma tek toplu `file.orphans_purge` denetim satırı yazar (aktör sistem; `changes.counts` yalnız taranan, silinen, hata sayıları; anahtar, ad ve içerik yok). İşlem geçmişi ekranında "Yetim dosyalar temizlendi" görünür. Migration yok.
- İşletme: veritabanı yedekten geri dönerken önce `files.purge-orphans` durdurulmalı, depo ile veritabanı eşitlenince açılmalı (`docs/muhendislik/veritabani.md` §9).
