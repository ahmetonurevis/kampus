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
- Yazma uçları (`apps/api/src/routes/commands.ts`, servis `services/commands.ts`). Yanıt `{ data: CommandResult }`: işlemin konusu (`entity`), değişiklik sayıları ve yazılan kayıtların yeni `version`'ı. Konu kaydı için isteğe bağlı `If-Match` sürümü tutmazsa 409 `version_conflict`; yoklamada konu sınıf kaydıdır. Önceden var olan konusu olmayan oluşturma uçlarında (kimliksiz `POST /workflows/<komut>`, `POST /tutor-sessions`) `If-Match` 400 `if_match_not_supported` döner, sessizce yok sayılmaz. Core'un rol denetlemediği işlemlerde (ödeme, yoklama, arşiv) uç en dar varsayılanı uygular; core bu kuralları verince rol oradan okunur.

  | Yöntem ve yol                                                     | Rol                                                      | Modül          | Anahtar                                                  |
  | ----------------------------------------------------------------- | -------------------------------------------------------- | -------------- | -------------------------------------------------------- |
  | `POST /workflows/<komut>[/:recordId]` (34 komut, `?childId` veli) | core `mayRun` + `scopeFor`                               | komutun modülü | `exam-import`, `renewal` zorunlu; diğerleri isteğe bağlı |
  | `POST /invoices/:invoiceId/pay`                                   | `yonetici`, `onburo`                                     | `finance`      | zorunlu                                                  |
  | `POST /classes/:classId/attendance`                               | `yonetici`; `ogretmen` core kapsamındaki sınıfta         | `academic`     | isteğe bağlı                                             |
  | `DELETE /{branches,classes,teachers}/:id?replacementId=`          | `yonetici`                                               | —              | isteğe bağlı                                             |
  | `POST /{branches,classes,teachers}/:id/restore`                   | `yonetici`                                               | —              | isteğe bağlı                                             |
  | `POST /tutor-sessions` (plan onayı, `expectedPlan`)               | core `runAssessment` (yönetici; öğretmen kendi etüdünde) | `tutoring`     | isteğe bağlı                                             |
  | `POST /tutor-sessions/:sessionId/{cancel,attendance}`             | core `runAssessment`                                     | `tutoring`     | isteğe bağlı                                             |

- Okuma köprüsü: `GET /collections/:collection` ve `GET /collections/:collection/:id`. Ad school-core State anahtarıdır (camelCase, ör. `studentGoals`); izin listesinde olmayan veya açılmamış (`audit`, `conversations`) ad 404. Rol × koleksiyon erişimi, kayıt ve alan kapsamı school-core `scopeFor`'dan (`lib/scope.ts`), koleksiyonun modülü ve kurum türü kısıtı `COLLECTION_MODULES`'tan gelir; API aktörü oturumdaki rol ve üyelik bağlantılarından kurar, kapsam kaynağını (`SCOPE_SOURCE_COLLECTIONS`) istek başına bir kez yükler (`apps/api/src/services/read-scope.ts`). Rolün okuyamadığı koleksiyon 403, kapsam dışı kayıt 404 (varlık sızdırılmaz), kurum türünde olmayan modül 404. Arama, filtre ve sıralama ayıklanmış alanlarda çalışır. Filtre alanları ve sıralama alanları sorgu şemasında beyaz listedir. Varsayılan sıra deponun sırasıdır. Bir modül kendi kaynak uçlarına geçince köprüdeki koleksiyonları kapanır.
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
- Uygulama: `runCommand` (`apps/api/src/services/operation-runner.ts`) anahtar başına danışma kilidini `try` ile alır (alınamazsa 409 `idempotency_in_progress`), sonra kurum kilidini alır, saklanan yanıtı arar, işlemi çalıştırır ve yanıtı aynı transaction'da yazar. Yalnız 2xx yanıt saklanır; özet kanonik gövdedendir (anahtar sırası önemsizdir). Süresi dolan satır sorguda yok sayılır ve `purgeExpiredIdempotencyKeys` ile silinir.
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
