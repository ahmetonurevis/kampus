# API tasarımı

Kampüs API'si JSON üzerinden REST'tir; tek istemcisi `packages/api-client`'tır (`openapi-fetch`, tipler OpenAPI'den üretilir; kimlik için Better Auth istemcisi). Uç ekleme adımları `api-ucu` skill'inde, katman kuralları `.claude/rules/api.md`'dedir.

## 1. Yollar ve kaynaklar

- Taban: `/api/v1`. Sağlık ucu `/api/v1/health` kimliksizdir.
- Kaynak adı çoğul, kebab-case İngilizce isimdir: `/students`, `/tutoring-sessions`, `/exam-results`.
- Yol parametresi kaynağa göre adlandırılır: `/students/:studentId`. Kimlikler opaktır; istemci kimlik biçimini çözümlemez.
- İç içe yol en fazla bir düzeydir ve yalnız sahiplik varsa: `/students/:studentId/goals`. Daha derini üst düzey kaynak + filtredir: `/goal-steps?goalId=…`.
- Kurum kimliği yolda, sorguda veya gövdede **yoktur**; oturumun etkin kurumundan gelir. Kullanıcının birden çok kurumu varsa kurum Better Auth `organization.setActive` ile değiştirilir.
- **Kimlik uçları istisnadır:** `/api/v1/auth/*` Better Auth'a aittir (giriş, çıkış, parola, oturum, kurum/üyelik, davet). Bu uçların yolu ve yanıt biçimi Better Auth'undur; bu belgedeki zarf, sayfalama ve adlandırma kuralları onlara uygulanmaz. İstemci bu uçları yalnız Better Auth istemcisiyle çağırır; aynı işi yapan ikinci uç yazılmaz.

| İşlem                    | Metot ve yol                  | Başarı                  |
| ------------------------ | ----------------------------- | ----------------------- |
| Liste                    | `GET /goals`                  | 200                     |
| Tekil                    | `GET /goals/:goalId`          | 200                     |
| Oluşturma                | `POST /goals`                 | 201 + `Location`        |
| Kısmi güncelleme         | `PATCH /goals/:goalId`        | 200                     |
| Arşivleme (silme yerine) | `DELETE /goals/:goalId`       | 200 (arşivlenmiş kayıt) |
| Arşivden geri alma       | `POST /goals/:goalId/restore` | 200                     |
| Alan komutu              | `POST /goals/:goalId/approve` | 200                     |
| Toplu içe aktarma        | `POST /exam-results/imports`  | 201 veya 202            |

- CRUD'a sığmayan iş adımı fiil olarak alt yoldur (`/approve`, `/reject`, `/close`); adı kebab-case İngilizce emir kipindedir.
- Geçiş köprüsü: school-core `runWorkflow` komutları API'ye `POST /workflows/:command` ile taşınabilir. Bir modül kendi kaynak uçlarına geçince köprüdeki komutları kaldırılır.
- Kurum modül ayarı (`routes/modules.ts`, servis `services/institution-modules.ts`, DOM-YTK-040/042): `GET /modules` türde bulunan modülleri ve ayar sürümünü, `PATCH /modules/:moduleKey` (`{ enabled }`) modülü açar/kapatır; ikisi de yalnız `yonetici`. Kurum satırında (`institutions`, Better Auth tablosu) sürüm olmadığı için `If-Match` `institution_settings.version`'dır (her değişiklik bir artırır); `If-Match` ve `Idempotency-Key` zorunludur (eksikse 400 `if_match_required` / `idempotency_key_required`). Tek transaction'da kurum kilidi, sürüm denetimi (409 `version_conflict`), core `setModuleEnabled` (kurum türünde olmayan modül 422 `module_unavailable_for_type`, aynı durum 409 `module_unchanged`, bilinmeyen modül 404), `enabled_modules` + sürüm yazımı ve `audit_log` (`module.set`, `entityType: module`, `changes.fields: ['enabledModules']`) birlikte işlenir. Yanıt `{ data: { moduleKey, enabled, enabledModules, version } }`. Ayar satırı olmayan kurumda ikisi de 404. Kapatma kayıtlara dokunmaz; kapalı modülün koleksiyon ve komut uçları 403 `module_disabled`, açılınca aynen döner.
- Optik değerlendirme ve otomatik etüt köprüsü (`routes/assessment.ts`, `routes/assessment.schemas.ts`, servis `services/assessment.ts`): `POST /assessment/<komut>[/:recordId]` core `ASSESSMENT_COMMANDS`'ın yedi komutunu `runAssessment` ile tek transaction'da çalıştırır (tablo `satisfies Record<AssessmentCommand, …>`; gövde core `automationSchemas`; modül, yüklenecek koleksiyonlar ve rol/kapsam core'dandır, rota her rolü kabul eder, core reddi 403'tür). Yanıt `CommandResult`'tır. `If-Match`: `profile`, `slot-remove`, `cancel`, `attendance` kaydının sürümüdür; kimliksiz komutlarda 400 `if_match_not_supported`. **Okuyucu dosyası:** `evaluate` gövdesinde `text` (CSV/DAT/TXT metni) ve `profileId`, `profile` gövdesinde `keyCsv` metin olarak gelir; alan UTF-8 en çok 1 MB (core ile aynı), aşarsa 413 `payload_too_large` (`issues[0].path = [alan]`) ve hiçbir kayıt yazılmaz; gövde tavanı JSON kaçışları için bu iki rotada 4 MiB'dir. Çoklu parça yükleme (`@fastify/multipart`) açılmadı: dosya tarayıcıda okunur, kodlama seçimi (UTF-8/Windows-1254) istemcidedir. Dosya hataları 422 ve kararlı core kodudur; `issues[0].path` `["text", "line", <dosya satırı>]` (cevap anahtarında `"keyCsv"`) biçimindedir, satır başlıkla 1'den sayılır, satırsız hatada yalnız alan yoludur. **Önizleme:** `POST /assessment/plan/preview` (`planTutoring`) ve `POST /assessment/evaluate/preview` (`previewOptical`) aynı yükleme ve kapsam hattını çalıştırır; sonuç `after` kancasında transaction'ı geri alarak çıkarılır, bu yüzden hiçbir satır, sürüm veya denetim kaydı değişmez (test satır karşılaştırır). Plan yanıtı: `sessions` (kapasiteyle), yerleşemeyen gruplar ve nedeni (`unresolved`: öğretmen, derslik, uygunluk, kapasite ve çakışma uyarıları), `covered`, `summary` ve `expectedPlan` (planın JSON metni). Değerlendirme yanıtı soru bazında ayrıntı taşımaz (özet, kazanım başarıları, `replaces`) ve `digest` (SHA-256) verir. **Son onay yeniden hesaplar:** `plan` güncel planı çıkarır; gövdede `expectedPlan` varsa ve fark varsa hiçbir şey yazılmaz, core'un kararlı kodu 409 `tutoring_plan_stale` ve `issues` içinde fark döner (`plan_session_added`, `plan_session_removed`, `plan_session_students_changed`, `plan_unresolved_changed`; yol `current|expected, sessions, <sıra>`; ileti yalnız kazanım adı taşır). `evaluate` tam önizleme metni (soru ayrıntılı, büyük) yerine `expectedDigest` ile önizlemeye bağlanır; fark 409 `evaluation_stale`. `evaluate` ve `plan` `Idempotency-Key` ister. Etüt/uygunluk/profil/değerlendirme okuması koleksiyon köprüsündedir (`GET /collections/opticalProfiles|opticalEvaluations|tutorSessions|availability`; kapsam core `scopeFor`). Eski `POST /tutor-sessions*` uçları kaynak biçimiyle yaşar (plan/iptal/yoklama); köprü bunların komut biçimli karşılığıdır.
- Yazma uçları (`apps/api/src/routes/commands.ts`, servis `services/commands.ts`). Yanıt `{ data: CommandResult }`: işlemin konusu (`entity`), değişiklik sayıları ve yazılan kayıtların yeni `version`'ı. Konu kaydı için isteğe bağlı `If-Match` sürümü tutmazsa 409 `version_conflict`; yoklamada konu sınıf kaydıdır. Önceden var olan konusu olmayan oluşturma uçlarında (kimliksiz `POST /workflows/<komut>`, `POST /tutor-sessions`) `If-Match` 400 `if_match_not_supported` döner, sessizce yok sayılmaz. Yetkiyi kendisi denetlemeyen temel işlemlerde (ödeme, yoklama, arşiv) servis işlemden önce school-core `requireAuthorized` çalıştırır; not işlemleri yetkiyi kendi içinde denetler. Rota rol ön denetimini core `WRITE_ACTION_ROLES`'tan, modülü ve yüklenecek koleksiyonları core komut tablosundan (`modules/commands.ts`, `commandSpec`) okur; API kopya tutmaz. Velinin çevrim içi ödemesi (`invoice.payOnline`) ödeme sağlayıcısı seçilene kadar uçsuzdur (`TODO(payment-provider)`).

  | Yöntem ve yol                                                                                                                  | Rol                                                                                                                                                                                                    | Modül                                                     | Anahtar                                                  |
  | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------- |
  | `POST /workflows/<komut>[/:recordId]` (34 komut, `?childId` veli)                                                              | core `mayRun` + `scopeFor`                                                                                                                                                                             | komutun modülü                                            | `exam-import`, `renewal` zorunlu; diğerleri isteğe bağlı |
  | `POST /invoices/:invoiceId/pay`                                                                                                | core `invoice.pay`: `yonetici`, `onburo`                                                                                                                                                               | `finance`                                                 | zorunlu                                                  |
  | `POST /classes/:classId/attendance` (gövde core `attendanceInputSchema`)                                                       | core `attendance.record`: `ogretmen` dersindeki sınıfta aynı gün (`reason` isteğe bağlı); `yonetici` `reason` ile. Durumu değişen öğrencinin eski durumu `corrections` geçmişine yazılır (DOM-AKD-035) | `academic`                                                | isteğe bağlı                                             |
  | `POST /grades` (201 + `Location`)                                                                                              | core `grade.record`: atanmış sınıf + ders `ogretmen`                                                                                                                                                   | `academic`                                                | zorunlu                                                  |
  | `PATCH /grades/:gradeId` (`score`, `reason`)                                                                                   | core `grade.update`: notun verildiği sınıfın (`classId`) ders `ogretmen`i, `yonetici`                                                                                                                  | `academic`                                                | isteğe bağlı                                             |
  | `DELETE /{branches,classes,teachers}/:id?replacementId=`                                                                       | core `record.archive`: `yonetici`                                                                                                                                                                      | —                                                         | isteğe bağlı                                             |
  | `POST /{branches,classes,teachers}/:id/restore`                                                                                | core `record.restore`: `yonetici`                                                                                                                                                                      | —                                                         | isteğe bağlı                                             |
  | `POST /tutor-sessions` (plan onayı, `expectedPlan`)                                                                            | core `runAssessment` (yönetici; öğretmen kendi etüdünde)                                                                                                                                               | `tutoring`                                                | isteğe bağlı                                             |
  | `POST /tutor-sessions/:sessionId/{cancel,attendance}`                                                                          | core `runAssessment`                                                                                                                                                                                   | `tutoring`                                                | isteğe bağlı                                             |
  | `POST /assessment/<komut>[/:recordId]` (7 komut: `profile`, `evaluate`, `plan`, `slot`, `slot-remove`, `cancel`, `attendance`) | core `runAssessment`: yazma `yonetici` ve `ogretmen` (kendi kapsamı; cevap anahtarı yalnız `yonetici`, DOM-YTK-021)                                                                                    | `optical` (`profile`, `evaluate`), `tutoring` (diğerleri) | `evaluate`, `plan` zorunlu; diğerleri isteğe bağlı       |
  | `POST /assessment/{plan,evaluate}/preview` (saf, yazmaz)                                                                       | core `planTutoring`, `previewOptical`: `yonetici`, `ogretmen`                                                                                                                                          | `tutoring`, `optical`                                     | yok                                                      |

- İletişim uçları (`apps/api/src/routes/communication.ts`, servis `services/communication.ts`, core `lib/communication.ts`; docs/domain/iletisim-ve-veli.md). Yazma uçları komut uçlarıyla aynı sırayı ve `CommandResult` yanıtını kullanır; gövde şeması core işlem şemasıdır, rol ön denetimi core `WRITE_ACTION_ROLES`, kapsam işlemin içindeki core `requireAuthorized`'dadır. Modül `communication`; kapalıysa bütün uçlar 403 `module_disabled`.

  | Yöntem ve yol                                    | Rol ve kapsam                                                                                                                                                                                                        | Anahtar      |
  | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
  | `POST /announcements` (201 + `Location`)         | core `announcement.publish` (DOM-ILT-002); alıcı listesi yayında çözülür                                                                                                                                             | zorunlu      |
  | `PATCH /announcements/:id` (`If-Match`)          | yayınlayan veya `yonetici` (DOM-ILT-004); önceki içerik `revisions`'ta                                                                                                                                               | isteğe bağlı |
  | `POST /announcements/:id/withdraw` (`reason`)    | yayınlayan veya `yonetici`; kayıt silinmez, alıcı `withdrawnAt` ile "Geri çekildi" görür, metni görmez                                                                                                               | isteğe bağlı |
  | `POST /announcements/:id/read`                   | alıcı; ilk açılış anı bir kez (DOM-ILT-003)                                                                                                                                                                          | isteğe bağlı |
  | `GET /conversations`                             | taraf (`ogretmen`, `ogrenci`, `veli`): son mesaj, okunmamış sayısı; `yonetici` yalnız `?studentId` ile üst veri                                                                                                      | —            |
  | `GET /conversations/:id/messages?cursor&limit`   | taraf; `yonetici` yalnız son 30 dk'daki gerekçeli erişimle; aksi 404                                                                                                                                                 | —            |
  | `POST /conversations` (yeni 201, var olan 200)   | core `conversation.start` (DOM-ILT-010, -011); tekil: öğrenci + öğretmen + hedef kitle + veli hesabı                                                                                                                 | zorunlu      |
  | `POST /conversations/:id/messages` (201)         | taraf; ilişki bittiyse 403 `conversation_relationship_ended`; kullanıcı başına dakikada 30 (429)                                                                                                                     | zorunlu      |
  | `POST /conversations/:id/read`                   | taraf; karşı tarafın mesajlarına `readAt` (DOM-ILT-024)                                                                                                                                                              | isteğe bağlı |
  | `POST /conversations/:id/access` (`reason` ≥ 10) | `yonetici`; `audit_log` `conversation.access` + `reason`, 30 dk (DOM-YTK-052); yalnız öğrenci–öğretmen yazışması (veli yazışması 403 `conversation_access_student_only`); gerekçe yoksa 422 `access_reason_required` | —            |
  | `GET /students/:studentId/parent-accounts`       | `ogretmen` (veli yazışması açabildiği öğrenci; `startConversation` ile aynı kapsam, diğerleri 404): veli hesapları (`userId`, `name`) — `parentUserId`                                                               | —            |

  Kararlar: yazışma genel okuma köprüsüne kapalıdır; taraf olmayana ve başka kuruma 404 döner, varlık sızdırılmaz. Mesajlar yazışma kaydının `messages` dizisindedir (kayıt sınırı 256 KB, mesaj ≤ 2000 karakter; aşılırsa 422 `record_too_large`, `TODO(ADR 0004)` ayrı tablo). Mesaj dizisi değişmediği ve silinmediği için imleç mesaj kimliğidir, en yeniden geriye sayfalanır; geçersiz imleç 400. Düzenleme ve silme ucu yoktur (DOM-ILT-012). Yöneticinin erişimi State değiştirmez; işlem çalıştırıcının `after` kancasıyla denetim kaydı aynı transaction'da yazılır, okuma `audit_log`'daki kendi kaydına bakar (`audit_log_entity_idx`). Denetim kaydına mesaj metni değil alan adı (`messages`) yazılır; yöneticinin gerekçesi `audit_log.reason` kolonundadır. Mesaj hız sınırı tek bir `app.createRateLimit` örneğidir (`preHandler`, anahtar `message:<kurum>:<kullanıcı>`, dakikada 30); mesaj gönderme ve `POST /conversations` gövdesindeki `text` aynı kotayı kullanır, metinsiz başlatma saymaz. Duyuru okuması `GET /collections/announcements`'tır: core `narrowAnnouncement` alıcıya `myReadAt`, yetkiliye `readCount`/`recipientCount` verir, `reads` ve `recipients` ham dönmez.

- Okuma köprüsü: `GET /collections/:collection`, `GET /collections/:collection/counts` (toplu sayım, §3) ve `GET /collections/:collection/:id`. Ad school-core State anahtarıdır (camelCase, ör. `studentGoals`); izin listesinde olmayan veya açılmamış (`audit`, `conversations`) ad 404. Rol × koleksiyon erişimi, kayıt ve alan kapsamı school-core `scopeFor`'dan (`lib/scope.ts`), koleksiyonun modülü ve kurum türü kısıtı `COLLECTION_MODULES`'tan gelir; API aktörü oturumdaki rol ve üyelik bağlantılarından kurar, kapsam kaynağını (`SCOPE_SOURCE_COLLECTIONS`) istek başına bir kez yükler (`apps/api/src/services/read-scope.ts`). Rolün okuyamadığı koleksiyon 403, kapsam dışı kayıt 404 (varlık sızdırılmaz), kurum türünde olmayan modül 404. Arama, filtre ve sıralama ayıklanmış alanlarda çalışır. Filtre alanları ve sıralama alanları sorgu şemasında beyaz listedir. Varsayılan sıra deponun sırasıdır. Bir modül kendi kaynak uçlarına geçince köprüdeki koleksiyonları kapanır.

  | Yöntem ve yol                                                                           | Parametre                                                                | Anlam                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
  | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `GET /collections/:c`                                                                   | `page`, `pageSize` (≤ 100), `sort` (en çok üç alan), `archived`          | §3; `sort` bağlı alanları (`studentName`, `studentNumber`, `className`, `branchName`) yalnız tanımlı listede, başkasında 400                                                                                                                                                                                                                                                                                                                                   |
  | `GET /collections/:c`, `…/counts`                                                       | `q`                                                                      | Görünen alanlar ve bağlı adlar (§3 "Bağlı alanlar")                                                                                                                                                                                                                                                                                                                                                                                                            |
  | `GET /collections/:c`, `…/counts`                                                       | eşitlik süzgeçleri (`studentId`, `classId`, `status`, …; tekrarla çoklu) | `classId` kaydında sınıf olmayan öğrenci koleksiyonlarında (`invoices`, `absences`, `submissions`, `quizAttempts`, `mockResults`, `studentGoals`, `guidanceCases`, `studyTasks`, `appointments`, `requests`, `renewals`, `eventConsents`, `transportAssignments`, `clubMemberships`, `socialAchievements`, `clubAttendance`, `opticalEvaluations`, `videoProgress`) aktörün kapsamındaki öğrencinin güncel sınıfı (kapsam dışı öğrencinin sınıfı süzgeçte ve gruplamada çıkmaz, DOM-YTK-022); `grades` kaydındaki `classId` (notun verildiği sınıf), kaydında yoksa aynı öğrenci sınıfı; `contracts` (sözleşmenin sınıfı) ve `enrollmentHistory` (biten dönemin sınıfı) kendi `classId` alanıyla süzülür |
  | `GET /collections/:c`, `…/counts`                                                       | `status` (`invoices`)                                                    | Türetilmiş taksit durumu: `Ödendi`, `Gecikmiş`, `Yaklaşan` (core `invoiceStatus`, isteğin Istanbul günü); başka değer 400                                                                                                                                                                                                                                                                                                                                      |
  | `GET /collections/:c`, `…/counts`                                                       | `isActive=true\|false`                                                   | Kampüs/sınıf/kadro arşivi (`isActive: false`); alanı olmayan kayıt etkin. Sistem arşivi (`archived`) ayrıdır                                                                                                                                                                                                                                                                                                                                                   |
  | `GET /collections/:c`, `…/counts`                                                       | `dateFrom`, `dateTo` (`YYYY-MM-DD`, dahil), `dateField`                  | `dateField` alanının Europe/Istanbul günü (§3 "Tarih aralığı"); gün veya an (ISO UTC) değerli kayıtlar eşlenir                                                                                                                                                                                                                                                                                                                                                 |
  | `GET /collections/:c/counts`                                                            | `groupBy` (zorunlu; `<tarih alanı>:month` aylık), `sum`                  | Grup başına sayı ve toplam (§3 "Toplu sayım"); ayıklanan alan 400                                                                                                                                                                                                                                                                                                                                                                                              |
  | `GET /collections/:c/:id`                                                               | `archived=include`                                                       | Arşivlenmiş kayıt; verilmezse 404                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | Kimliksiz `POST /workflows/<komut>`, `POST /tutor-sessions`, `POST /assessment/<komut>` | `If-Match` başlığı gönderilmez                                           | 400 `if_match_not_supported` (§6)                                                                                                                                                                                                                                                                                                                                                                                                                              |

- `PUT` kullanılmaz; güncelleme `PATCH` ile gönderilen alanları değiştirir. `null` alanı temizler, gönderilmeyen alan dokunulmadan kalır.
- Kalıcı silme API'de yoktur; yalnız KVKK silme süreciyle yapılır (bkz. [guvenlik-kvkk.md](guvenlik-kvkk.md#10-saklama-ve-silme)).

## 2. Yanıt zarfı

Başarılı yanıt her zaman `data` taşır; liste ek olarak `meta` taşır:

```json
{
  "data": {
    "id": "goal-s1-math",
    "status": "active",
    "version": 4,
    "updatedAt": "2026-10-06T10:00:00.000Z"
  }
}
```

```json
{
  "data": [{ "id": "goal-s1-math" }],
  "meta": { "page": 2, "pageSize": 25, "total": 61 }
}
```

- Alan adları camelCase. Her kayıt `id`, `version`, `createdAt`, `updatedAt`, `archivedAt` (yoksa `null`) taşır.
- Zaman damgasının tek kaynağı kayıt kolonlarıdır (`records.created_at`/`updated_at`/`archived_at`): koleksiyon yanıtında üst düzey `createdAt`, `updatedAt`, `archivedAt` ve `version` kolondan gelir, school-core kaydı `record` alanındadır. Core kayıtlarının kendi `createdAt`/`updatedAt` alanları (örnek veride geçmişe tarihli olabilir) `record` içinde iş alanı olarak kalır; sunucu onları sistem zamanı saymaz, `sort=createdAt` kolona göre sıralar.
- Yanıt şeması zorunludur; yanıtta olmayan alanın istemciye gitmesi mümkün değildir (iç not, parola özeti, başka rolün alanı).
- `TODO(api-record-schemas)`: koleksiyon yanıtındaki `record` bugün serbest nesnedir (`Record<string, unknown>`); istemci tipi core `State`'ten alır. Core koleksiyon başına Zod şeması verince (`C2-record-schemas`) yanıt şeması koleksiyona göre ayrımlı olur: köprüde koleksiyon başına şema (`oneOf`, ayırıcı koleksiyon adı), kaynak uçlarına geçişte kaynağa özgü şema. Ayıklanabilen alanlar şemada isteğe bağlıdır (core `Redacted<T>`); şemada olmayan alan istemciye gitmez, böylece yanıt şeması alan kapsamının ikinci savunma hattı olur.

## 3. Sayfalama, filtre ve sıralama

Varsayılan sayfa numaralı sayfalamadır (arayüz sayfa numarası ve toplam gösterir):

- `page` (1'den başlar, varsayılan 1), `pageSize` (varsayılan 25, en fazla 100). Sınır dışı değer 400.
- `meta.total` filtre uygulanmış toplamdır. İstemci `page > ceil(total / pageSize)` durumunda son geçerli sayfaya döner.

İmleçli sayfalama yalnız sürekli büyüyen akışlarda (mesajlar, bildirimler, denetim kaydı) kullanılır:

- `cursor` (opak, `meta.nextCursor`'dan), `limit` (varsayılan 50, en fazla 100). `meta.nextCursor: null` son sayfadır. Toplam dönmez.

Filtre:

- Alan adıyla eşitlik: `?classId=c1&status=active`. Çoklu değer parametre tekrarıyla: `?status=active&status=pending_approval`.
- Serbest arama `q` (en az 2 karakter; Türkçe büyük/küçük harf ve aksan duyarsız).
- Aralık `…From` / `…To`, iki uç dahil: `?dueDateFrom=2026-10-01&dueDateTo=2026-10-31`.
- Arşivli kayıtlar varsayılan olarak dönmez; `?archived=include` veya `?archived=only`.
- Her ucun kabul ettiği filtre ve sıralama alanları sorgu şemasında beyaz listedir; bilinmeyen parametre 400.

Doluluk süzgeçleri: `cancelled=true|false` yalnız `schedule`ta (`cancelledAt` doğruluk değeri; core `!lesson.cancelledAt`), `graded=true|false` yalnız `submissions`ta (`score` boş olmaması; core `score == null`, `0` puandır). Verilmezse ikisi de birlikte döner; başka koleksiyonda veya `true`/`false` dışı değerde 400. Liste ve sayımda aynıdır, kapsam ve ayıklama sonrasında da kesindir (`STATE_FILTERS`).

Tarih aralığı: `dateFrom`/`dateTo` bir tarih alanının Europe/Istanbul gününe uygulanır; alan `dateField` ile seçilir. Alan koleksiyon başına izin listesindedir (`DATE_FIELDS`, `collection-reads.ts`) ve listenin ilki varsayılandır; listede olmayan koleksiyonda tek alan `date`'tir (eski davranış). İzin dışı alan 400 `validation_failed` (`issues[0].path` `dateField`), aralık verilmese de. Örnekler: `invoices` `dueDate` (varsayılan) ve `paidAt` (ödenmemiş taksit eşleşmez), `homework`/`studyTasks` `dueDate`/`createdAt`, `studentGoals` `deadline`/`reviewedAt`/`createdAt`, `students` `joinedAt`, `submissions` `submittedAt`. Gün sınırı verilen günün Istanbul gün başlangıcıdır (`istanbulDayStart`; yaz saati kayması dahil), bitiş ertesi günün başlangıcından küçüktür; `ctx.now` aralığa girmez (yalnız türetilmiş `status` onu kullanır). Alanın kayıttaki değeri `YYYY-MM-DD` ya da `toISOString` biçimli an değilse kayıt eşleşmez. Süzgeç liste, sayım ve SQL ön süzgecinde aynıdır; ayıklanmış alan süzülemez (sonuç boş).

Türetilmiş alanlar saklanmaz, istekte hesaplanır ve süzgeç, sıralama ve gruplamada saklanan alan gibi kullanılır. Taksitin (`invoices`) `status`'u core `invoiceStatus` ile `paidAt`, vade ve isteğin saatinden (`ctx.now`, Europe/Istanbul günü) türetilir; değerler core etiketleridir (`Ödendi`, `Gecikmiş`, `Yaklaşan`), başka değer 400. SQL koşulu core kuralının çevirisidir (gün ve an biçimli vadede kesin, başka biçimde aday); karar core fonksiyonuyla verilir ve iki tarafın eşitliği sınır günleriyle testte sabittir.

Bağlı alanlar: liste ve sayım uçlarında `q`, kaydın kimlik alanından bağlı kaydın adında da arar; liste bu adlarla sıralar (`sort=studentName`). Genel ama dar bir beyaz listedir (`apps/api/src/services/collection-joins.ts`): öğrenciye bağlı koleksiyonlarda (`invoices`, `grades`, `attendance`, `submissions`, `quizAttempts`, `contracts`, `studentGoals` …) `studentName`, `studentNumber`, `className` (kayıtta sınıf yoksa öğrencinin güncel sınıfı); sınıfa bağlılarda (`assignments`, `quizzes`, `homework`, `announcements`, `schedule`, `students`) `className`; kampüse bağlılarda (`classes`, `teachers`, `prospects`, `clubs`, `mealMenus` …) `branchName`. Tek düzeydir, yalnız ad/numara alanı okunur; bağlı alan tanımlı olmayan listede sıralama 400. Bağlı kayıt aktörün okuyabildiği (`access` + `canRead`), arşivlenmemiş ve ayıklanmış kayıttır; kimlik ana kaydın ayıklanmış biçiminden okunur. Aktörün okuyamadığı bağlı kaydın adı eşleşme üretmez ve sıralamada boş değerdir (sonda): öğretmen başka kampüsteki sınıfını görür ama o kampüsün adıyla bulamaz; veli bağlı olmadığı öğrencinin adıyla taksit bulamaz. Yanıt: liste ve tek kayıt satırı `joined: { studentName?, studentNumber?, className?, branchName? }` taşır (yalnız bağlı alanı tanımlı koleksiyonlarda). `studentNumber` (okul numarası, `students.number`) öğrenci kaydı aktörün core kapsamında (`canRead`) ve numara ayıklanmamışsa gelir: yönetici ve ön büro her öğrencinin, öğretmen kapsamındaki, öğrenci kendi, veli çocuğunun numarasını görür; numarası saklanmamış öğrencide ve kapsam dışında alan yanıta girmez. Kural core'dadır (`READ_RULES`, `HIDDEN_FIELDS`); API ayrıca kural yazmaz. Adlar yalnız sayfadaki kimliklerden birincil anahtarla yüklenir; bağlı kayıt aktörün kapsamından, arşivlenmemiş ve ayıklanmış kayıttır, kimlik ayıklanmış kayıttan okunur. Kapsam dışı, arşivli veya başka kurumun kaydının adı dönmez (alan eksik kalır).

Okuma yolu (`apps/api/src/services/collection-reads.ts`). SQL yalnız aday satırları daraltır. Kapsam ve son karar core'undur: her satır `canRead`'den geçer, süzgeç ve arama ayıklanmış kayıtta yeniden denetlenir.

- Sayfa: süzgeçsiz, aramasız ve sıralamasız listede koleksiyonun tamamını okuyan rol (yönetici, ön büro; `readsWholeCollection`, `TODO(core-full-scope)`) sayfayı ve toplamı SQL'den alır (`limit/offset`, `count()`). Sayfada `canRead`'den geçmeyen satır çıkarsa loglanır ve bellek yoluna dönülür.
- Kapsam ön süzgeci: büyük kişisel koleksiyonlarda SQL yalnız satırın `studentId`/`classId` anahtarı aktörün kapsamındaki satırları getirir (`scopePrefilter`). Ön süzgeç gerekli koşuldur, core `canRead`'in görünür saydığı hiçbir satırı dışlamaz; kural core'dan daraltılmaz. Öğretmenin notunda anahtarlardan biri yeter (`studentId` güncel öğrencisi ya da `classId` notun verildiği sınıf): sınıf değiştiren öğrencinin eski notu, verildiği sınıfın öğretmeninin listesinde kalır (core `gradeReader`, DOM-AKD-054).
- Arama: `q` yazdırılabilir ASCII ise (`"` ve `\` yok) her rolde SQL aday süzgeci kullanılır (`SearchMatch`, `db/records.ts`). Rolün ayıklanan alanları çıkarılmış JSON metni NFD, ASCII küçük harf (`collate "C"`), `ı`→`i` ve ASCII dışı karakter silme ile katlanır. Bu katlama bellekteki `searchKey` eşleşmesinin üst kümesidir. Bunun yanında üstel yazılan sayılar ve bağlı adı eşleşen kimlikler de adaydır; kimlik sayısı en fazla 1000'dir, aşılırsa arama bellekte yapılır. Üst küme özelliği Türkçe harf, aksan, işaret, JSON kaçışı ve üstel sayıyla testte sabittir. Diğer `q` değerleri yalnız bellekte aranır. Bağlı adın arama biçimi değer başına bir kez hesaplanır.
- Ölçüm (PG16, örnek kurumun tam verisi, `grades` 11.760 kayıt, 7 tekrarın medyanı, makine yükü 40–50; önce `5e99f82` → sonra): yönetici süzgeçsiz liste 58–154 ms → 21–25 ms. Yönetici `q=matematik` 258–587 ms → 167–191 ms; bağlı adla `q=deniz` ve `q=2026011` ~260–310 ms → 165–201 ms. Öğretmen (1.920 not) ~60 ms ve veli ~20 ms değişmedi (ölçüm gürültüsü içinde). Yüksek yükte (~120–180) öğretmen `q` 150–200 ms → 95–125 ms ölçüldü.
- Bu boyutta kazancın çoğu arama anahtarı önbelleğindendir: SQL katlaması 11.760 satırda ~170 ms sürer (`normalize` ~60 ms). Türkçe harfli `q=yılmaz` (yalnız bellek) ile ASCII `q=deniz` aynı süreyi verir. Daha hızlısı kalıcı katlanmış arama kolonu ve trigram indeksi ister (`TODO(perf)`, migration).

Toplu sayım: `GET /collections/:collection/counts?groupBy=<alan>[&sum=<alan>]` liste ucunun kapsam, süzgeç ve aramasını (`q`, `archived`, `isActive`, `dateFrom`/`dateTo`, eşitlik süzgeçleri) aynen uygular; sayfalama ve sıralama almaz. Yanıt `{ data: [{ value, count, sum? }], meta: { total, sum? } }`; gruplar değere göre sıralı, `null` (alan yok veya skaler değil) sonda. Kararlar:

- `groupBy` zorunlu ve beyaz listedir (eşitlik süzgeci alanları, `isActive`, `level`); `sum` beyaz listeli sayısal alandır (`amount` kuruş, `capacity`, `score`, `progress`, `attendanceRate`, `homeworkRate`), sayı olmayan değer toplama girmez. Ortalama istemcide `sum / count`'tur.
- Aylık gruplama: `groupBy=<tarih alanı>:month` (ör. `paidAt:month`, `dueDate:month`) kaydı tarih alanının Europe/Istanbul ayına koyar; grup değeri `YYYY-MM`'dir (gün biçimli değer kendi ayı, an Istanbul gününün ayı). Tarih alanı koleksiyonun `dateField` izin listesindedir, dışı 400; ayıklanan alanla gruplama 400. `YYYY-MM-DD`/`toISOString` biçimi olmayan veya eksik değer `null` grubudur (sonda). Kapsam, süzgeç, arama ve `sum` diğer gruplamalarla aynıdır; sayım ayıklanmış kayıt üzerinde yapılır.
- Sayım ayıklanmış kayıt üzerinde yapılır: kapsam dışı kayıt sayılmaz, toplama girmez. Rolün göremediği (ayıklanan) alanla gruplama veya toplama 400 `validation_failed`'dir (`issues[0].path` `groupBy`/`sum`); boş sonuç dönmez, çünkü boş sonuç alanın varlığını sızdırmadan "veri yok" ile karışır.
- Değer süzgeçle aynı anlamdadır: `isActive` alanı olmayan kayıt `true`; taksit `status`'u türetilmiş; kaydında sınıf olmayan öğrenci koleksiyonlarında `classId` kapsamdaki öğrencinin güncel sınıfı (kapsam dışı öğrenci `null`), notta önce kaydın `classId`'si.
- İlişki zinciri sunucuda kurulmaz: kampüs başına öğrenci, sınıf başına öğrenci sayımı ile sınıfın kampüsünden istemcide birleşir. Sayım bellekte yapılır (liste ucuyla aynı aday yükleme ve SQL arama süzgeci; `TODO(perf)`).

Sıralama: `sort=-createdAt,lastName` (eksi azalan). Sonuç her zaman `id` ile kararlı hale getirilir; aynı sorgu aynı sırayı verir.

Dışa aktarma: liste ucu `Accept: text/csv` ile çağrılınca sayfalamayı yok sayar, aynı filtre ve sıralamayla bütün sonucu akış olarak (stream) döner. Hücre `=`, `+`, `-`, `@` ile başlıyorsa başına `'` eklenir (CSV enjeksiyonu). Kişisel veri dışa aktarımı denetim kaydına yazılır.

## 4. Hata zarfı

Bütün hata yanıtları aynı şekildedir:

```json
{
  "code": "validation_failed",
  "message": "Formda düzeltilmesi gereken alanlar var.",
  "issues": [
    { "path": ["targetNet"], "code": "too_small", "message": "Hedef net en az 1 olmalıdır." },
    { "path": ["deadline"], "code": "invalid_date", "message": "Geçerli bir tarih seçin." }
  ],
  "requestId": "req-7f3a2c"
}
```

- `code`: kararlı, İngilizce, snake_case. İstemci mantığı yalnız `code`'a bakar; `message` değişebilir.
- `message`: Türkçe, kullanıcıya gösterilebilir, teknik ayrıntı içermez.
- `issues`: yalnız alan hatalarında; `path` gövdedeki alan yolu, `message` Türkçe alan mesajı.
- `requestId`: log ile eşleştirme için her hata yanıtında; ayrıca `X-Request-Id` başlığında.
- 5xx yanıtında `message` her zaman "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin." olur; ayrıntı yalnız logdadır.

## 5. HTTP durum kodları

| Durum | `code` örnekleri                                                                                      | Ne zaman                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 200   | —                                                                                                     | Okuma, güncelleme, komut, arşivleme                                                                             |
| 201   | —                                                                                                     | Oluşturma (`Location` başlığıyla)                                                                               |
| 202   | —                                                                                                     | Uzun süren içe aktarma kuyruğa alındı (`/imports/:importId` ile izlenir)                                        |
| 204   | —                                                                                                     | Gövdesiz başarı (çıkış)                                                                                         |
| 400   | `validation_failed`, `invalid_query`, `idempotency_key_required`, `if_match_not_supported`            | Şema/biçim hatası                                                                                               |
| 401   | `unauthenticated`                                                                                     | Oturum yok, geçersiz, iptal edilmiş veya süresi dolmuş                                                          |
| 403   | `forbidden`, `module_disabled`, `no_active_institution`, `reauthentication_required`, `csrf_rejected` | Rol/kapsam yetmiyor; modül kapalı; etkin kurum yok; hassas işlem için taze oturum gerekli; kaynak denetimi      |
| 404   | `not_found`                                                                                           | Yok **veya başka kuruma ait** (varlığı sızdırılmaz)                                                             |
| 409   | `version_conflict`, `conflict`, `duplicate`, `idempotency_in_progress`                                | Sürüm çakışması, kilitlenme/serileştirme (yeniden denenebilir), benzersizlik ihlali, aynı anahtarla süren istek |
| 413   | `payload_too_large`                                                                                   | Gövde sınırı (varsayılan 1 MB)                                                                                  |
| 415   | `unsupported_media_type`                                                                              | Beklenmeyen `Content-Type`                                                                                      |
| 422   | iş kuralı kodu (`goal_already_open`), `idempotency_key_reused`                                        | Biçim doğru, iş kuralı reddetti (`DomainError` kind `rule`)                                                     |
| 426   | `client_upgrade_required`                                                                             | Mobil sürümü artık desteklenmiyor                                                                               |
| 429   | `rate_limited`                                                                                        | Hız sınırı (`Retry-After` başlığıyla)                                                                           |
| 500   | `internal_error`                                                                                      | Beklenmeyen hata                                                                                                |
| 503   | `unavailable`                                                                                         | Bakım veya bağımlılık (veritabanı) erişilemez                                                                   |

400 ile 422 ayrımı: Zod şemasını geçemeyen istek 400; şemayı geçip school-core kuralına takılan istek 422.

Modül denetimi: modüle bağlı rota `app.requireModule('<anahtar>')` ön işleyicisini bildirir (anahtar istekten de çözülebilir, ör. koleksiyon adından). Anahtarlar school-core modül kaydındandır (`modules/collection-modules.ts`); kurum türünde bulunmayan modül (dil okulunda `optical`, `tutoring`, `guidance`, `exams`, `goals`, `renewal`) saklanan değere bakılmadan kapalıdır ve uçları 404 döner (DOM-YTK-012); türde bulunup kurumda saklanmayan modül açıktır, yalnız `false` olan kapalıdır. Aynı etkin harita `/me` `enabledModules`'ta, okuma kapsamında ve core işlemlerine verilen State'te kullanılır (`effectiveModules`). İş akışı köprüsünde komutun modülü `routes/workflows.schemas.ts` `WORKFLOW_MODULES`'tandır (test core ile aynı olduğunu doğrular); yazma ve okuma aynı kodu döner. Sıra: 401 → 404 (bilinmeyen kaynak veya kurum türünde olmayan modül) → 403 `module_disabled` → 403 `forbidden` (rol/kapsam) → 404 (kayıt). Kapalı modülün okuma uçları da kapanır (DOM-YTK-040).

## 6. Eşzamanlılık

- Güncelleme ve komut gövdesi okunan kaydın `version` değerini taşır. Sunucu yazarken `WHERE version = $beklenen` uygular; eşleşmezse 409 `version_conflict`. İstemci kaydı yeniden yükler ve kullanıcıya "Kayıt başka biri tarafından değiştirildi." gösterir. Veritabanı kilitlenme (40P01) veya serileştirme (40001) nedeniyle transaction'ı geri alırsa 409 `conflict` döner: hiçbir kayıt değişmemiştir, aynı istek yeniden denenebilir.
- Komut uçlarında okunan sürüm `If-Match` başlığıyla gelir (`"4"`, `W/"4"`). Konusu olmayan oluşturma uçları başlığı kabul etmez: 400 `if_match_not_supported` (gövde doğrulamasından önce).
- Başarılı yazma yeni `version`'ı döndürür.

## 7. Idempotency anahtarı

Zorunlu uçlar: ödeme/tahsilat kaydı, iade, taksit planı oluşturma, sözleşme oluşturma, toplu içe aktarma, toplu mesaj/bildirim gönderimi. Diğer `POST` uçlarında isteğe bağlıdır.

- OpenAPI'de zorunlu uçların başlığı `required: true`'dur (üretilen istemci tipi başlığı ister); çalışma zamanında şema başlığı isteğe bağlı tutar ki eksik anahtar Zod `validation_failed` yerine 400 `idempotency_key_required` dönsün. Belge dönüşümü işaretli başlığı zorunlu yapar (`requireMarkedHeaders`, `routes/commands.schemas.ts`).
- İstemci `Idempotency-Key: <UUID>` başlığı gönderir. Anahtar kullanıcı eylemi başına bir kez üretilir; ağ hatasında **aynı anahtarla** yeniden denenir (mobilde anahtar taslakla birlikte saklanır).
- Sunucu `idempotency_keys` tablosunda `(institution_id, user_id, key)` ile istek özetini (metot + yol + gövde SHA-256) ve yanıtı tutar; kayıt iş işlemiyle **aynı transaction'da** yazılır.

| Durum                                  | Yanıt                                                   |
| -------------------------------------- | ------------------------------------------------------- |
| Anahtar yok (zorunlu uçta)             | 400 `idempotency_key_required`                          |
| Yeni anahtar                           | İşlem yapılır, yanıt saklanır                           |
| Aynı anahtar + aynı gövde, tamamlanmış | Saklanan yanıt aynen döner, `Idempotent-Replayed: true` |
| Aynı anahtar + aynı gövde, sürüyor     | 409 `idempotency_in_progress`                           |
| Aynı anahtar + farklı gövde            | 422 `idempotency_key_reused`                            |

- Anahtarlar 24 saat saklanır, sonra temizlenir. Doğrulama hatası (4xx) saklanmaz; aynı anahtarla düzeltilmiş istek gönderilebilir.
- Uygulama: `runCommand` (`apps/api/src/services/operation-runner.ts`) anahtar başına danışma kilidini `try` ile alır (alınamazsa 409 `idempotency_in_progress`), sonra kurum kilidini alır, saklanan yanıtı arar, işlemi çalıştırır ve yanıtı aynı transaction'da yazar. Yalnız 2xx yanıt saklanır; özet kanonik gövdedendir (anahtar sırası önemsizdir). Süresi dolan satır sorguda yok sayılır ve silinir: yanıt saklanırken aynı kurumun süresi dolmuş bütün anahtarları aynı transaction'da silinir, sunucu açılışında bütün kurumlar `purgeExpiredIdempotencyKeys` ile temizlenir (günlük `pg-boss` işi gelene kadar, `TODO(jobs)`).
- Anahtar iş kuralının yerini almaz: aynı taksitin iki kez ödenmesi school-core'da ayrıca engellenir.

## 8. Sürümleme

- Ana sürüm yoldadır (`/api/v1`). Geriye uyumlu değişiklik (yeni uç, yeni isteğe bağlı alan, yeni yanıt alanı, yeni hata kodu) sürüm artırmaz; istemci bilinmeyen alanı yok sayar.
- Kırıcı değişiklik (alan silme/yeniden adlandırma, tip değişimi, zorunlu yeni alan, anlam değişikliği) önce yeni alanla birlikte eskiyi sunar; kaldırılamıyorsa `/api/v2` açılır.
- Eski ana sürüm, desteklenen en eski mobil sürüm onu kullandığı sürece açık kalır. Kaldırılacak uç `Deprecation` ve `Sunset` başlıklarını taşır.
- Mobil her istekte `X-Client-Version: 1.4.0` gönderir; desteklenmeyen sürüme 426 `client_upgrade_required` döner ve uygulama güncelleme ekranı gösterir.

## 9. Tarih, saat ve para

| Tür          | Biçim                                                                   | Örnek                                      |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------ |
| An (instant) | ISO 8601 UTC, milisaniyeli, `Z` ile; ad `…At`                           | `"approvedAt": "2026-10-06T10:00:00.000Z"` |
| Takvim günü  | `YYYY-MM-DD`, Europe/Istanbul günü; ad `…Date`                          | `"dueDate": "2026-11-15"`                  |
| Günün saati  | `HH:mm`, Europe/Istanbul                                                | `"startTime": "09:40"`                     |
| Süre         | tamsayı dakika; ad `…Minutes`                                           | `"durationMinutes": 40`                    |
| Para         | tamsayı kuruş + kayıt düzeyinde `currency` (ISO 4217, varsayılan `TRY`) | `"amount": 123456, "currency": "TRY"`      |
| Oran/yüzde   | tamsayı yüzde veya iki ondalıklı sayı, şemada belirtilir                | `"percent": 45`                            |

- Sunucu biçimlendirilmiş metin (`"1.234,56 ₺"`, `"6 Eki"`) döndürmez; biçimleme istemcide school-core `format` ile `tr-TR` ve Europe/Istanbul'dadır.
- Para hiçbir katmanda kayan noktalı sayı olmaz; taksit bölme kuruş üzerinde yapılır (`installmentAmounts`).

## 10. Başlıklar ve gövde

- İstek ve yanıt `application/json; charset=utf-8`; dosya yükleme `multipart/form-data`.
- Gövde sınırı 1 MB; dosya yükleme ucu kendi sınırını şemada bildirir.
- `X-Request-Id` her yanıtta döner; istemci gönderirse (UUID biçimindeyse) korunur.
- Önbellek: kişisel veri içeren yanıtlar `Cache-Control: no-store`.

## 11. OpenAPI ve istemci üretimi

Zincir: Zod şeması → OpenAPI belgesi → `openapi-typescript` tipleri → `openapi-fetch` çağrısı. Hiçbir halkada elle tip veya elle istemci fonksiyonu yazılmaz.

- Girdi şeması (gövde) school-core'daki işlem şemasıdır (`workflowSchemas.goal` gibi); web ve mobil form aynı şemayı `zodResolver` ile kullanır. Yanıt ve sorgu şemaları `apps/api/src/routes/<alan>.schemas.ts`'tedir. Hata zarfı tek ortak şemadır (`ErrorResponse`) ve her rotanın 4xx/5xx yanıtında yer alır.
- Rotalar `fastify-type-provider-zod` (Zod 4 destekli sürüm) ile şema alır; `@fastify/swagger` OpenAPI 3.1 belgesini üretir. `@fastify/swagger-ui` yalnız geliştirmede açıktır; belge geliştirme ve testte `GET /api/v1/openapi.json` ile sunulur, üretimde kapalıdır.
- Her şema `.describe('…')` ile Türkçe açıklama ve gerektiğinde örnek taşır; para alanlarının açıklaması "kuruş" birimini belirtir. Her rota `operationId` (camelCase, ör. `approveGoal`) ve `tags` (alan adı) taşır.
- `apps/api/openapi.json` commit edilir. `packages/api-client/src/schema.d.ts` bu belgeden `openapi-typescript` ile üretilir ve commit edilir; elle düzenlenmez.
- Uç değişikliği, `openapi.json` ve `schema.d.ts` aynı committedir. `pnpm --filter @kampus/api openapi:check` ve `pnpm --filter @kampus/api-client generate:check` ikisini yeniden üretip farkı kontrol eder; fark varsa CI kırılır. Böylece sözleşme değişikliği incelemede görünür.
- Kırıcı sözleşme değişikliği `schema.d.ts` farkında tip hatası olarak web ve mobilde görünür; `pnpm typecheck` geçmeden birleştirilmez.
- Better Auth uçları bu belgeye eklenmez; tipleri Better Auth istemcisinden gelir.
