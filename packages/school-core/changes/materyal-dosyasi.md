---
etki: minor
---

- Kaynak sürümüne dosya eki eklendi (OG-250; DOM-KYN-006): `resourceVersionInputSchema` sıralı `fileIds` listesi alır (varsayılan boş, yinelenen kimlik tek sayılır, en çok 50). İçerik türüne göre amaç ve sayı `RESOURCE_FILE_RULES` tablosundadır (metin, çalışma kâğıdı, dosya, ödev şablonu en çok 10 materyal; ses 1 dinleme sesi/materyal; video 1; soru 1 görsel; ötekiler dosya almaz). `content/resource-files.ts` `planVersionFiles` yeni dosyanın sahibini, amacını, bağsızlığını, hazırlığını ve sınırını denetler, içerikteki dosyanın listede olmasını ister (`file_unavailable`, `file_purpose_mismatch`, `file_already_attached`, `file_not_ready`, `resource_files_limit`, `resource_files_not_allowed`, `resource_file_unlinked`); önceki sürümden gelen dosyayı yeniden denetlemez. `resourceFileCountIssue` formun tür ve sayı uyarısıdır.
- Yeni sürüm ve kurum kopyası dosya listesini miras alır; kütüphane kopyasının dosya listesi boştur. `planResourceRemoval` sürüm dosyalarını da sayar.
