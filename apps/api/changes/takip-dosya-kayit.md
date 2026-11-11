---
etki: minor
---

- İmzalı indirme belirteci özgün adı ve türü taşımaz (KVKK: URL vekil loguna ve tarayıcı geçmişine girer). Yük yalnız kurum, dosya kimliği, bitiş ve disposition'dır; `GET /api/v1/files/download` ad ve türü `files` satırından okur, silinmiş veya reddedilmiş dosya süresi içindeki bağlantıda da 404 alır. Eski biçimdeki belirteçler 403 `invalid_signature` alır (5 dk ömürlü).
- ADR 0003 karar 1: `STORAGE_DRIVER=disk` üretimde (`NODE_ENV=production`) başlangıçta açık bir hatayla reddedilir (`loadConfig` → `assertStorageForEnvironment`); S3 sürücüsü gelene kadar API üretimde başlamaz (`TODO(F3c2-s3)`). `STORAGE_DIR` üretimde artık zorunlu değil. Şema doğrulaması `parseConfig`'e ayrıldı. Geliştirme ve test (`NODE_ENV=test`) etkilenmez.
- `recordFileCheck` ret sonrası nesne silme hatasını yutmaz: `file.reject_object_failed` olarak yalnız kurum ve dosya kimliğiyle loglar ve asıl hatayı fırlatır; satır `rejected` kalır. Aynı dosya için ret yeniden bildirilirse durum ve denetim değişmeden yalnız nesne silme yeniden çalışır; `ready` bildirimi 409 `file_already_checked` kalır. Servis girdisine `log` eklendi.
