# Değişiklikler

API henüz sürümlenmemiş (`0.1.0`); değişiklikler en yenisi üstte listelenir.

## Tarifeli kesin kayıt

- **Kırıcı:** `POST /api/v1/prospects/:prospectId/enroll` gövdesi değişti: `totalCents` kalktı; tutar yayımlanmış tarifeden hesaplanır. `identity` ve `guardian` zorunlu, `discounts`, `extras`, `lessonHours` eklendi.
- `fee_tariffs.discounts` ve `student_identities` eklendi (migration `0016_add_enrollment_terms`). `GET /api/v1/prospects/:prospectId/guardian-matches` ve `GET /api/v1/students/:studentId/identity` eklendi.
- Log gizleme listesine `identity`, `identityNumber`, `birthDate` eklendi. OpenAPI ve `api-client` şeması yeniden üretildi.

## Ücret tarifesi uçları

- `fee_tariffs` tablosu ve `GET`/`POST /api/v1/fee-tariffs`, `GET`/`PATCH /api/v1/fee-tariffs/:tariffId`, `POST /api/v1/fee-tariffs/:tariffId/publish` eklendi (ADR 0006 karar 8, DOM-FIN-002, -004, -006, IST-104). Migration `0015_create_fee_tariffs`.
- Sözleşme ve tahsilat henüz tarifeye bağlı değildir. OpenAPI ve `api-client` şeması yeniden üretildi.

## Tahsilat uçları

- `payments`, `payment_allocations` ve `payment_settings` tabloları eklendi (ADR 0006, migration `0014_create_payments`).
- `POST /api/v1/payments`, `GET /api/v1/payments`, `GET /api/v1/payments/:paymentId`, `POST /api/v1/payments/:paymentId/reverse`, `GET` ve `PATCH /api/v1/payment-settings` eklendi (DOM-FIN-030…033, DOM-FIN-052).
- **Kırıcı:** `POST /api/v1/invoices/:invoiceId/pay` artık tahsilat kaydı da yazar; `Nakit` yöntemi kurumda nakit kapalıysa 422 `cash_payment_disabled` alır. Nakit varsayılan kapalıdır, örnek kurum tohumunda da.
- Log gizleme listesine `reference` ve `reversalReason` eklendi. OpenAPI ve `api-client` şeması yeniden üretildi.

## Kesin kayıt ucu

- `POST /api/v1/prospects/:prospectId/enroll` eklendi (201 + `Location`; `Idempotency-Key` ve `If-Match` zorunlu; yalnız `yonetici` ve `onburo`, modül `crm`). Öğrenci, veli, taksit, sözleşme ve aday aşaması tek transaction'da yazılır (DOM-KAY-001, DOM-KAY-011, DOM-KAY-035).
- Tutar kuruş olarak alınır (`totalCents`, DOM-FIN-001). Tutar henüz serbest girilir; tarife gelince tarifeden hesaplanacak (`TODO(fee-tariff)`, DOM-FIN-002).
- OpenAPI ve `api-client` şeması yeniden üretildi. Migration yok.

## Rubrik uçları

- `GET /api/v1/rubrics` (sayfalı; rubrik, son sürümün özeti ve yayındaki sürüm kimliği) ve `GET /api/v1/rubrics/:rubricId` (bütün sürümler, her biri atama ve puan kullanım sayısıyla); yalnız `yonetici` ve `ogretmen` (core `isContentStaff`, rubrik kurumundur, IST-048). Modül `learning`; kapalıysa 403 `module_disabled`.
- `POST /rubrics` (yeni rubrik ve ilk taslak, 201 + `Location`) ve `POST /rubrics/:rubricId/versions` (yeni taslak sürüm, 201 + `Location`; açık taslak varken 409 `open_rubric_version_exists`). Oluşturma uçları `Idempotency-Key` kabul eder, `If-Match` 400 `if_match_not_supported` verir. Dil okulunda kazanıma bağlı bant 422 `rubric_alignment_invalid` (DOM-BEC-020).
- `PATCH /rubrics/:rubricId/versions/:versionId` (taslak düzenleme; verilmeyen alan kalır, `criteria` bütün olarak değişir, birleşmiş içerik core şemasıyla yeniden doğrulanır), `POST …/publish` ve `POST …/archive`: `If-Match` sürümün `rowVersion`'ıdır ve zorunludur (eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`). Yayım önceki yayındaki sürümü aynı işlemde arşivler; taslak olmayan veya kullanılmış sürümün düzenlenmesi 409 `rubric_version_immutable`, yayında olmayan sürümün arşivi 409 `rubric_version_not_published` (DOM-BEC-022). Düzenleme, yayım ve arşiv yalnız rubriğin sahibine ve yöneticiye açıktır (core `canManageRubric`; diğer öğretmen 403). Sıra: kapsam (404) → yetki (403) → sürüm (409).
- Depo (`db/skills.ts`): `findRubric`, `listRubrics`, `applyRubricPublish`, `applyRubricArchive`, `rubricUsageByVersion` eklendi. Yayım önce yayındaki sürümü arşivler, sonra taslağı yayımlar; satır sürümü tutmazsa 409 `version_conflict`, eşzamanlı ikinci yayım 409 `published_rubric_version_exists`. Bu ve `rubric_version_exists` kodları kurum kilidi yüzünden uçtan tetiklenemez; depo testinde doğrulanır.
- Rubrik başlığı, bant tanımı ve kriter metni loglanmaz; denetim kaydına yalnız alan adları yazılır (`rubric.create`, `rubric.version_create`, `rubric.draft_update`, `rubric.publish`, `rubric.archive`).
- OpenAPI ve `api-client` şeması yeniden üretildi. Migration yok.

## Aday/CRM yazma uçları

- `POST /api/v1/prospects` (aday ekle; 201 + `Location`; `Idempotency-Key` zorunlu, `If-Match` 400 `if_match_not_supported`), `PATCH /api/v1/prospects/:prospectId` (aşama; gövde `{ stage, lostReason?, siblingOfId? }`), `POST /api/v1/prospects/:prospectId/notes` (not; 201 + `Location`), `POST /api/v1/prospects/:prospectId/meetings` (tanışma görüşmesi; 200) ve `POST /api/v1/prospects/:prospectId/trial-lessons` (deneme dersi; 200; yalnız `language_school`, okulda her rol için 404). Var olan adayı değiştiren uçlarda `If-Match` zorunlu (eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`). Kurallar core 2.19.0 `lib/prospects.ts` (DOM-KAY-001…009, DOM-KAY-030…034, DOM-DIL-030); roller yalnız `yonetici` ve `onburo` (öteki roller 403 `forbidden`), modül `crm`.
- Aşama değişikliği `/stage` alt yolu yerine adayın kendi `PATCH`'idir: api-tasarimi.md §1 iç içe yolu yalnız sahiplikte kabul eder; durum geçişi talep ve randevuda da kaynağın `PATCH`'idir.
- Adaylar kısmi yüklenmez: tekillik (DOM-KAY-002, -031), kardeş doğrulaması, görüşme çakışması ve deneme dersi katılımcı/kapasite sayımı kurumun bütün adaylarına kurum kilidi altında bakar. Aynı adayı eşzamanlı açan iki istekten ve aynı odaya eşzamanlı iki görüşmeden yalnız biri yazılır, öteki 409 `prospect_duplicate` / `meeting_conflict` alır (test:pg).
- Not yazarının gösterilen adı oturum kullanıcısından (`users.name`) okunur; gövdede `authorName` 400 `validation_failed`. Kullanıcı satırı bulunamazsa not boş yazarla yazılmaz: programlama hatası olarak düz `Error` fırlar (500 `internal_error`, ayrıntı yalnız logda).
- Mükerrer reddi (`prospect_duplicate`, `prospect_contact_shared`) eşleşen adayın kimliğini, telefonunu, e-postasını ve adını taşımaz; yanıt yalnız kod, ileti ve alan yolu içerir, logda da kimlik yoktur.
- Log gizleme listesine `phone` (üst düzey), `guardianName`, `*.guardianName`, `notes` ve `*.notes` eklendi (kvkk: K); `test/security-defaults.test.ts` gerçek logger yapılandırmasıyla doğrular. Denetim kaydına yalnız değişen alan adları yazılır.
- OpenAPI ve `api-client` şeması yeniden üretildi. Migration yok.

## Alınabilir randevu saatleri okuma ucu

- `GET /api/v1/appointments/slots?studentId=…&from=…&to=…` (öğrenci, veli): öğrencinin sınıfına ders veren etkin öğretmenlerin gelecekteki uygunluk saatleri; her saat `slotId`, `teacherId`, `teacherName`, `startsAt`, `duration`, `campusName` (varsa), `subjectNames` ve `available` taşır (`BookableSlot`). Kural core 2.19.0 `bookableSlots` (DOM-ILT-105); `available: false` talepteki `appointment_conflict` kararıyla aynıdır, nedeni, saati tutan randevu ve kişisi ile saatin iç notu dönmez (DOM-ILT-073).
- Aralık ISO 8601; verilmezse şimdiden itibaren 14 gün, `to` yalnız `from` ile, en çok 28 gün. Aşan, ters, başlangıçsız aralık, geçersiz tarih ve bilinmeyen parametre 400 `validation_failed`.
- Başka velinin çocuğu, kapsam dışı veya olmayan öğrenci 404 `not_found` (talepteki 403 `student_scope_denied`'den farklı: okuma öğrencinin varlığını sızdırmaz); pasif öğrenci 422 `student_inactive`. Öğretmen, yönetici ve ön büro 403 `forbidden`; `communication` kapalıyken 403 `module_disabled` (mevcut modül kapısı).
- Salt okunur (`runReadOnly`): kurum kilidi alınmaz, denetim kaydı ve sürüm yazılmaz. Ders programı, etüt, etkinlik ve randevular talep ucundaki gibi bütünüyle yüklenir (`TODO(perf)`).
- OpenAPI ve `api-client` şeması yeniden üretildi. Migration yok.

## Beceri görevi tabloları ve deposu

- Migration `0013_create_skill_tasks` eklendi (ADR 0004 karar 4–7): `rubrics`, `rubric_versions`, `task_assignments`, `task_assignment_targets`, `task_attempts`, `task_submissions`, `submission_versions`, `submission_drafts`, `resubmission_requests`, `rubric_scores`, `second_rating_requests`, `score_appeals`, `score_transfers`. Bütün yabancı anahtarlar `(institution_id, …)` bileşiktir; başka kurumun satırına bağlanmak veritabanınca reddedilir. Tablolar yeni ve boştur; veri migration'ı yok.
- Değişmez satırlar (`submission_versions`, `rubric_scores`, `resubmission_requests`, `score_transfers`) `kampus_reject_immutable_change()` tetikleyicisiyle korunur: `update`, `delete` ve `truncate` 55000 ile reddedilir; yalnız imha işi `set local kampus.allow_immutable_purge = 'on'` ile siler. Kullanılmış rubrik sürümü atama ve puan yabancı anahtarlarında `on delete restrict`'tir (DOM-BEC-022).
- Not aktarımının kaynak denemesi aynı atama ve kursiyere bileşik yabancı anahtarla bağlıdır (`task_attempts_id_assignment_learner_key`). Serbest metinler core sınırlarıyla kısıtlıdır: rubrik başlığı 200, genel yorum 5000, itiraz ve karar gerekçesi 2000 karakter.
- Kurum kapsamlı depo `src/db/skills.ts` eklendi; okumalar school-core `skills/*` satır tiplerini döndürür. Eşzamanlı ikinci yazma 409 ile reddedilir: `open_rubric_version_exists`, `attempt_in_progress`, `submission_exists`, `version_conflict`, `resubmission_exists`, `rubric_score_exists`, `appeal_exists`, `score_transfer_exists`; taslağın eski revizyonla yazılması `draft_conflict` (IST-047).
- `schema/columns.ts` ortak kolon yardımcıları (`oneOf`, `keys`, `requiredColumns`) eklendi; `schema/resources.ts` bunları kullanır, şema farkı yoktur.
- Depo kısıt adına göre hata döndürür: benzersizlik 409 (`rubric_version_exists`, `published_rubric_version_exists`, `assignment_target_exists` eklendi); not aktarımı, rubrik puanı ve itirazda sahiplik uyuşmazlığı 422 (`score_transfer_source_mismatch`, `rubric_version_mismatch`, `appeal_learner_mismatch`), kaynak yoksa 404. Okumalar arşivli deneme, teslim, taslak ve itirazı dışlar.
- HTTP ucu yok; OpenAPI ve `api-client` değişmedi. Dosyalı ve sesli teslim sürümü (`TODO(F3c2-files)`) henüz saklanmaz: 422 `submission_kind_unavailable`.

## Randevu yazma uçları

- `POST /api/v1/appointments` (öğrenci, veli; uygunluk saati `slotId` seçilerek talep; 201 + `Location`; `Idempotency-Key` zorunlu, `If-Match` 400 `if_match_not_supported`) ve `PATCH /api/v1/appointments/:appointmentId` (öğretmen, öğrenci, veli; `Onaylandı`, `Reddedildi`, `İptal`, `Geri çekildi`; `If-Match` zorunlu). Kurallar core 2.18.0 `lib/appointments.ts` (DOM-ILT-100…104); modül `communication`. Yönetici ve ön büro yazamaz (403 `forbidden`).
- Talepte uygunluk saatlerinden yalnız seçilen saat yüklenir (`loadScope`); ders, etüt, etkinlik ve randevular çakışma denetimi için bütünüyle yüklenir. Kurum kilidi aynı saate eşzamanlı iki talepten yalnız birini yazar, öteki 409 `appointment_conflict` alır (test:pg).
- Durum değişikliğinde `If-Match` çalıştırıcının `expectedVersions` denetimiyle karşılaştırılır (önce kapsam ve yetki, sonra sürüm): olmayan veya kapsam dışı randevu yanlış sürümde de 404, görünür ama yetkisiz geçiş (ör. velinin öğrencinin açtığı talebi onaylaması) 403, yetkili kullanıcı 409 `version_conflict` alır. Serviste ayrı sürüm denetimi yoktur.
- Çakışan randevuyu isteği yapan göremiyorsa 409 `appointment_conflict` iletisi genel kalır ("Bu saat uygun değil.", `issues` yolu `slotId`); başka velinin gizli görüşmesi sızmaz (DOM-ILT-073, DOM-ILT-103).
- `POST /api/v1/assessment/slot-remove/:id`: bekleyen veya onaylı randevusu olan saat 409 `availability_has_appointments` (`issues` yolu `slotId`); komut randevuları da yükler (DOM-ILT-101).
- Yeni hata kodları: `appointment_teacher_only`, `appointment_requester_only`, `appointment_cancel_forbidden` (403); `appointment_conflict`, `appointment_closed` (409); `appointment_slot_unavailable`, `appointment_in_past`, `appointment_type_invalid`, `appointment_transition_invalid` (422, `issues` alan yoluyla). Red ve iptalde gerekçe yoksa 400 `validation_failed` (`reason`).
- Log gizleme listesine `note`, `*.note`, `reason`, `*.reason`, `history[*].reason` ve `*.history[*].reason` eklendi (kvkk: Ç); denetim kaydına yalnız değişen alan adları yazılır. pino `*.x` deseni yalnız ikinci düzeyi yakaladığı için üst düzey `answer`, `followUps` ve `reasonCategory` de listeye alındı. `test/security-defaults.test.ts` uygulamanın gerçek logger yapılandırmasıyla üst düzey, gövde içi ve geçmiş dizisindeki metnin loga düşmediğini doğrular.
- OpenAPI ve `api-client` şeması yeniden üretildi. Migration yok.

## Öğretmenime Sor yazma uçları

- `POST /api/v1/questions` (öğrenci; kendi sınıfının o dersine atanmış öğretmene soru; 201 + `Location`), `POST /api/v1/questions/:questionId/answers` (atanmış öğretmen; ilk yanıt `answer`/`answeredAt`, sonrakiler `followUps`, en çok 10 yanıt; 201 + `Location`), `PATCH /api/v1/questions/:questionId` (öğrenci; yalnız `{ "withdrawn": true }`, yanıtlanmamış soruyu geri çeker, kayıt silinmez; 200). Kurallar core `lib/questions.ts`'tedir (DOM-ILT-090…092); rol ve kapsam core `requireAuthorized`, modül `learning`. Yazma `runCommand` ile kurum kilidi, `audit_log` (yalnız alan adları) ve kısmi yüklemeyle (`loadScope`: soru açarken hiçbir soru, yanıt ve geri çekmede hedef soru) tek transaction'dadır.
- Soru oluşturmada `Idempotency-Key` zorunlu, `If-Match` 400 `if_match_not_supported`. Yanıt ve geri çekmede `If-Match` zorunlu (eksikse 400 `if_match_required`, tutmazsa 409 `version_conflict`); aynı sürümle eşzamanlı ikinci yanıt 409 olur ve ek yanıt açmaz (`test:pg`).
- Başka öğretmenin veya öğrencinin sorusu, başka kurumun sorusu 404 (varlık sızdırılmaz). Veli, ön büro ve yönetici soru yazamaz (403); veli soruyu yalnız okur (DOM-ILT-093).
- Yeni hata kodları: `question_scope_denied`, `question_teacher_reassigned` (403; ikincisi sınıfın dersinden alınan öğretmenin yanıtlanmış soruya ek yanıtında); `question_withdrawn`, `question_answered` (409); `question_teacher_unavailable`, `question_teacher_required`, `question_topic_unknown`, `question_files_unsupported`, `question_answer_limit` (422). Gövdede `studentId`, dosya ve bilinmeyen alan 400 `validation_failed`.
- İşlem çalıştırıcı: `If-Match` sürüm farkı artık core yetki ve kapsam denetiminden sonra bildirilir. Önceden kapsam dışı kullanıcı var olan kayda yanlış sürümle 409 `version_conflict` alıyor, olmayan kayıtta 404 alıyordu; bu fark kaydın varlığını sızdırıyordu (soru yanıtı ve geri çekmede başka öğretmen/öğrenci). Şimdi core'un 403/404 reddi önce gelir; yetkili kullanıcı yanlış sürümde yine 409 alır, core'un 422/409 hataları sürüm tutmadığında 409 `version_conflict` olur. Runner'dan geçen bütün `If-Match`'li uçlar etkilenir (talep, duyuru, iş akışı, yoklama, kampüs/öğretmen/sınıf düzenlemesi, optik/etüt); içerik havuzu ve modül ayarı zaten okunabilirlik/rol denetiminden sonra karşılaştırıyordu.
- Log `redact` listesine `*.answer` ve `*.followUps` eklendi; soru ve yanıt metni loglanmaz (DOM-ILT-014). OpenAPI ve `api-client` şeması yeniden üretildi. Migration yok.

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
