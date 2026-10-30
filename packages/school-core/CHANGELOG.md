# Değişiklikler

## 2.1.0

- **Kırıcı:** tahsilat kaydı (`invoice.pay`, taksiti "ödendi" işaretler) yalnız `yonetici` ve `onburo` rollerindedir; veli `permission_denied` alır (DOM-FIN-052). Velinin bağlı çocuğu için çevrim içi ödemesi ayrı `invoice.payOnline` eylemidir (`finance` modülü); ödeme sağlayıcısı onayı gerektirir (`PROVIDER_CONFIRMATION_ACTIONS`, `requiresProviderConfirmation`) ve sağlayıcı seçilene kadar hiçbir işlem çağırmaz (`TODO(payment-provider)`). API henüz `authorize` kullanmadığı için sürüm küçük düzeyde artar.
- `lib/authorize.ts` eklendi: temel yazma işlemlerinin yetkisi tek tabloda (`WRITE_ACTIONS`, `WRITE_ACTION_ROLES`, `WriteTargets`). `authorize(actor, action, target, source, { institutionType, now })` önce modül (DOM-YTK-040), sonra rol (matris, DOM-YTK-001), sonra kapsam denetler; `requireAuthorized` reddi `DomainError` olarak fırlatır (`forbidden` 403, `rule` 422, `not_found` 404), `sessionAuthorize` çevrimdışı demo oturumunu kullanır. Eylemler: `invoice.pay`, `invoice.payOnline`, `attendance.record` (öğretmen ders verdiği sınıfta aynı gün; yönetici yalnız gerekçeyle, `correction_reason_required`), `grade.record`, `grade.update`, `record.archive`, `record.restore` (yalnız yönetici). İşlemler (`payInvoice`, `recordAttendance`, `archiveRecord`) yetkiyi kendileri denetlemez.
- `lib/grades.ts` eklendi: resmî not girişi ve düzeltmesi. `recordGrade(state, actor, input, makeId, now, { institutionType })` ve `updateGrade(state, actor, gradeId, input, now, opts)` yetkiyi kendi içinde denetler; girdi şemaları `gradeRecordSchema`/`gradeUpdateSchema` API gövde şeması olarak kullanılır. Değerlendirme türü alanı `assessmentType`'tır (`GRADE_TYPES`, `GRADE_TYPE_LABELS`; mobil `OperationRecord.kind` ile çakışmasın diye `kind` değil). Düzeltme gerekçesi `GradeCorrection` olarak saklanır (DOM-AKD-004, DOM-AKD-051).
- `modules/commands.ts` eklendi: komut → modül ve komut → koleksiyon tabloları (`WORKFLOW_COMMANDS`, `ASSESSMENT_COMMANDS`, `OPERATION_COMMANDS`; `module`, `collections`, `scalars`), `commandSpec(runner, name)` ve `is*Command` korumaları. API işlemden önce açık olması gereken modülü ve yükleyeceği koleksiyonları buradan okur; `audit` listede yoktur. `runWorkflow` ve `authorize` modülü bu tablodan alır (`WRITE_ACTION_MODULES` kaldırıldı).
- Saate bağlı işlemler `now` parametresi alır: `recordAttendance(…, now)`, `workflowForm(…, overrides, now)`, `workflowRows(…, page, now)`, `saveClass(…, recordId, now)`, `homeworkStatus(…, studentId, now)`. Varsayılan gerçek saattir; davranış değişmez.
- Tipler: `lib/audit.ts` (`JsonValue`, `AuditValue`, `toAuditValue`, `AuditEntry` kayıt alanları isteğe bağlı, core işlemlerinin yazdığı `RecordAuditEntry`; `school-workflows.ts` yeniden dışa verir). State: `questions`/`submissions`/`materials` `fileUri`, `submissions.note`, `appointments.duration`, `schedule.subject`, `absences` web ve telefon biçimi (`status`/`date`/`createdAt` isteğe bağlı), `grades` not alanları. `documentData<T>` tür → dönüş tipi verir (`DocumentDataMap`, `DocumentData`); `runWorkflow` sabit komutta komutun sonucunu (`WorkflowResult<C>`), dize komutta birleşimi döndürür.
- Tüketiciler `workspace:2.1.0` sürümüne sabitlendi.

## 2.0.0

- **Kırıcı:** core kaynakları TypeScript'e taşındı; dosyalar `.ts` uzantılıdır ve tüketiciler `@kampus/school-core/lib/x.ts` biçiminde içe aktarır. `.js` yolları kalktı.
- **Kırıcı:** iş kuralı reddi düz `Error` yerine `DomainError`'dır (`code`, `kind`, `path`); mesaj metinleri aynıdır, hatayı türüne veya koduna göre ayıran tüketici güncellenmelidir.
- **Kırıcı:** kapsam API'si: `workflowScope` ve `automationScope` `lib/scope.ts` üzerinden hesaplanır; `Session` `links` alabilir, `automationScope(...).teacher` yalnız öğretmen rolünde dolu, `classIds` yönetici ve ön büroda kurumun bütün sınıflarıdır. Kayıt okuyan yeni kod `scopeFor`/`visibleRecords` kullanır.
- **Kırıcı:** rehberlik görünürlüğü: iç not yalnız rehberlik görevli öğretmene döner; yönetici görmez ve görüşme notu yazamaz, ön büro rehberlik dosyasını okumaz. Öğretmen kaydı `guidanceCounselor` alanı taşır.
- Davranış: rehberlik iç notları (`internalNote`, `notes`) yalnız rehberlik görevli öğretmene döner (DOM-ILT-040, DOM-YTK-026). Görev öğretmen kaydındaki yeni `guidanceCounselor` alanıdır (örnek veride `t1`; yeni öğretmen görevsiz başlar). Yönetici paylaşılan planı görür, iç notu görmez (gerekçeli erişim ayrı ister, IST-020); ön büro rehberlik dosyasını okumaz; görevsiz öğretmen, öğrenci ve veli iç notu görmez. Görevli öğretmen kurumun bütün dosyalarını okur. `guidance-note` yalnız görevli öğretmene açıktır (yönetici `permission_denied`, görevsiz öğretmen `guidance_counselor_only`); dosya açarken iç not yalnız görevli öğretmende yazılır ve form alanı yalnız ona gösterilir. Core denetim kaydı rehberlikte iç not değerlerini yazmaz, değişen alanların adını `masked_fields` ile yazar (DOM-ILT-041).
- `lib/scope.ts` eklendi: kişiye göre kayıt kapsamı. `Actor = { role, links }` API üyelik bağlantılarıyla aynı biçimdedir (`student`, `child`, `teacher`). `scopeFor(source, actor, { institutionType })` indeksleri bir kez kurar; `access`, `canRead`, `read` (süzme + alan ayıklama), `redact`, `hiddenFields` tek kural tablosundan çalışır (DOM-YTK-001, -002, -021…-025). `requireReadable` reddi `DomainError` olarak verir (`collection_not_found` 404, `module_disabled`/`permission_denied` 403). Bilinmeyen koleksiyon veya rol boş döner. `visibleRecords` ve `redactRecord` State üzerinde kısa yoldur.
- `Session` isteğe bağlı `links` alır; `workflowScope`, `automationScope`, iş akışı işlemleri ve sunum katmanı sabit `t1`/`s1`/`p1` yerine oturumun aktörünü kullanır (`sessionActor`, `sessionTeacherId`). Çevrimdışı demo bağlantısız oturumu bugünkü demo kimliklerine eşler; görünür davranış değişmez. Pasif öğretmen kaydı iş akışı ekranlarında da kapsam vermez; `workflowScope` ayrıca `teacher` ve `scope` döndürür, `classIds` yönetici ve ön büroda kurumun bütün sınıflarıdır.
- `modules/collection-modules.ts` eklendi: her State koleksiyonu tek modüle bağlıdır veya açıkça `ALWAYS_ON`'dur (`COLLECTION_MODULES`); modüllerin açılabildiği kurum türleri `MODULE_INSTITUTION_TYPES` içindedir (DOM-YTK-012: deneme, optik, etüt, hedef, rehberlik ve kayıt yenileme yalnız `school`). `collectionStatus` koleksiyonun kurumdaki durumunu (`unknown`, `unavailable`, `disabled`, `enabled`) verir; haritada olmayan modül kapalı sayılır.
- `lib/errors.ts` eklendi: iş kuralı reddi için `DomainError` (`code`, Türkçe `message`, `kind`: `rule` | `conflict` | `forbidden` | `not_found`, isteğe bağlı `path`). Core'daki 201 iş kuralı `throw new Error('…')` çağrısı mesaj metni değişmeden `DomainError`'a çevrildi; API `kind` değerini HTTP durumuna eşler (422, 409, 403, 404). İç tutarsızlık niteliğindeki `TypeError`/`Error` çağrıları ve demo kalıcılığı hataları düz kalır.
- Düzeltme: `mayRun` ve `runWorkflow`, komut adı `toString`, `constructor` veya `__proto__` gibi yerleşik özellik olduğunda TypeError fırlatıyor ya da yanıltıcı "modül kapalı" hatası veriyordu; komut tabloları `Object.hasOwn` ile aranır, bilinmeyen komut `unknown_command` (`rule`) olur.
- Düzeltme: `workflowCreateActions` optik değerlendirme ve otomatik etüt sayfalarında TypeError fırlatıyordu; eylem tablosunda karşılığı olmayan modül boş liste döner.
- Davranış: mükerrer ödeme `invoice_already_paid` (`conflict`), olmayan ödeme kaydı `invoice_not_found` (`not_found`) olarak döner; API'de sırasıyla 409 ve 404 olur.

## 1.3.0

- Hedef & gelişim planı modülü (`goals`) eklendi: ders veya genel net hedefi, deneme sonuçlarından hesaplanan ilerleme, onay akışı, zayıf konulardan haftalık adım önerisi ve veli yorumları. Veri `studentGoals` koleksiyonundadır; snapshot sürümü ve eski kayıtlar korunur.
- `modules/full-navigation.js` eklendi: temel menü ile okul iş akışı modüllerini birleştirir; web ve mobil aynı menüyü kullanır. Web'in `modules/navigation.js` dosyası bunu yeniden dışa aktarır.
- `lib/text-decoding.js` eklendi: UTF-8 ve Windows-1254 çözücü, tüm platformlarda aynı sonucu verir.
- `saveTeacher` isteğe bağlı `now` parametresi aldı; varsayılan davranış değişmedi. Tüketiciler `workspace:1.3.0` sürümüne sabitlendi. Mobil artık iş akışı modüllerini menüsünde gösterir.

## 1.2.0

- Web için CSV ve ayarlanabilir sabit alanlı DAT/TXT optik değerlendirme eklendi. Kitapçık/soru/kazanım anahtarı, iptal/boş/çoklu cevap, tekil öğrenci eşleme ve atomik sonuç güncellemesi desteklenir.
- Eksik kazanımlara göre uygunluk saatleri, derslik kapasitesi ve ders/randevu/etkinlik rezervasyonlarını denetleyen etüt planlama; yoklama ve iptal geçmişi eklendi. Öğrenci/veli kapsamı daraltılır; program ve dashboard etütleri gösterir.
- Manuel sonuç değişikliği veya cevap anahtarı revizyonu eski optik analizi geçersiz kılar. Snapshot sürümü ve eski kayıtlar korunur. Yeni web modülleri mobil menülere eklenmez; tüketiciler `workspace:1.2.0` sürümüne sabitlendi.

## 1.1.0

- Web paneli için rehberlik, deneme sınavları, kayıt yenileme/dönem geçişi, program yönetimi, çalışma planı, okul takvimi/veli onayı, servis, yemek ve kulüp iş akışları eklendi. İşlem doğrulaması, rol kapsamı ve form tanımları paylaşılır.
- Kayıt yenileme yeni sözleşmenin taksitlerini ayırır; geçmiş sözleşmelerin toplamı korunur. Program iptalleri günlük görünümden çıkarılır.
- Snapshot sürümü 3 korunur; eski modül tercihleri bozulmadan yeni modüller varsayılan olarak açılır. Tüketiciler `workspace:1.1.0` sürümüne sabitlendi.

## 1.0.2

- Yoklama işlemi mazeretli (`excused`) durumunu destekler; geçersiz tarihleri kaydetmeden reddeder. Mobil ve web aynı durum etiketini kullanır. Kayıt şeması ve mevcut yoklamalar korunur.

## 1.0.1

Web ve Android'in Türkçe tarih/para biçimleyicileri tekrar kullanılır. Büyük listelerde satır başına Intl kurulum maliyeti kaldırıldı; İstanbul saat dilimi ve para çıktıları korunur. Kayıt biçimi değişmedi.

## 1.0.0

Web ve Android için ortak özel okul verisi, kayıt/finans/yoklama/puanlama kuralları, modül menüleri ve belge verisi.
