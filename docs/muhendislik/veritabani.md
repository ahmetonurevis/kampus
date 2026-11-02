# Veritabanı kuralları

PostgreSQL 16, Drizzle ORM, drizzle-kit migration'ları. Şema `apps/api/src/db/schema/`, migration'lar `apps/api/drizzle/` altındadır. Testler aynı migration'larla PGlite'ta koşar ([test-stratejisi.md](test-stratejisi.md#4-pglite-kullanımı)).

## 1. Adlandırma

- Tablo ve kolon adları snake_case, İngilizce. Tablo çoğul: `institutions`, `membership_links`, `audit_log` (kayıt defteri tekil kalır).
- Birincil anahtar `id`; yabancı anahtar `<tekil_tablo>_id`: `institution_id`, `user_id`.
- Zaman kolonları `…_at` (`timestamptz`), takvim günü `…_date` (`date`), boolean `is_…`/`has_…`.
- Kısıt ve indeks adları: `<tablo>_<kolonlar>_idx`, benzersiz `…_key`, yabancı anahtar `…_fkey`, denetim `…_check`.
- Drizzle'da TypeScript alanları camelCase, kolon adı açıkça snake_case verilir (`institutionId: text('institution_id')`) veya `casing: 'snake_case'` ile; iki yöntem karıştırılmaz.

## 2. Zorunlu kolonlar

Kuruma ait her tablo:

| Kolon            | Tip                                     | Kural                                         |
| ---------------- | --------------------------------------- | --------------------------------------------- |
| `institution_id` | `text not null references institutions` | Birincil anahtarın ve her indeksin ilk kolonu |
| `created_at`     | `timestamptz not null default now()`    | Bir kez yazılır                               |
| `updated_at`     | `timestamptz not null default now()`    | Her yazmada uygulama tarafından güncellenir   |
| `archived_at`    | `timestamptz null`                      | Dolu ise kayıt arşivdedir                     |
| `version`        | `integer not null default 1`            | Her yazmada +1; iyimser kilit                 |

İstisnalar (açıkça sınırlı liste): Better Auth tabloları (aşağıda), yalnız eklenen tablolar `audit_log` ve `idempotency_keys` (`archived_at` ve `version` yok), `pg-boss`'un kendi şeması. Yeni istisna bu listeye eklenmeden açılmaz.

### Kimlik tabloları (Better Auth)

ADR 0002 gereği kimlik ve kiracı çekirdeği Better Auth'undur; ADR 0001'deki `users`, `memberships`, `refresh_tokens` tabloları yazılmaz.

- Şema `pnpm --filter @kampus/api auth:schema` (Better Auth CLI `auth` paketi, Drizzle bağdaştırıcısı; sürüm `better-auth` paketiyle aynı ve sabit) ile `src/db/schema/auth.ts`'e üretilir, sonra drizzle-kit ile migration'a dönüştürülür. Üretilen dosya elle düzenlenmez; Better Auth sürümü veya eklentisi değişince komut yeniden koşulur ve fark ayrı migration olur.
- Adlar mümkün olduğunca bizim kuralımıza eşlenir: Drizzle bağdaştırıcısında `usePlural: true`, kolonlar snake_case; `organization` modeli `institutions`, `member` modeli `memberships` adını `modelName` ile alır. Eşlenemeyen ad veya kolon bu bölüme istisna olarak yazılır. Mevcut istisnalar (CLI desteklemiyor): zaman kolonları saat dilimsiz `timestamp` (bağlantı oturumu UTC'ye sabitlenir), indeks adları camelCase (`sessions_userId_idx`), benzersizlik `<tablo>_<kolon>_unique`, `memberships.role` serbest metin (rol sunucuda `roleSchema` ile doğrulanır). Kurum + kullanıcı başına tek üyelik ayrı migration'daki `memberships_institution_id_user_id_key` indeksiyle güvencededir.
- Better Auth tablolarına (`users`, `sessions`, `accounts`, `verifications`, `institutions`, `memberships`, `invitations`) `version` ve `archived_at` eklenmez; yaşam döngüleri Better Auth API'siyle yönetilir, doğrudan `update`/`delete` yazılmaz.
- Kurumun ek alanları (`type`: `school`/`language_school`, açık modüller `enabled_modules`) `organization` eklentisinin `additionalFields`'ı ile; sık değişen veya büyüyen ayarlar 1:1 `institution_settings` tablosunda (zorunlu kolonlarla). Bugün orada `academic_year` var: core `academicYear`, eğitim-öğretim yılının başlangıç yılı; core'da "dönem" bu yıldır.
- Üyeliğin school-core bağlantısı (öğrenci kimliği, veliye bağlı çocuklar, öğretmen kimliği) `membership_links` tablosundadır: `(institution_id, membership_id, kind, record_id)`, `kind in ('student', 'child', 'teacher')`. Kapsam fonksiyonları bu tablodan beslenir.
- Kimlik kolonu `text`'tir (Better Auth kimlikleri); bizim tablolarımızdaki `institution_id` ve `user_id` aynı tiptedir.

### `pg-boss`

`pg-boss` kendi şemasını (`pgboss`) kuyruk açılışında kendisi kurar ve yükseltir (`migrate`, `createSchema` varsayılan); bu şema drizzle-kit migration'larına girmez ve uygulama kodu ona doğrudan sorgu yazmaz. Gerekçe (OG-094): şemanın SQL'i pg-boss sürümüne bağlıdır ve paket kendi sürüm tablosuyla yükseltir; drizzle-kit bu şemayı üretemez, elle kopyalanmış SQL her pg-boss güncellemesinde ikinci bir migration ve sürüm uyuşmazlığı riski olurdu. Yükseltme danışma kilidiyle yapıldığından birden çok örnek aynı anda açılsa da tek kez çalışır. Sonuçları: uygulama rolünün veritabanında şema açma yetkisi olmalıdır (yerel `kampus` sahiptir; üretim rolü ayrılırsa şema önceden açılıp role verilir), pg-boss sürüm yükseltmesi ayrı commit'tir ve `test:pg` takımı (`test/pg-jobs.test.ts`) şema kurulumunu sınar. Kuyruk açılamazsa (şema yetkisi yok, bağlantı hatası) API düşmez, kuyruksuz açılır ve hata `code`/`message` ile loglanır (`bootJobs`). API testleri (PGlite) kuyruk açmaz; işleyiciler doğrudan çağrılır. Ayrıntı: [api-tasarimi.md §12](api-tasarimi.md#12-iş-kuyruğu).

Tip kuralları:

- Para: `bigint` kuruş (`bigint('amount', { mode: 'number' })`) + `currency char(3) not null default 'TRY'`. `numeric`/`real` para için kullanılmaz.
- Metin: `text`; uzunluk sınırı Zod'dadır, gerekiyorsa `check (char_length(x) <= n)`.
- Durum alanları: PostgreSQL `enum` tipi yerine `text` + `check (status in (…))` (değer eklemek basit migration olur).
- Kimlik: `records` ve mevcut kayıtlar `text` kimlik (seed kimlikleri korunur); yeni normalleştirilmiş tablolar uygulamada üretilen `uuid`.
- Zaman dilimi: her zaman `timestamptz`; `timestamp without time zone` yok.

## 3. `records` tablosu

```sql
create table records (
  institution_id text not null references institutions (id),
  collection     text not null,
  id             text not null,
  data           jsonb not null,
  position       bigint not null,   -- core dizisindeki sıra (seyrek tamsayı)
  version        integer not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz,
  primary key (institution_id, collection, id),
  constraint records_data_size_check check (pg_column_size(data) <= 262144)
);
```

Kurallar:

- `collection` school-core state anahtarıdır, aynen yazılır (`students`, `studentGoals`). Yeni koleksiyon önce school-core'da tanımlanır; API bilinmeyen koleksiyonu reddeder.
- `data` yazılmadan önce school-core Zod şemasıyla doğrulanır. `data` içinde `institutionId`, `version`, `createdAt`, `updatedAt`, `archivedAt` tutulmaz; bunlar kolondur ve okurken kayda eklenir. Geçiş notu: core kayıtları bugün kendi `createdAt`/`updatedAt` alanlarını taşır ve işlem çalıştırıcısı bunları olduğu gibi yazar; sistem zamanı yalnız kolondur, API yanıtında kolon değerleri üst düzeyde, core kaydı `record` içinde döner (api-tasarimi.md §2).
- Kayıt bütün olarak değiştirilir; rota veya serviste `jsonb_set` ile parça güncelleme yapılmaz.
- Yazma sürüm kontrollüdür; etkilenen satır 0 ise 409:

```sql
update records
   set data = $1, version = version + 1, updated_at = now()
 where institution_id = $2 and collection = $3 and id = $4 and version = $5
```

- Bir işlemin değiştirdiği bütün kayıtlar tek transaction'da yazılır; biri çakışırsa hepsi geri alınır. Yazmalar verilen sırayla değil `(collection, id)` sırasıyla yapılır; aynı satırları farklı sırada değiştiren iki transaction kilitlenmez. Yine de oluşan kilitlenme (40P01) veya serileştirme hatası (40001) 409 `conflict` olur (yeniden denenebilir, `mapDatabaseError`).
- Koleksiyonlar arası bütünlük (yabancı anahtar) jsonb'de veritabanınca sağlanmaz; school-core sağlar. Bütünlüğün veritabanı garantisi gerekiyorsa koleksiyon normalleştirilir.
- Hesaplanabilen değer (`goalProgress`, quiz puanı, rubrik toplamı) `data`'ya yazılmaz.
- Dosya ve medya `data`'ya gömülmez (base64 yok); depolama arayüzünde tutulur, kayıt yalnız anahtar ve meta veri taşır. Belge başına sınır 256 KB. Uygulama yazmadan önce JSON metin boyutunu denetler; jsonb'nin ikili boyutu metinden büyük olabildiği için (ör. çok sayıda küçük sayı) `records_data_size_check` yine de reddedebilir. Bu ihlal (23514, bu kısıt) de 422 `record_too_large`'a çevrilir (`mapDatabaseError`).
- Geçiş notu: bazı eski kayıtlarda `deletedAt`/`isActive` alanları var. API'ye taşımada arşiv durumu `archived_at` kolonuna aktarılır; jsonb'deki eski alanlar school-core uyumu bitene kadar okunur, yenisi yazılmaz.
- Kayıt anahtarı `data.id`'dir; kimliksiz `videoProgress` için `<studentId>:<videoId>` (`apps/api/src/db/collections.ts`). Kurum satırı silinince kayıtlar kendiliğinden silinmez (cascade yok).
- Sıra: core dizinin sırasına dayanır (başa ekleme, ilk N kayıt), bu yüzden kayıt `position` kolonuyla core dizisinin sırasında yüklenir (`order by position, id`). Değerler 1024 adımlı seyrek tamsayıdır (`apps/api/src/db/positions.ts`): çalıştırıcı işlem sonrası dizide saklanan değerlerin en uzun artan alt dizisini yerinde bırakır; yeni veya yer değiştiren kayıt komşularından türetilen değeri alır (başa ekleme en küçükten bir adım küçük, sona ekleme en büyükten bir adım büyük, araya ekleme aradaki değer). Ara kalmazsa yalnız o koleksiyon baştan numaralanır. Yalnız sırası değişen kayıt `move` yazmasıyla güncellenir (veri aynı kaldığından `version` artmaz); her işlemde bütün satırlar yeniden yazılmaz. Mevcut satırlar `0004_add_records_position` ile kimlik sırasında (önceki yükleme sırası) numaralandı; core sırası SQL'de bilinemediği için tohumu yeniden çalıştırmak tohum kayıtlarını yalnız sıra değeriyle core sırasına getirir.
- Kurum kilidi: işlem çalıştırıcı transaction'ı yüklemeden önce `pg_advisory_xact_lock(<ad alanı>, hashtext(institution_id))` ile açar (`lockInstitution`). READ COMMITTED altında kilitsiz iki işlem aynı görüntüyü yükleyip farklı yeni kimlikle ekleyebilir (aynı gün iki yoklama, son boş yere iki kayıt, aynı saate iki etüt); sürüm denetimi yalnız var olan satırı korur. Kurum içi işlemler böylece sıraya girer; kurum başına tek kilit olduğundan kilit sıralaması sorunu yoktur. İki anahtarlı biçim, tek anahtarlı kilit kullanan `pg-boss`'la çakışmaz. Doğrulaması `test:pg` takımındadır (`test/pg-concurrency.test.ts`). Yalnız okuyan saf önizleme (`runReadOnly`: etüt planı ve optik değerlendirme önizlemesi) kilit almaz; `REPEATABLE READ READ ONLY` transaction'da tek görüntüden okur, böylece büyük önizlemeler yazmaları sıraya sokmaz (`test/pg-assessment.test.ts`).
- Depo `apps/api/src/db/records.ts`, işlem çalıştırıcı `apps/api/src/services/operation-runner.ts`: koleksiyonları yükler, core işlemini `now` ile çalıştırır, farkı (ekleme, değişiklik, listeden çıkarma) tek transaction'da yazar. Core'un listeden çıkardığı kayıt `archived_at` ile arşivlenir ve çalıştırıcıya bir daha yüklenmez; core'un kendi `deletedAt`/`isActive` alanları uyum bitene kadar `data`'da kalır (pasif öğretmen/öğrenci core kurallarınca görülmeye devam eder). Dizi olmayan State alanları `records`'ta tutulmaz, çağıran kurum ayarından verir: `modules` `institutions.enabled_modules`'tan (saklanmayan modül açık), `academicYear` `institution_settings.academic_year`'dan. Core işlemi bunlardan birini değiştirirse değişiklik yazılamayacağı için sessizce düşürülmez: işlem geri alınır, 500 `internal_error` döner ve `operation.scalar_changed` olayı yalnız alan adlarıyla (`modules.transport`; değer yok) `error` düzeyinde loglanır. Kurum ayarı değiştiren işlem kendi ayar servisinden geçer.
- Yükleme kapsamı (`loadScope`): çalıştırıcı varsayılan olarak koleksiyonu bütünüyle yükler. Büyüyen koleksiyonda servis koleksiyon başına kimlik listesi ya da depo süzgeci verir. Fark yalnız yüklenen kayıtlar üzerinden hesaplanır: yüklenmeyen kayıt arşivlenmez, yeni kayıt sona eklenir, yüklenmemiş canlı kimlikle ekleme 409'dur (api-tasarimi.md §6). Yazışma mesajları (`conversationMessages`, ADR 0005) böyle yüklenir: gönderim hedef yazışmayı yükler, mesaj yüklemez. Kısmi süzgeç ifade indeksinden yararlanacaksa kesin eşitlik (`kind: 'equals'`) kullanır; `FieldMatch`'in dizi adaylığı (`or jsonb_typeof = 'array'`) indeksi devre dışı bırakır. Sona ekleme sırası koleksiyon başına `max(position)` ile `records_institution_collection_position_idx` üzerinde tek adımda bulunur.

## 4. Normalleştirme ölçütü

Tahsilat bu ölçütle `payments`, `payment_allocations` ve `payment_settings` tablolarındadır (ADR 0006, migration `0016_create_payments`); ücret tarifesi `fee_tariffs`'te (migration `0017_create_fee_tariffs`), öğrenci kimliği `student_identities`'te (migration `0018_add_enrollment_terms`, `0020_relax_identity_year`), ayrılış ve iade `student_withdrawals`'tadır (migration `0019_create_student_withdrawals`); taksit ve sözleşme şimdilik `records`'tadır.

Bir koleksiyon aşağıdakilerden **biri** doğrulanınca kendi tablosuna taşınır (her biri ayrı ADR):

1. Bir kurumda 20.000 kaydı geçer veya bir yılda geçmesi beklenir (yoklama, not, ödeme, mesaj bu sınıftadır).
2. Doğruluk veritabanı kısıtı gerektirir: benzersizlik (aynı taksitin tek ödemesi), yabancı anahtar, `check`.
3. SQL'de toplama/raporlama gerekir (finans özeti, devamsızlık oranı) ve uygulamada hesaplamak bütçeyi aşar.
4. Bir işlem için koleksiyonu yüklemek p95'te 50 ms'yi veya 5 MB'ı aşar.
5. Veri özel nitelikli veya ayrı erişim/saklama kuralı ister (sağlık, rehberlik iç notları).

Taşıma tek migration'la yapılır: tablo oluşturulur, `records`'tan veri kopyalanır, eski satırlar silinir; school-core'a aynı state şeklini veren bir depo bağdaştırıcısı yazılır. Öncesi ve sonrası için aynı servis testleri geçmelidir.

### İçerik havuzu tabloları (ADR 0004 karar 3)

İçerik havuzu `records`'ta değil, baştan ilişkisel tablodadır (migration `0011_create_content_pool`; şema `apps/api/src/db/schema/resources.ts`, depo `apps/api/src/db/resources.ts`). Kural school-core `content/*`'tadır; tablolar onun satırlarıdır.

- `resources`: kimlik, tür, sahip, paylaşım kapsamı, güncel yayın sürümü (`current_version_id`) ve kopya soyu (`derived_from_version_id`; platform sürümü için yabancı anahtarsız `derived_from_platform_version_id`, `TODO(F3b-library)`).
- `resource_versions`: durum kolonları, başlık, tür başına içerik (`content` jsonb; yalnız `removed` durumunda boş, `resource_versions_content_check`), ayrı `answer_key`, `license` jsonb ve ondan türetilen `license_kind` (generated), kaynak gösterimi, süzülen etiket kolonları (sözlük kolonları `check` ile core sabitlerine bağlı; `license_kind` dahil, migration `0012_add_content_tag_checks`) ve `search_vector` (core `searchDocument` çıktısının `to_tsvector('simple', …)`'ı; SQL'de ikinci normalleştirme yok). Sürüm numarası kaynakta tekildir; kaynakta en fazla bir düzenlenen (taslak/reddedildi) sürüm vardır (`resource_versions_editable_key`, inceleme hariç: telif bildirimi yayındaki sürümü incelemeye alırken açık taslak olabilir).
- `resource_version_outcomes` (kazanım bağlantıları, sıra `position`), `resource_version_items` (quiz/alıştırma sorularının sürüm kimlikleri ve puanları), `resource_shares` (`target_kind` `student`/`class`; kimlikler `records` kayıtlarıdır, yabancı anahtar yok).
- Her yabancı anahtar `(institution_id, …_id)` bileşiktir: başka kurumun satırına bağlanmak veritabanınca imkânsızdır. `resources` ↔ `resource_versions` anahtarları döngüseldir; kaynak önce güncel sürümsüz yazılır, sürümden sonra bağlanır (`insertResourceWithVersions`). Drizzle tip çıkarımı için iki tablonun ekstra yapılandırması açık dönüş tipi (`PgTableExtraConfigValue[]`) taşır.
- Sürümde `archived_at` core `archivedAt`'tır (durum `archived`): arşivlenen sürüm geçmiş görevlerde ve sürüm geçmişinde okunmaya devam eder (DOM-KYN-032, 051), bu yüzden sürüm sorguları arşivliyi varsayılan olarak dışlamaz, görünürlüğü `status` belirler. Liste ise kural gereği (`DOM-KYN-051`: arşivlenen kaynak aramaya girmez) baş sürümü `archived` veya `removed` olan kaynağı varsayılan olarak dışlar; bunlar yalnız açık `status` süzgeciyle gelir. Bağlantı tabloları (kazanım, soru, paylaşım) değişince silinmez: etkin satırlar arşivlenir, yeni küme `on conflict` ile geri açılır (`apps/api/src/db/resource-writes.ts`).
- Kaynak satırındaki `resources.archived_at` bütün sürümler arşivlenince ve kaldırmada dolar, yeni sürüm açılınca boşalır. Kaldırmada sürümlerin içeriği ve cevap anahtarı boşalır, `search_vector` yalnız başlıktan yeniden üretilir.
- Yayımlanmış sürümün içerik, etiket ve lisans kolonları değişmez; tetikleyici yoktur, servis reddeder. Sürüm yazımı `where version = beklenen` koşuludur (0 satır → 409); eşzamanlı ikinci açık sürüm `resource_versions_editable_key` 23505'iyle 409 `open_version_exists` olur.

### Beceri görevi tabloları (ADR 0004 karar 4–7)

Migration `0013_create_skill_tasks`; şema `apps/api/src/db/schema/skills.ts`, depo `apps/api/src/db/skills.ts`. Kural school-core `skills/*`'tadır; tablolar onun satırlarıdır, hesaplanan değer (puan, toplam, geç bayrağı) saklanmaz. Ortak kolon yardımcıları (`oneOf`, `keys`, `requiredColumns`) `schema/columns.ts`'tedir.

- `rubrics`, `rubric_versions` (kriter × bant jsonb; rubrikte tek açık taslak `rubric_versions_draft_key`, tek yayındaki sürüm `rubric_versions_published_key`). Kullanılmış sürüm atama ve puan yabancı anahtarlarında `on delete restrict`'tir; silme 23001 (`restrict_violation`) döner (DOM-BEC-022).
- `task_assignments` sabitlenmiş ayarlar (içerik, puanlama ve rubrik sürümü, deneme, süre, dinleme, teslim ayarı jsonb; `check`'ler core kurallarıyla sınırlı), `task_assignment_targets` (`class`/`group`/`student`; `records` kimlikleri, yabancı anahtar yok).
- `task_attempts` (kursiyerin atamasında deneme numarası tekil), `task_submissions` (kursiyer × atama başına tek; DOM-BEC-040), `submission_versions` (değişmez gönderim), `submission_drafts` (kursiyer × atama başına bir satır; satır `version`'ı core `revision`'dır).
- `resubmission_requests` (teslim sürümüne bileşik FK; FK `submission_versions_submission_number_key` benzersiz **kısıtına** bağlanır, çünkü drizzle-kit yabancı anahtarları indekslerden önce oluşturur), `rubric_scores` (`first`/`second` sürüm başına bir, `final` birden çok), `second_rating_requests` (teslim başına bir, `source` `sample`/`manual`), `score_appeals` (sürüm başına bir), `score_transfers` (görev × kursiyer başına tek; kaynak deneme XOR rubrik puanı; DOM-BEC-060).
- **Sahiplik tutarlılığı.** Kaynak deneme aynı atamanın ve kursiyerin denemesidir: `score_transfers_source_attempt_fkey` `(institution_id, source_attempt_id, assignment_id, learner_id)` → `task_attempts` bileşik yabancı anahtarıdır ve birincil anahtarı genişleten `task_attempts_id_assignment_learner_key` benzersiz kısıtına bağlanır (indeks `score_transfers_source_attempt_idx` aynı dört kolonla başlar). Satırda atama ve kursiyer kolonu olmayan üç bağ depo yazma fonksiyonunda, aynı transaction'da denetlenir ve 422 döner: rubrik puanı kaynağının teslimi aynı atama ve kursiyerindir (`insertScoreTransfer`, `score_transfer_source_mismatch`), rubrik puanının rubrik sürümü atamanın sabitlenmiş sürümüdür (`insertRubricScore`, `rubric_version_mismatch`), itirazın kursiyeri teslimin kursiyeridir (`insertAppeal`, `appeal_learner_mismatch`). Kaynak satırlar değişmez veya `on delete restrict` olduğundan ekleme anındaki denetim kalıcıdır. Deneme kaynağının yabancı anahtar ihlali (23503) de aynı 422 koduna çevrilir.
- **Serbest metin sınırları** core şemalarıyla aynıdır: `rubric_versions.title` ≤ 200, `rubric_scores.overall_comment` ≤ 5000, `score_appeals.reason` ve `decision_reason` ≤ 2000, teslim ve taslak metni ≤ 50.000. Teslim türü (`submission_kind`) `check` değerleri core `submissionSettingsSchema` seçeneklerinden türetilir; puanlama kipi için core sabiti yoktur (`TODO(core-scoring-modes)`).
- **Değişmez satır tetikleyicisi.** `submission_versions`, `rubric_scores`, `resubmission_requests` ve `score_transfers` satırları bir kez yazılır. Ortak `kampus_reject_immutable_change()` fonksiyonu `<tablo>_immutable_trigger` (`before update or delete`, satır düzeyi) ve `<tablo>_truncate_trigger` (`before truncate`) tetikleyicilerinden çağrılır ve 55000 (`object_not_in_prerequisite_state`) ile reddeder; ileti teknik ve İngilizcedir, kullanıcıya gitmez (beklenmeyen hata, 500). Bir kolon kısıtı yalnız `version`/`updated_at`'e bakabildiğinden `set score = 100` veya `delete` gibi yazmaları durduramazdı; uygulama yerelde ve testte tablo sahibi rolle bağlandığı için `revoke` de korumaz. Tetikleyici rolden bağımsız çalışır. `<tablo>_version_check` (`version = 1 and archived_at is null`) yalnız eklenen satırı sınırlar. Tetikleyici ve fonksiyon 0013'ün sonuna elle yazılmıştır: Drizzle şeması ve snapshot onları izlemez, `drizzle-kit check` temizdir; migration testi `pg_trigger`'da varlıklarını ve türlerini doğrular. Depo bu tablolar için güncelleme ve silme fonksiyonu sunmaz. Silme atlatması yalnız imha işi içindir (§7).
- Benzersizlik ihlali (eşzamanlı ikinci yazma) depoda kısıt adına göre 409'a çevrilir (`constraintAs`): `open_rubric_version_exists`, `rubric_version_exists` (sürüm numarası), `published_rubric_version_exists`, `assignment_target_exists`, `attempt_in_progress`, `submission_exists`, `version_conflict`, `resubmission_exists`, `rubric_score_exists`, `appeal_exists`, `score_transfer_exists`. Eşlenmemiş kısıt ihlali beklenmeyen hatadır (500). Taslak iyimser kilidi tutmazsa 409 `draft_conflict`; eşzamanlı iki pencere `test:pg`'de (`pg-skill-drafts.test.ts`) sınanır.
- Okumalar (`loadAttempts`, `loadSubmission`, `loadDraft`, `loadAppeals`, `loadResourceAssignments`, hedefler) arşivli satırı dışlar; rubrik sürümleri istisnadır (arşivli sürüm sabitlendiği atamada puanlanır).
- Dosyalı ve sesli teslim sürümünün dosyaları `submission_versions.file_ids` (`uuid[]`, varsayılan boş, `submission_versions_file_ids_check` en çok 10; migration `0031_add_submission_version_files`, OG-048) kolonunda gönderim sırasıyla tutulur; yabancı anahtar yoktur, dosya satırı sürümle aynı transaction'da `attached_type = 'task_submission_version'`, `attached_id` = sürüm olarak bağlanır (`services/task-submission-files.ts`). Satır değişmez olduğundan imhadan sonra kimlik kalır, dosya `deleted` görünür.
- Dinleme hakkı sayımı `attempt_media_plays`'tedir (migration 0030, OG-049; değişmez satır, deneme × dosya × sıra tekil). Altyapıdır, bugün satır yazılmaz: atama dolu hakkı reddeder (`TODO(dinleme-icerik-bagi)`, ADR 0004 karar 6 OG-049 notu).
- Ertelenen: bireysel ek süre `TODO(F4b-ek-sure)`, aktarılmış notun düzeltilmesi `TODO(F4b-aktarim-duzeltme)`. F4b2'ye kalan depo ve servis işleri ADR 0004 karar 6'nın "F4b2 için" uygulama notundadır.

### Dosya tablosu (ADR 0003 karar 4, 5)

Migration `0015_create_files`; şema `apps/api/src/db/schema/files.ts`, depo `apps/api/src/db/files.ts`, servis `apps/api/src/services/files.ts`. Dosyanın kendisi depodadır (`src/storage`, bugün yalnız disk sürücüsü); satır meta veridir.

- `files`: birincil anahtar `(institution_id, id)`; `purpose` core `FILE_PURPOSES` anahtarlarıyla, `status` `pending`/`processing`/`ready`/`rejected`/`deleted` ile sınırlı (`check`). `storage_key` sunucuda üretilir (`<institution_id>/<purpose>/<yyyy>/<mm>/<uuid>`), kişisel veri taşımaz ve tekildir. `content_type` içerikten tespit edilen türdür (istemcinin bildirdiği saklanmaz), `byte_size` > 0, `sha256` 64 küçük harf onaltılık. `original_name` (K, temizlenmiş ad) yalnız indirmede `Content-Disposition` içindir; log ve denetim kaydına girmez.
- Bağlı kayıt çok biçimlidir (`attached_type` + `attached_id` + `attached_at`, üçü birlikte dolu veya boş); yabancı anahtar yoktur, bütünlüğü bağlayan işlem sağlar (`attachFile`, aynı transaction). Kayıt türleri `services/file-registry.ts`'te `defineFileAttachment` ile kaydedilir; erişim bağlı kaydın okuma kuralından geçer (karar 6).
- **İçerik kolonları değişmez.** `kampus_reject_file_content_change()` tetikleyicisi `purpose`, `storage_key`, `content_type`, `byte_size`, `sha256` ve `uploaded_by_user_id` kolonlarını değiştiren `update`'i 55000 ile reddeder; tek istisna ses dönüşümüdür (migration 0033, OG-262): `storage_key`, `content_type`, `byte_size` ve `sha256` yalnız `processing` → `ready` geçişinde, aynı güncellemede değişebilir (`completeFileTranscode`); durum, bağlama, saklama ve silme kolonları işlem akışıyla değişir. Satır silinmez (imha nesneyi siler, satır `deleted` kalır); `delete` yalnız imha işinin `set local kampus.allow_immutable_purge = 'on'` ayarıyla geçer (§7). Tetikleyici 0015'in sonuna elle yazılmıştır.
- **Kota.** `institution_settings.storage_quota_bytes` (boş veya > 0); boşsa varsayılan 50 GB (`DEFAULT_STORAGE_QUOTA_BYTES`). Kullanım `deleted` dışı satırların `byte_size` toplamıdır ve yükleme transaction'ında **kurum kilidi altında** sayılır: eşzamanlı iki yükleme sırayla değerlendirilir, kotayı aşan 422 `storage_quota_exceeded` alır ve nesnesi silinir (`test:pg`, `pg-files.test.ts`). Kota yönetim ucu yok (`TODO(F3c2-quota)`).
- İndeksler `institution_id` ile başlar: bağlı kayıt araması `(institution_id, attached_type, attached_id)`, temizlik taraması `(institution_id, created_at)`; temizlik kurum başına çalıştığından tarama bu indeksi kullanır.
- **Bağlanmamış dosya temizliği.** `purgeUnattachedFiles` kurumun 24 saatte bağlanmayan veya reddedilen dosyalarının nesnesini siler, satırı `deleted` yapar; saatlik `files.purge-unattached` işi kurum başına çağırır (api-tasarimi §12).
- **Saklama sonu imhası.** `retention_until` bağlanırken yazılır (bugün yalnız konuşma kaydı, DOM-BEC-052), sonucu kesinleştiren puan, itiraz açılışı ve kararında aynı işlemde yalnız ileri alınır (`extendFileRetention`; gelmiş saklama sonu değişmez) ve rıza geri çekilince `now`'a çekilir (`scheduleSubjectFilesPurge`; yalnız öne çekilir, bağlama daha erken işareti korur). Saklama sonu geçmiş dosya bağlanamaz (`attachFile`, 422 `file_unavailable`). `purgeExpiredFiles` (`listExpiredFiles`: `retention_until <= now`, silinmemiş, en eski önce, `(retention_until, id)` imleciyle sayfalı) bağlı ya da bağsız dosyayı satır kilidi altında yeniden denetler, bağlı kaydın türü bekletmiyorsa (`FileAttachmentKind.purgeHeld`: açık itirazlı ya da puanı kesinleşmemiş teslim sürümü) `deleted` yazar ve nesneyi siler; bağ kalır. Günlük `files.purge-expired` işi kurum başına çağırır. Tarama için ayrı indeks yoktur: saklama sonu dolu satır azdır ve iş günde bir çalışır; ölçümle gerekirse `(institution_id, retention_until) where retention_until is not null and status <> 'deleted'` kısmi indeksi eklenir.

### Aydınlatma ve rıza tabloları (guvenlik-kvkk §9)

Migration `0024_create_privacy_consents`; şema `apps/api/src/db/schema/privacy.ts`, depo `apps/api/src/db/privacy.ts`, kurallar core `lib/privacy-notices.ts` ve `lib/consents.ts` (DOM-YTK-056…062). Ölçüt 2 (veritabanı kısıtı: tek etkin rıza) ve 5 (ayrı saklama/ispat kuralı) gereği `records`'ta değildir.

- `privacy_notices`: sürümlü aydınlatma (`kind = 'notice'`, `audience`) ve rıza metni (`kind = 'consent_text'`, `purpose`). Sürüm kolonu `notice_version`'dır (`version` iyimser kilittir); konu başına tekil (`privacy_notices_audience_version_key`, `privacy_notices_purpose_version_key`). Satır `kampus_reject_immutable_change()` ve `privacy_notices_version_check` ile hiç değişmez, arşivlenmez: arşiv sürümü listeden düşürüp aynı sürüm numarasını yeniden kullandırır (23505) ya da yeniden rıza isteyen sürümü saklayıp eski rızaları geçerli kılardı. Yerini yeni sürüm alır; `listPrivacyNotices` bütün sürümleri döndürür.
- `notice_acknowledgements`: kullanıcı × metin sürümü tekil (`notice_acknowledgements_user_notice_key`); değişmez satır (`kampus_reject_immutable_change`).
- `consents`: veri sahibi (`subject_kind` + `subject_id`), veren ve ilişkisi, amaç, karar (`granted`/`objected`), metin sürümü (`text_id` + `text_version`), kanal, `given_at`, `expires_at`, geri çekme üçlüsü (`withdrawn_at`, `withdrawn_by_user_id`, `withdrawal_reason`; birlikte dolu ya da boş). Kısmi benzersiz `consents_subject_purpose_decision_key` (`withdrawn_at is null and archived_at is null`) aynı veri sahibi + amaç + karar için ikinci etkin satırı 23505 ile reddeder. `kampus_reject_consent_change()` yalnız geri çekilmemiş satıra bir kez geri çekme yazılmasına izin verir; arşiv de reddedilir.
- Metin sürümüne işaret eden yabancı anahtarlar `on delete restrict`'tir: gösterilmiş ya da rıza verilmiş sürüm silinemez. Tetikleyiciler 0024'ün sonuna elle yazılmıştır; silme yalnız imha ayarıyla (§7).

### Eğitim yılı tabloları (IST-011)

Migration `0026_create_academic_years`; şema `apps/api/src/db/schema/academic-years.ts`, depo `apps/api/src/db/academic-years.ts`, kurallar core `lib/academic-years.ts` (DOM-YTK-063…067). Ölçüt 2 (tek etkin yıl ve yıl başına tekil dönem adı veritabanı kısıtıdır) ve 3 (raporlar SQL'de dönem aralığıyla süzülür) gereği `records`'ta değildir.

- `academic_years`: birincil anahtar `(institution_id, start_year)`; `start_year` mevcut sayı temsiliyle (`fee_tariffs.academic_year`, `institution_settings.academic_year`) aynıdır, eski kayıtlar değişmeden yıla bağlanır. `academic_years_dates_check` başlangıç gününü başlangıç yılına ve aralığı bir yıldan kısaya bağlar; `academic_years_lifecycle_check` durumu (`planned`/`active`/`closed`) işlem anlarıyla birlikte tutar; kısmi tekil `academic_years_active_key` kurumda ikinci etkin yılı 23505 (409) ile reddeder.
- `academic_terms`: birincil anahtar `(institution_id, id)`, yıla bileşik yabancı anahtar (`on delete restrict`); ad yılda tekil: `name_key` core `academicTermNameKey(name)`'dir (NFC, kırpılmış, Türkçe küçük harf), depo her yazmada addan türetir ve `academic_terms_year_name_key` (arşivli hariç) onun üzerindedir. `lower()` kullanılmaz: sonucu veritabanının yerel ayarına bağlıdır, core ile ayrışırdı ("I. dönem"/"i. dönem"). Sıra saklanmaz, başlangıç gününden hesaplanır. Kaldırma arşivdir.
- Yılların ve dönemlerin örtüşmemesi aralık kısıtı ister (`btree_gist` yok); core kuralı kurum kilidi altında denetler.
- Yılın `version`'ı yıl ve dönemlerinin ortak iyimser kilididir (`If-Match`): dönem yazan her işlem yılın sürümünü de artırır, böylece istemci tek sürümle bütün takvimi kilitler.
- Etkinleştirme `institution_settings.academic_year`'ı aynı transaction'da etkin yıla eşitler; yenileme, rıza süresi ve tarife bu sayıyı okumaya devam eder. Migration sonuna elle eklenen geri doldurma, ayar satırı olan her kurum için `academic_year`'ı varsayılan aralıkla (1 Eylül – 31 Ağustos), dönemsiz, etkin ve sürüm 1 yazar; snapshot onu izlemez, `drizzle-kit generate` fark üretmez. Yeni kurumda aynı yılı `ensureInstitutionSettings` ayar satırıyla aynı transaction'da yazar (başka yıl varsa yazmaz); demo tohumu örnek yılı (`ensureAcademicYears`) ayardan önce yazar.

### Veli–öğrenci bağı (IST-019)

Migration `0027_create_student_guardians`; şema `apps/api/src/db/schema/student-guardians.ts`, depo `apps/api/src/db/student-guardians.ts`, kurallar core `lib/guardianship.ts` (DOM-ILT-070…075). Ölçüt 2 (tek ödeyici ve aynı velinin bir kez bağlanması veritabanı kısıtıdır) ve 5 (velayet ve iletişim kısıtı ayrı erişim kuralı taşır) gereği `records`'ta değildir.

- `student_guardians`: birincil anahtar `(institution_id, id)`; öğrenci (`student_id`) ve veli kaydı (`parent_id`) `records`'tadır (yabancı anahtar yok), veli hesabı (`membership_id`) `memberships`'e bağlıdır (`on delete cascade`). `student_guardians_identity_check` ikisinden en az birini ister. Yakınlık ve velayet (`full`/`joint`/`none`) `check` ile core sözlüklerine bağlıdır. `student_guardians_restriction_check` iletişim kısıtlı bağı velayetsiz, ödeyici olmayan ve teslim almayan tutar (core ile aynı).
- Kısmi tekil indeksler (arşivli hariç): `student_guardians_payer_key` öğrenci başına tek ödeyici (eşzamanlı ikinci ödeyici 23505 → 409), `student_guardians_student_parent_key` ve `student_guardians_student_membership_key` aynı veli kaydı ya da hesabını öğrenciye bir kez bağlar.
- Velayet ve kısıt Ç sınıfıdır: belge ve karar ayrıntısı tutulmaz, denetime yalnız alan adları yazılır. Kaldırma arşivdir; arşivli bağ velayet, rıza ve kapsam vermez.
- Migration sonuna elle eklenen geri doldurma doğrulanmış eski hesap bağlantılarını (`membership_links` `child`) velayetli (`full`), kısıtsız bağ olarak yazar; yeni `child` bağlantısı aynı bağı `ensureMembershipLinks` ile alır. Okuma kapsamı `membership_links` `child` bağlantısıyla bu tablonun kesişimidir: bağlantı yalnız velayetli ve kısıtsız etkin bağla kapsam verir (`listMembershipLinks`, OG-032); bağı olmayan bağlantı kapsam vermez.

### Kur programı tablosu (IST-076)

Migration `0028_create_courses`; şema `apps/api/src/db/schema/courses.ts`, depo `apps/api/src/db/courses.ts`, kurallar core `lib/courses.ts` (DOM-DIL-005…008). Ölçüt 2 (ad ve e-Özel program kodu tekilliği, yaşam döngüsü veritabanı kısıtıdır) ve ilerideki grup ve paket satışının yabancı anahtarla bağlanması gereği `records`'ta değildir.

- `courses`: birincil anahtar `(institution_id, id)`; tarih, öğretmen, derslik ve fiyat kolonu yoktur (grup ve paket ayrı tablolar olacak), süre saklanmaz. Saat, oturum (90 dakikada saatler çift) ve mevcut (≤ 18) kuralları `check`'tir. `courses_lifecycle_check` durumu (`draft`/`active`/`archived`) işlem anlarıyla birlikte tutar; arşiv satır arşividir (`status = 'archived'` ile `archived_at` birlikte), geri alınmaz. `courses_certified_check` onaysız etkin belgeli kuru reddeder; `courses_e_ozel_check` işaretlenmiş e-Özel kaydında kod, an ve işaretleyeni birlikte ister.
- Tekillik arşivlenmemiş kurlarda kısmi tekil indekslerdir: `courses_name_key` core `courseNameKey(name)` (NFC, kırpılmış, Türkçe küçük harf), `courses_e_ozel_program_key` core `courseProgramKey` (büyük harf). Depo anahtarları her yazmada türetir; `lower()` kullanılmaz.
- Sonraki kur bağı `(institution_id, next_course_id)` bileşik yabancı anahtardır (`on delete restrict`, başka kurumun kuruna bağlanamaz); zincir döngüsü, dil ve seviye kuralı core'da kurum kilidi altında denetlenir. Kurumun kurları azdır (katalog): işlem tutarlılığı için arşivliler dahil hepsi yüklenir, sıralama ve sayfalama serviste yapılır.

### Dil okulu grup tabloları (IST-077)

Migration `0029_create_groups`; şema `apps/api/src/db/schema/language-groups.ts`, depo `apps/api/src/db/language-groups.ts`, kurallar core `lib/language-groups.ts` (DOM-DIL-003, -008, -040…043). Grup kura bileşik yabancı anahtarla bağlanır, kapasite ve yaşam döngüsü veritabanı kısıtıdır; bu nedenle `records`'ta değildir. Okul sınıfı (`classes`) ayrı modeldir.

- `language_groups`: birincil anahtar `(institution_id, id)`; kur `(institution_id, course_id)` bileşik yabancı anahtar (`on delete restrict`, başka kurumun kuruna bağlanamaz), öğretmen `(institution_id, teacher_membership_id)` bileşik yabancı anahtarla aynı kurumun üyeliği (`memberships (institution_id, id)` tekil indeksi migration'a elle eklenir, Better Auth şeması elle düzenlenmez; üyelik silinince elle yazılan `on delete set null ("teacher_membership_id")` yalnız öğretmeni boşaltır), birleştirildiği grup `(institution_id, merged_into_group_id)`. Haftalık kalıp `schedule` `jsonb` dizisidir (en az bir `{ weekday, startTime }`; yapı core şemasıyla doğrulanır), bitiş günü kurun toplam saatinden hesaplanıp saklanır (çakışma ve liste süzgeci için). `check`'ler: ad 1–120, yaş bandı, biçim, derslik ve anahtarı birlikte (çevrim içi grupta derslik yok), tarih sırası, kapasite 1–18, durum `planned`/`open`/`cancelled` işlem anlarıyla birlikte (`language_groups_lifecycle_check`), iptal gerekçesi ve birleştirme yalnız iptal edilmiş grupta. `running`/`completed` saklanmaz, tarihten türetilir.
- `language_groups_name_key` ad anahtarını (core `groupNameKey`) arşivlenmemiş ve iptal edilmemiş gruplarda tekil tutar (iptal edilen grubun adı yeniden kullanılabilir). Derslik anahtarı (`groupRoomKey`) yalnız çakışma karşılaştırması içindir, tekil değildir.
- `language_group_members`: grubun kursiyerleri (`active`/`frozen`; dondurulan kapasiteye sayılmaz). `language_group_members_group_student_key` arşivlenmemiş satırda grupta tekil kursiyer; birleştirmede kaynak satırlar arşivlenir, hedefe yeni satır yazılır (geçmiş kalır). Kursiyer aynı kurumun `students` kaydıdır: üretilen sabit `student_collection` (`'students'`) kolonuyla `records (institution_id, collection, id)` birincil anahtarına bileşik yabancı anahtar (`on delete restrict`; kayıt silinmez, arşivlenir).
- `language_group_waitlist`: öğrenci ya da aday (`language_group_waitlist_learner_check` tam biri), kur ve isteğe bağlı grup sırası, istek anı, durum (`waiting`/`offered`/`accepted`/`expired`/`withdrawn`) ve teklif alanları (teklif grubu, an ve bitiş birlikte). Bekleyen ya da teklifli satırda kur başına tekil öğrenci/aday (kısmi tekil indeksler). Sıra indeksi `(institution_id, course_id, requested_at)`.
- Kurumun grupları dönem başına onlarcadır: çakışma ve ad tekilliği kurumun bütün kapanmamış gruplarıyla kurum kilidi altında core'da denetlenir, okuma süzgeci serviste yapılır (`TODO(grup-yukleme)`: grup sayısı binleri bulursa yükleme `end_date` ile daraltılır).

## 5. Migration kuralları

- Şema değişikliği yalnız migration ile: `pnpm --filter @kampus/api exec drizzle-kit generate --name <ne_yapildigi>` (ör. `add_audit_log`). Üretilen SQL okunur, gerekirse elle düzenlenir ve commit edilir.
- `drizzle-kit push` yalnız atılacak yerel veritabanında; paylaşılan ortamda yok.
- Uygulanmış (main'e girmiş) migration değiştirilmez; düzeltme yeni migration'dır. Geri alma da ileri yönlü yeni migration'dır.
- Her migration tek transaction'dır ve tek mantıksal değişikliktir. Şemayı kullanan kod aynı committe gelir.
- Kırıcı değişiklik genişlet/daralt (expand/contract) ile iki adımdır: önce yeni kolon/tablo eklenir ve iki yere yazılır; kod yeniye geçtikten sonra ayrı migration eskiyi kaldırır.
- `not null` kolon mevcut tabloya varsayılan değerle veya önce dolgu (backfill) migration'ıyla eklenir.
- Büyük tabloya (`records`, `audit_log` gibi) `check` veya yabancı anahtar eklerken kısıt `not valid` ile eklenir, ayrı bir migration'da `validate constraint` çalıştırılır: ilk adım tabloyu uzun süre kilitlemez, doğrulama yalnız okuma kilidi ister. Küçük veya boş tabloda tek adım yeterlidir; gerekçesi migration yorumuna yazılır.
- Büyük tabloda indeks `create index concurrently` ile ayrı, transaction dışı migration'da oluşturulur.
  - **Açık karar (ilk üretim yayınından önce):** Drizzle migrator bekleyen bütün migration'ları tek transaction'da koşturur (`pg-core/dialect.js` `session.transaction`); `create index concurrently` transaction içinde çalışmaz. Yani bugün transaction dışı indeks adımı için bir mekanizma yoktur. Büyük bir veritabanına geçişten önce çalıştırıcı kararı verilir: indeksleri migrator dışında (`psql`/betik, ardından migration `create index if not exists` olarak boş geçer) ya da migration başına ayrı bağlantı ve transaction kullanan kendi çalıştırıcımızla oluşturmak. Karar ADR'ye yazılır.
  - `0009_split_conversation_messages`: iki `records` indeksi `concurrently` değildir ve veri taşımayla aynı transaction'dadır. API henüz yayında değildir, `records` üretimde boştur ya da küçüktür; uygulanmış migration değiştirilmediği için olduğu gibi kalır. İlk üretim yayınından önce çalıştırıcı kararı uygulanmazsa, dolu `records` tablosuna bu migration koşturulurken tablo yazmaya kapanır (indeks oluşumu ve taşıma süresince); bu yüzden dolu veritabanına 0009 ilk kez uygulanmayacak (ilk üretim kurulumu boş veritabanıdır) ya da yukarıdaki karar önce uygulanacaktır.
- Veri dönüştüren migration idempotent yazılır ve PGlite testinde örnek veriyle denenir.
- CI: migration'lar boş veritabanına baştan uygulanır; `drizzle-kit check` ve şemayla migration arasında fark olmadığı doğrulanır.
- Migration'lar (`db:migrate`) veritabanının sahibi olan rolle çalışır: `0010_enable_btree_gin` `create extension` ister. `btree_gin` PostgreSQL 13+ için güvenilir eklentidir; süper kullanıcı gerekmez, veritabanında `CREATE` yetkisi (sahiplik) yeter. Yerelde `compose.yaml`'ın `kampus` rolü veritabanının sahibidir. Üretimde uygulama ayrı, daha dar bir rolle bağlanacaksa (ör. `audit_log`’da `update`/`delete` yok, §8) migration bağlantısı sahip rolle ayrıca verilir; uygulama rolüne eklenti kurma yetkisi verilmez. Barındırılan PostgreSQL'de eklenti izin listesinde `btree_gin` bulunmalıdır.

## 6. İndeks

- Her indeks ve benzersiz kısıt `institution_id` ile başlar: `unique (institution_id, email)`.
- Her yabancı anahtar kolonu indekslidir.
- Arşivlenmemiş kayıtlarda tekillik kısmi indeksle: `create unique index … on goals (institution_id, student_id, scope) where archived_at is null and status <> 'closed'`.
- `records` üzerinde sık filtrelenen anahtar için ifade indeksi: `create index records_student_idx on records (institution_id, collection, (data->>'studentId'))`. `data` üzerinde genel GIN indeksi ölçüm olmadan eklenmez.
- Yeni indeks `EXPLAIN (ANALYZE, BUFFERS)` çıktısıyla gerekçelendirilir (commit gövdesinde); kullanılmayan indeks kaldırılır.
- Mevcut `records` indeksleri (`0009`): `records_institution_collection_position_idx (institution_id, collection, position)` sona ekleme sırası ve sıralı yükleme içindir. `records_conversation_messages_idx (institution_id, (data ->> 'conversationId'), position, id) where collection = 'conversationMessages' and archived_at is null` yazışmanın mesaj sayfası, liste özeti ve okundu yükü içindir. Sorgular indeksin ifadesini ve koşulunu birebir kullanır (`apps/api/src/db/conversation-messages.ts`).
  - `records_notifications_idx (institution_id, (data ->> 'studentId'), position, id) where collection = 'notifications' and archived_at is null` (`0025`, OG-020) bildirim listesi ve okunmamış sayımı içindir (`apps/api/src/db/notifications.ts`). Sorgu anahtar adını sabit metin yazar (`data ->> 'studentId'`); parametreli `data ->> $1` indeksle eşleşmez. Gerekçe (PostgreSQL 16, 6.000 bildirim + başka kurumda 2.000, 400 öğrenci, bir öğrenci ve ebeveyn kitlesi, `EXPLAIN (ANALYZE, BUFFERS)`): indeksli `BitmapOr` iki `Bitmap Index Scan` 0,17 ms ve 174 buffer; indekssiz kurumun bildirim satırlarını tarayan `Seq Scan` 1,7 ms ve 326 buffer (tablo ölçeğiyle büyür). Test: `test/pg-notification-index.test.ts`. Kurulum `concurrently` değildir (yukarıdaki açık karar).
- İçerik havuzu arama indeksi `resource_versions_search_idx` `(institution_id, search_vector)` bileşik GIN'dir: `text` kolonunun GIN operatör sınıfı `btree_gin` eklentisindedir (migration `0010_enable_btree_gin`; PostgreSQL 13+ eklentiyi güvenilir sayar, veritabanı sahibi süper kullanıcı olmadan kurar; testte PGlite `contrib/btree_gin` ile açılır). Böylece kural istisnasız kalır. Gerekçe (`kampus_pg_f3b`, PostgreSQL 16, 200.000 sürüm, 50 kurum, `isik:* & kitap:*` + kurum koşulu, `EXPLAIN (ANALYZE, BUFFERS)`): tek kolon GIN bütün kurumların 40.000 aday satırını bitmap'e alıp birincil anahtar taramasıyla `BitmapAnd` yapar (65 buffer, 7,5 ms); bileşik GIN tek `Bitmap Index Scan`'dir (44 buffer, 5,6 ms). Aday sayısı kurum sayısıyla büyümez; indeks 1,9 MB yerine 2,3 MB'tır. Sorgu kurum koşulunu sürüm satırına açıkça verir (`resource_versions.institution_id = $kurum`).
- İçerik havuzunun diğer indeksleri: sahip süzgeci `resources_owner_idx`, kısmi yabancı anahtar indeksleri (`resources_current_version_idx`, `resources_derived_from_version_idx`, boş değerler girmez), soru → quiz `resource_version_items_item_idx`, öğrencinin kütüphanesi `resource_shares_target_idx where archived_at is null`. Personel listesinin baş sürümü kaynak başına `resource_versions_resource_number_key` üzerinden tek erişimdir.
- 100 ms'yi aşan sorgu `db.slow_query` olayıyla loglanır.

## 7. Arşivleme ve silme

- Kullanıcı işlemiyle silme = arşivleme: `archived_at = now()`, `version + 1`. Sorgular varsayılan olarak `archived_at is null` süzer; depo fonksiyonları bunu varsayılan yapar.
- Arşivden geri alma `archived_at = null`; çalıştırıcıda core arşivli bir kaydın kimliğini yeniden eklerse kayıt yeniden açılır: veri core'un yeni kaydıyla değişir, `version` arşivdeki sürümden artarak sürer, yazma `restore` olarak döner ve denetim kaydının `changes`'ına `restored: [{ collection, id }]` eklenir; aktarılmış bağlı görevler otomatik geri taşınmaz (CLAUDE.md iş kuralı).
- Bağlı kaydı olan kayıt arşivlenirken bağlılar school-core kuralıyla aktarılır veya işlem reddedilir; geçmiş finans/not/yoklama korunur.
- Kalıcı silme (`delete`) yalnız üç yolla: saklama süresi dolan kayıtların imha işi, veri sahibinin silme talebi, süresi dolan teknik kayıtlar (Better Auth `sessions` ve `verifications`; günlük `idempotency.purge` işiyle `idempotency_keys`). Her biri denetim kaydına yazılır. Ayrıntı: [guvenlik-kvkk.md](guvenlik-kvkk.md#10-saklama-ve-silme).
- Değişmez tablolardan (§4 beceri görevi tabloları) silen imha işi ve veri sahibi talebi, silmeyle aynı transaction'da önce `set local kampus.allow_immutable_purge = 'on'` çalıştırır. Ayar transaction bitince kendiliğinden düşer; yalnız satır `delete`'ine izin verir, `update` ve `truncate` yine reddedilir. Silme yabancı anahtar sırasına uyar (aktarım → rubrik puanı → yeniden teslim isteği → teslim sürümü). Uygulama kodu bu ayarı başka hiçbir yerde açmaz; süper kullanıcı isteyen `session_replication_role` kullanılmaz. `audit_log`'daki rol ayrımı (§8) üretimde ek katman olarak kalır.

## 8. Denetim kaydı (`audit_log`)

```sql
create table audit_log (
  id               uuid primary key,
  institution_id   text references institutions (id),  -- yalnız etkin kurumsuz kimlik olayında null
  actor_user_id    text,            -- sistem işinde null
  actor_role       text,
  action           text not null,   -- 'goal.approve', 'auth.login_failed', 'student.export'
  entity_type      text,            -- koleksiyon veya tablo adı
  entity_id        text,
  request_id       text,
  ip_hash          text,            -- tuzlanmış SHA-256; ham IP tutulmaz
  changes          jsonb,           -- değişen alan adları; özel nitelikli değerler yok
  reason           text,            -- yalnız gerekçeli hassas okumada; en çok 500 karakter
  created_at       timestamptz not null default now()
);
alter table audit_log add constraint audit_log_reason_check check (reason is null or char_length(reason) <= 500);
create index audit_log_entity_idx on audit_log (institution_id, entity_type, entity_id, created_at desc);
create index audit_log_actor_idx on audit_log (institution_id, actor_user_id, created_at desc);
```

- Yalnız eklenir. Uygulamanın veritabanı rolüne bu tabloda `insert` ve `select` verilir; `update`/`delete` yetkisi yalnız imha işinin rolündedir.
- İşlemle **aynı transaction'da** yazılır; denetim kaydı yazılamazsa işlem de olmaz. Better Auth olaylarında kanca Better Auth'un işleminden sonra çalışır; yazılamazsa `error` düzeyinde loglanır.
- Yazılan olaylar: bütün yazma işlemleri; giriş başarısı/başarısızlığı, çıkış, parola değişimi/sıfırlama, oturumların toplu kapatılması (Better Auth `hooks`/`databaseHooks` ile); rol, üyelik ve modül değişikliği; kişisel veri dışa aktarımı (CSV/PDF); özel nitelikli veri okuması (sağlık, rehberlik iç notu); veri sahibi talepleri ve imha.
- School-core'un kendi `audit` koleksiyonu sunucuda kalıcı yazılmaz: core onu değerleri maskesiz (rehberlik iç notu, sağlık), sabit demo kullanıcısıyla (`t1`, `s1`) doldurur ve 200 kayda kırpar. İşlem çalıştırıcı bu koleksiyonu her işlemde boş verir ve değişikliklerini yok sayar; depo `audit` koleksiyonuna yazmayı reddeder, tohum yazmaz. Önceden yazılmış satırlar `0005_archive_core_audit_records` ile arşivlendi. Sunucu denetimi yalnız bu tablodadır: gerçek aktör (`actor_user_id`, `actor_role`), işlem (`action`), çağıranın zorunlu verdiği varlık ve değişen alan adları.
- `changes` önceki/sonraki değer değil, değişen alan adlarını tutar (`{ "fields": ["status", "feedback"] }`). Değer gerekiyorsa yalnız sınıflandırması "genel" olan alanların değeri yazılır.
- `reason` serbest metin gerekçedir (`kvkk: K`): yalnız gerekçeli hassas okumada (yöneticinin öğrenci–öğretmen yazışması erişimi, `conversation.access`, DOM-YTK-052) dolar, diğer kayıtlarda boştur; en çok 500 karakter (`audit_log_reason_check`). Gerekçe `changes`'e yazılmaz. Denetim kaydı görünürlüğünde (DOM-YTK-053) `reason` yalnız `yonetici`ye ve yalnız kendi kurumu için döner. Migration `0008` eski kayıtlardaki `changes.reason` değerini bu kolona taşır.
- Denetim kaydı imleçli sayfalamayla yalnız `yonetici` rolüne açılır.
