# Değişiklikler

API henüz sürümlenmemiş (`0.1.0`); değişiklikler en yenisi üstte listelenir.

## Randevu yazma uçları

- `POST /api/v1/appointments` (öğrenci, veli; uygunluk saati `slotId` seçilerek talep; 201 + `Location`; `Idempotency-Key` zorunlu, `If-Match` 400 `if_match_not_supported`) ve `PATCH /api/v1/appointments/:appointmentId` (öğretmen, öğrenci, veli; `Onaylandı`, `Reddedildi`, `İptal`, `Geri çekildi`; `If-Match` zorunlu). Kurallar core 2.18.0 `lib/appointments.ts` (DOM-ILT-100…104); modül `communication`. Yönetici ve ön büro yazamaz (403 `forbidden`).
- Talepte uygunluk saatlerinden yalnız seçilen saat yüklenir (`loadScope`); ders, etüt, etkinlik ve randevular çakışma denetimi için bütünüyle yüklenir. Kurum kilidi aynı saate eşzamanlı iki talepten yalnız birini yazar, öteki 409 `appointment_conflict` alır (test:pg).
- Durum değişikliğinde görünürlük sürümden önce denetlenir: aktörün göremediği randevu (`requireVisibleAppointment`) `If-Match` ne olursa olsun 404'tür, sürüm farkı ancak görünür kayıtta 409 `version_conflict` olur. Çalıştırıcıya `expectedVersions` verilmez; satır sürümü kurum kilidi altında okunur.
- Yeni hata kodları: `appointment_teacher_only`, `appointment_requester_only`, `appointment_cancel_forbidden` (403); `appointment_conflict`, `appointment_closed` (409); `appointment_slot_unavailable`, `appointment_in_past`, `appointment_type_invalid`, `appointment_transition_invalid` (422, `issues` alan yoluyla). Red ve iptalde gerekçe yoksa 400 `validation_failed` (`reason`).
- Log gizleme listesine `*.note` ve `*.reason` eklendi (kvkk: Ç); denetim kaydına yalnız değişen alan adları yazılır.
- OpenAPI ve `api-client` şeması yeniden üretildi. Migration yok.

## Talep ve izin/mazeret yazma uçları

- `POST /api/v1/requests` (veli; bağlı çocuğu için talep, şikayet veya öneri; 201 + `Location`), `PATCH /api/v1/requests/:requestId` (ön büro ve yönetici; durum, ilgili birim, eklenen yanıt; `If-Match` zorunlu), `POST /api/v1/absences` (veli; izin veya mazeret; 201 + `Location`). Oluşturma uçlarında `Idempotency-Key` zorunlu, `If-Match` 400 `if_match_not_supported`. Kurallar core `lib/requests.ts`'tedir (DOM-ILT-053, DOM-ILT-080); rol ve kapsam core `requireAuthorized`, modül talepte `communication`, bildirimde `academic`. Yazma `runCommand` ile kurum kilidi, `audit_log` (yalnız alan adları) ve kısmi yüklemeyle (`loadScope`: talep açarken hiçbir talep, güncellemede hedef talep, bildirimde aynı öğrencinin bildirimleri) tek transaction'dadır.
- `POST /api/v1/absences` gövdesi katıdır: gerekçe yalnız zorunlu `reasonCategory` (`health`, `family`, `official`, `other`); serbest açıklama (`reason`), `category` ve bilinmeyen alan 400 `validation_failed` (KVKK md. 6, en az veri; özel nitelikli veri `records.data`'ya yazılmaz). Kayıt `reasonCategory` ve tür etiketini (`category`) taşır; eski kayıtların `reason` alanı okunmaya devam eder. Log `redact` listesine `*.reasonCategory` eklendi.
- Yeni hata kodları: `student_scope_denied` (403, bu uçlarda); `request_unchanged`, `request_resolved`, `absence_overlap` (409); `request_status_invalid`, `student_inactive`, `absence_notice_late`, `absence_files_unsupported` (422, `issues` alan yoluyla).
- `GET /api/v1/collections/absences`: öğretmenlerden yalnız öğrencinin sınıf rehber öğretmeni okur (core 2.13.0, DOM-ILT-053); önceden öğrenciye ders veren her öğretmen okuyordu. Ön büro yine 403.
- OpenAPI ve `api-client` şeması yeniden üretildi. Migration yok.

## Core iş kuralı hatalarında alan yolu (`issues`)

- `mapOperationError`: `DomainError.path` varsa 422 (kind `rule`), 409 (`conflict`) ve 403 (`forbidden`, modül kapalı hariç) gövdesine 400 Zod yanıtıyla aynı `issues: [{ path, code, message }]` eklenir; `code` hatanın kodu, `message` core'un Türkçe iletisidir. `path` core'un sabit alan yoludur (kullanıcı girdisi değil). Yolsuz `DomainError`'da gövde eskisi gibidir (`issues` yok); 404 genel `not_found` kalır.
- Örnek: sınıf kaydında `subject_teacher_required` → `issues[0].path = ["subjectTeachers", "<dersId>"]`; içerik yayım sorunu `subject_required` → `["tags", "subjectId"]`. Web formları iş kuralı hatasını alan altında gösterebilir (`fieldFor` ile açık tercih; bağlanmazsa yalnız toast).
- `ErrorResponse.issues` açıklaması güncellendi; OpenAPI ve `api-client` şeması yeniden üretildi (biçim değişmedi). Yeni uç ve migration yok.

## İçerik havuzu yazma uçları

- `POST /api/v1/resources` (201 + `Location`), `PATCH /api/v1/resources/:resourceId/versions/:versionId` (kısmi; `If-Match` zorunlu), `POST /api/v1/resources/:resourceId/versions` (yeni sürüm), `POST /api/v1/resources/:resourceId/versions/:versionId/{submit,publish,withdraw,approve,reject,reopen,archive,report}`, `POST /api/v1/resources/:resourceId/{remove,share,copy}`. Roller yönetici ve öğretmen (kaldırma yalnız yönetici), modül `learning`. Kurallar core `content/*` plan fonksiyonlarıdır; yazma `runCommand` ile kurum kilidi, isteğe bağlı `Idempotency-Key`, `audit_log` ve geri okumayla tek transaction'dadır.
- Yeni hata kodları: `if_match_required` (400); `review_required`, `resource_action_forbidden`, `share_target_out_of_scope`, `license_forbids_copy` (403); `version_immutable`, `open_version_exists`, `resource_transition_invalid`, `resource_removed`, `copy_source_not_published` (409); `content_type_immutable`, `quiz_item_missing`, `resource_files_unsupported`, `share_target_not_found`, `license_inherited`, `attribution_inherited`, `reason_required` (422).
- Ayrıntı yanıtının `resource` nesnesi `archivedAt` ve `rowVersion` taşır. `resources.archived_at` bütün sürümler arşivlenince ve kaldırmada dolar, yeni sürüm açılınca boşalır. Şema değişikliği ve migration yok.
- Bilinen sınırlar: onayı yalnız yönetici verir (`TODO(content-reviewer)`), telif bildirimi gerekçesi saklanmaz (`TODO(content-report-log)`), dosyalı içerik 422. OpenAPI ve `api-client` şeması yeniden üretildi. `test:pg`: eşzamanlı iki onayda biri 409.

## Kampüs, öğretmen ve sınıf kaydetme uçları

- `POST /api/v1/branches`, `POST /api/v1/teachers`, `POST /api/v1/classes`: kayıt oluşturur, 201 + `Location` (`/api/v1/collections/<koleksiyon>/<id>`). Gövde core şemasıdır (`branchSchema`, `teacherSchema`, `classInputSchema`: sınıf bilgisi + `subjectTeachers` ders → branş öğretmeni); sınıf ve ders atamaları tek işlemde yazılır. `Idempotency-Key` zorunlu; `If-Match` 400 `if_match_not_supported`.
- `PATCH /api/v1/branches/:branchId`, `/teachers/:teacherId`, `/classes/:classId`: kısmi gövde (`branchPatchSchema`, `teacherPatchSchema`, `classPatchSchema`) kaydın güncel değerleriyle birleşip core `updateBranch`/`updateTeacher`/`updateClass` ile doğrulanır. `If-Match` zorunlu (yoksa 400 `if_match_required`, tutmazsa 409 `version_conflict`); arşivli, olmayan veya başka kurumun kaydı 404. Sınıf düzenlemesi aynı dersin ders atamasını yerinde günceller (kimlik ve sürüm korunur).
- Yetki core `branch.save`, `teacher.save`, `class.save`: yalnız `yonetici` (DOM-YTK-001; ön büro sınıf ve kontenjanı yalnız okur). Diğer roller 403. Kontenjan, branş, derslik, ad/e-posta tekilliği ve program/etüt çakışmaları core kurallarıdır (422/409). Denetim kaydı `branches|teachers|classes.create|update`, `changes` yalnız alan adları. Kampüs, sınıf ve kadro çekirdek kayıttır; modül denetimi yoktur.
- Öğretmen kaydı hesap ve `membership_links` açmaz; hesap kurum üyeleri ucunun işidir.
- `commandHeadersSchema(…, { ifMatch: 'required' })` ve `requireIfMatch()` ön işleyicisi eklendi. OpenAPI ve `api-client` şeması yeniden üretildi; migration yok.

## İçerik havuzu tabloları ve okuma uçları

- Migration `0010_enable_btree_gin` (`btree_gin` eklentisi) ve `0011_create_content_pool`: `resources`, `resource_versions`, `resource_version_outcomes`, `resource_version_items`, `resource_shares` (bileşik kurum yabancı anahtarları, durum/sözlük `check`'leri, kaynak başına tek düzenlenen sürüm, `(institution_id, search_vector)` bileşik GIN). Ayrıntı `docs/muhendislik/veritabani.md` §4, §6.
- `GET /api/v1/resources`, `GET /api/v1/resources/:resourceId`, `GET /api/v1/resources/:resourceId/versions/:versionId` (`learning` modülü; yönetici, öğretmen, öğrenci, veli; ön büro 403). Görünürlük core `canReadVersion`'dır (SQL ön süzgeci + core yeniden doğrulama); öğrenci/veli yalnız güncel yayın sürümünü cevap anahtarı ve lisans ayrıntısı olmadan görür. Arama Türkçe harf ve NFKD duyarsız önek araması; süzgeçler beyaz listede, bilinmeyen parametre 400.
- Yazma uçları yok (sonraki dilim). OpenAPI ve `api-client` şeması yeniden üretildi. Test PGlite'ı `btree_gin` ile açılır (`newPGlite`).

## Genel Bakış tek özet ucu

- `GET /api/v1/dashboard` (beş rol): Genel Bakış'ın kartları, kısa listeleri ve mini grafik verisi tek yanıtta; yanıt `role` ayırıcılı. Web rol başına 6-17 `counts`/liste isteği yerine tek istek atar. Değerler `countCollection`/`listCollection` ile hesaplanır (rol/kurum kapsamı, alan ayıklama ve türetilmiş durum `counts` ucuyla aynıdır); sayım hâlâ bellekte (`TODO(perf)`).
- Okuduğu koleksiyon aktöre kapalı olan bölüm (modül kapalı, kurum türünde yok, rol okuyamıyor) `null` döner. `studentId` yalnız öğrenci ve velide: velide verilmezse ilk çocuk, personelde 400, kapsam dışı öğrenci 404. Öğrenci özetinde ödeme alanı yoktur.
- OpenAPI ve istemci şeması yeniden üretildi. Şema değişikliği ve migration yok; mevcut uçlar değişmedi.

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
