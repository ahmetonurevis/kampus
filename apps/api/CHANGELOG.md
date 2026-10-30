# Değişiklikler

API henüz sürümlenmemiş (`0.1.0`); değişiklikler en yenisi üstte listelenir.

## R6 inceleme düzeltmeleri

- Okuma kapsamı: öğrenci ve veli `opticalProfiles`'ta yalnız görebildiği denemelerin profilini alır (liste, arama, sıralama, ayrıntı ve `counts?groupBy=examId`); başka düzeyin profili artık yok. Kapsam kaynağı `mockExams`'i de yükler. Yanıt şekli değişmedi.
- `GET /audit-events`: yeni `createdBefore` sorgu parametresi (ISO 8601 UTC, hariç üst zaman sınırı). Sayfalı dışa aktarma sınırı ilk istekte sabitler; sürerken yazılan yeni denetim kaydı offset sayfalarını kaydırıp CSV'de mükerrer satır üretmez. OpenAPI ve `api-client` şeması yeniden üretildi.
- `GET /institution-members`: rolü tanınmayan (ör. sütun varsayılanı `member`) tek bir üyelik artık bütün listeyi 500'e düşürmez; satır `institution_members.role_unrecognized` uyarısıyla (yalnız üyelik kimliği) loglanıp listeden atlanır. `meta.total` satırı saymaya devam eder. Kimlik doğrulamadaki `safeParse` kalıbıyla aynıdır.

## Ayarlar: kurum kullanıcıları ve işlem geçmişi

- `GET /api/v1/institution-members` (yalnız yönetici): kurum üyeleri; ad, e-posta, rol, durum (bağlı kişi kaydından türetilir), bağlı kişi adı ve oluşturulma anı. `q`, `role`, `status`, `sort`, sayfalama. Telefon, parola, oturum ve IP dönmez. Yalnız okuma.
- `GET /api/v1/audit-events` (yalnız yönetici): kurumun `audit_log` kayıtları en yeniden eskiye; zaman, işlem, varlık, yapan kişi (ad, rol), alan adları ve gerekçe. Tarih (Europe/Istanbul günü), yapan kişi ve varlık türü süzgeçleri. Değer, IP ve istek kimliği dönmez; rehberlik kayıtlarında alan adı ve kimlik de dönmez (DOM-YTK-020). Kimlik olayları (`auth.*`) güvenlik kaydı olduğundan listeden süzülür. Okuma denetim kaydı üretmez.
- Şema değişikliği ve migration yok.

## Optik ve etüt güvenlik incelemesi düzeltmeleri

- `POST /assessment/plan`: `expectedPlan` artık dosya alanı gibi ölçülür; 1 MB üstü 413 `payload_too_large` (`issues[0].path = ["expectedPlan"]`) ve gövde tavanı 4 MiB'dir. Daha önce JSON kaçışlı büyük plan genel 1 MiB sınırına takılıp onayda hep 413 veriyordu. Boş `expectedPlan` (`""`) artık 400; alan verilirse en az 1 karakter olmalıdır (bayatlık denetimini atlatıyordu). OpenAPI yeniden üretildi.
- Önizlemeler (`plan/preview`, `evaluate/preview`) kurum danışma kilidini almaz: `runReadOnly` (`REPEATABLE READ READ ONLY` transaction, yazma yok) ile çalışır; `PreviewRollback` ile geri alma kalktı. Ardışık büyük önizlemeler kurumun yazan işlemlerini sıraya sokmaz. Davranış (yanıt, "hiçbir şey yazmaz") değişmedi.
- Testler: öğretmenin kendi branşında plan önizleme/onayı, Deneme Sınavları kapalıyken optik/plan uçları 403 `module_disabled`, başka kurumun sınavıyla plan 404, `test:pg` kilit tutulurken önizlemenin tamamlanması.
- `docs/muhendislik/veritabani.md`: migration 0009 indeksleri ve transaction dışı indeks çalıştırıcı kararı notu (şema/migration değişikliği yok).

## Optik değerlendirme ve otomatik etüt köprüsü

- `POST /api/v1/assessment/<komut>[/:recordId]`: core `ASSESSMENT_COMMANDS`'ın yedi komutu (`profile`, `evaluate`, `plan`, `slot`, `slot-remove`, `cancel`, `attendance`) `runAssessment` ile tek transaction'da. Rol, kapsam ve modül (`optical`, `tutoring`) core'dadır; `evaluate` ve `plan` `Idempotency-Key` ister, kayıtlı komutlarda `If-Match` kaydın sürümüdür. Yanıt `CommandResult`; denetim eylemi `assessment.<komut>`.
- Okuyucu dosyası gövdede metin (`text`, `keyCsv`): alan başına 1 MB (aşarsa 413 `payload_too_large`, gövde tavanı bu rotalarda 4 MiB), dosya hataları 422 ve `issues[0].path = [alan, "line", satır]`.
- `POST /api/v1/assessment/plan/preview` ve `/evaluate/preview`: saf önizleme (işlem çalıştırıcının hattı, sonuç `after` kancasında transaction geri alınarak çıkarılır; satır, sürüm ve denetim kaydı değişmez). Plan yanıtı `sessions`, `unresolved` (neden), `covered`, `summary`, `expectedPlan`; değerlendirme yanıtı özet ve `digest`.
- Onayda fark: `plan` + `expectedPlan` bayatsa 409 `tutoring_plan_stale` ve `issues` içinde plan farkı; `evaluate` + `expectedDigest` bayatsa 409 `evaluation_stale`. Hiçbir şey yazılmaz.
- `services/commands.ts`: `execute`, `auditEntity`, `auditedEntity`, `Entity` dışa aktarıldı (yeni servis kullanır; davranış değişmedi). OpenAPI ve istemci şeması yeniden üretildi.
- Eski `POST /tutor-sessions*` uçları değişmedi.
- Şema değişikliği ve migration yok.

## Kurum modül ayarı

- `GET /api/v1/modules` (yönetici): kurum türünde bulunan modüller, açık/kapalı durumları ve `If-Match` için ayar sürümü.
- `PATCH /api/v1/modules/:moduleKey` (yönetici, gövde `{ enabled }`): modülü açar/kapatır (DOM-YTK-040, DOM-YTK-042). `If-Match` (`institution_settings.version`) ve `Idempotency-Key` zorunludur. Tek transaction'da kurum kilidi, sürüm denetimi, school-core `setModuleEnabled`, `institutions.enabled_modules` ve sürüm güncellemesi, `audit_log` (`module.set`, `changes.fields: ['enabledModules']`). Kurum türünde olmayan modül 422 `module_unavailable_for_type`, değişmeyen durum 409 `module_unchanged`, eski sürüm 409 `version_conflict`. Kapatma veri silmez; kapalı modülün uçları 403 `module_disabled` döner, açılınca kayıtlar aynen görünür.
- Hata mesajı `if_match_required` eklendi. Şema değişikliği ve migration yok.
- `test/support/pg.ts`: `test:pg` dosyaları paralel migrate ederken benzersizlik hatası almasın diye migrate yeniden denenir.
