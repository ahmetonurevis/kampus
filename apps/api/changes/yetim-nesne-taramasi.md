---
etki: minor
---

Dosya deposunda satırsız (yetim) nesne taraması (OG-093; IST-027; ADR 0003 karar 4, 5, 13).

- Depo arayüzüne `list(prefix)` eklendi: kurum öneki (`<kurum>/`) altındaki tamamlanmış nesneleri anahtar ve son değişiklik zamanıyla akışla verir; disk sürücüsü `opendir` ile dolaşır, geçici `.part` dosyalarını ve anahtar biçimine uymayan girdileri atlar. S3 sürücüsü `ListObjectsV2` ile aynı arayüzü uygulayacak (`TODO(F3c2-s3)`).
- Yeni zamanlanmış iş `files.purge-orphans` (her gün 04:45, Europe/Istanbul, kurum başına): hiçbir `files` satırının tutmadığı nesneleri siler. Tutan: `pending`/`processing`/`ready` satırın anahtarı ve silinmeyi bekleyen özgün ses nesnesi (`superseded_storage_key`); `rejected` ve `deleted` satırın silinemeyip kalan nesnesi yetimdir. Son değişikliği 24 saatten yeni nesne silinmez (yükleme ve dönüşüm nesneyi satırdan önce yazar); çalıştırma başına en çok 500 silme denenir, kalanlar ertesi güne kalır. Silme hatası öteki nesneleri durdurmaz, yalnız kurum kimliği ve depo anahtarıyla loglanır (`file.orphan_delete_failed`); iş sonucu ve `file.orphans_purged` logu taranan, aday, silinen, hatalı ve yeni (atlanan) sayılarını verir. Migration yok.
