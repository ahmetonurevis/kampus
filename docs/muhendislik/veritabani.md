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
- Kurumun ek alanları (`type`: `school`/`language_school`, açık modüller) `organization` eklentisinin `additionalFields`'ı ile; sık değişen veya büyüyen ayarlar 1:1 `institution_settings` tablosunda (zorunlu kolonlarla).
- Üyeliğin school-core bağlantısı (öğrenci kimliği, veliye bağlı çocuklar, öğretmen kimliği) `membership_links` tablosundadır: `(institution_id, membership_id, kind, record_id)`, `kind in ('student', 'child', 'teacher')`. Kapsam fonksiyonları bu tablodan beslenir.
- Kimlik kolonu `text`'tir (Better Auth kimlikleri); bizim tablolarımızdaki `institution_id` ve `user_id` aynı tiptedir.

### `pg-boss`

`pg-boss` kendi şemasını (`pgboss`) kendisi kurar ve yükseltir; bu şema drizzle-kit migration'larına girmez ve uygulama kodu ona doğrudan sorgu yazmaz. Testte PGlite ile çalışmıyorsa işler bellek içi sahte kuyrukla çağrılır, gerçek kuyruk `test:pg` takımında denenir.

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
- `data` yazılmadan önce school-core Zod şemasıyla doğrulanır. `data` içinde `institutionId`, `version`, `createdAt`, `updatedAt`, `archivedAt` tutulmaz; bunlar kolondur ve okurken kayda eklenir.
- Kayıt bütün olarak değiştirilir; rota veya serviste `jsonb_set` ile parça güncelleme yapılmaz.
- Yazma sürüm kontrollüdür; etkilenen satır 0 ise 409:

```sql
update records
   set data = $1, version = version + 1, updated_at = now()
 where institution_id = $2 and collection = $3 and id = $4 and version = $5
```

- Bir işlemin değiştirdiği bütün kayıtlar tek transaction'da yazılır; biri çakışırsa hepsi geri alınır.
- Koleksiyonlar arası bütünlük (yabancı anahtar) jsonb'de veritabanınca sağlanmaz; school-core sağlar. Bütünlüğün veritabanı garantisi gerekiyorsa koleksiyon normalleştirilir.
- Hesaplanabilen değer (`goalProgress`, quiz puanı, rubrik toplamı) `data`'ya yazılmaz.
- Dosya ve medya `data`'ya gömülmez (base64 yok); depolama arayüzünde tutulur, kayıt yalnız anahtar ve meta veri taşır. Belge başına sınır 256 KB.
- Geçiş notu: bazı eski kayıtlarda `deletedAt`/`isActive` alanları var. API'ye taşımada arşiv durumu `archived_at` kolonuna aktarılır; jsonb'deki eski alanlar school-core uyumu bitene kadar okunur, yenisi yazılmaz.
- Kayıt anahtarı `data.id`'dir; kimliksiz `videoProgress` için `<studentId>:<videoId>` (`apps/api/src/db/collections.ts`). Kurum satırı silinince kayıtlar kendiliğinden silinmez (cascade yok).
- Sıra: core dizinin sırasına dayanır (başa ekleme, ilk N kayıt), bu yüzden kayıt `position` kolonuyla core dizisinin sırasında yüklenir (`order by position, id`). Değerler 1024 adımlı seyrek tamsayıdır (`apps/api/src/db/positions.ts`): çalıştırıcı işlem sonrası dizide saklanan değerlerin en uzun artan alt dizisini yerinde bırakır; yeni veya yer değiştiren kayıt komşularından türetilen değeri alır (başa ekleme en küçükten bir adım küçük, sona ekleme en büyükten bir adım büyük, araya ekleme aradaki değer). Ara kalmazsa yalnız o koleksiyon baştan numaralanır. Yalnız sırası değişen kayıt `move` yazmasıyla güncellenir (veri aynı kaldığından `version` artmaz); her işlemde bütün satırlar yeniden yazılmaz. Mevcut satırlar `0003_add_records_position` ile kimlik sırasında (önceki yükleme sırası) numaralandı; core sırası SQL'de bilinemediği için tohumu yeniden çalıştırmak tohum kayıtlarını yalnız sıra değeriyle core sırasına getirir.
- Kurum kilidi: işlem çalıştırıcı transaction'ı yüklemeden önce `pg_advisory_xact_lock(<ad alanı>, hashtext(institution_id))` ile açar (`lockInstitution`). READ COMMITTED altında kilitsiz iki işlem aynı görüntüyü yükleyip farklı yeni kimlikle ekleyebilir (aynı gün iki yoklama, son boş yere iki kayıt, aynı saate iki etüt); sürüm denetimi yalnız var olan satırı korur. Kurum içi işlemler böylece sıraya girer; kurum başına tek kilit olduğundan kilit sıralaması sorunu yoktur. İki anahtarlı biçim, tek anahtarlı kilit kullanan `pg-boss`'la çakışmaz. Doğrulaması `test:pg` takımındadır (`test/pg-concurrency.test.ts`).
- Depo `apps/api/src/db/records.ts`, işlem çalıştırıcı `apps/api/src/services/operation-runner.ts`: koleksiyonları yükler, core işlemini `now` ile çalıştırır, farkı (ekleme, değişiklik, listeden çıkarma) tek transaction'da yazar. Core'un listeden çıkardığı kayıt `archived_at` ile arşivlenir ve çalıştırıcıya bir daha yüklenmez; core'un kendi `deletedAt`/`isActive` alanları uyum bitene kadar `data`'da kalır (pasif öğretmen/öğrenci core kurallarınca görülmeye devam eder). Dizi olmayan State alanları (`modules`, `academicYear`) `records`'ta tutulmaz, çağıran verir.

## 4. Normalleştirme ölçütü

Bir koleksiyon aşağıdakilerden **biri** doğrulanınca kendi tablosuna taşınır (her biri ayrı ADR):

1. Bir kurumda 20.000 kaydı geçer veya bir yılda geçmesi beklenir (yoklama, not, ödeme, mesaj bu sınıftadır).
2. Doğruluk veritabanı kısıtı gerektirir: benzersizlik (aynı taksitin tek ödemesi), yabancı anahtar, `check`.
3. SQL'de toplama/raporlama gerekir (finans özeti, devamsızlık oranı) ve uygulamada hesaplamak bütçeyi aşar.
4. Bir işlem için koleksiyonu yüklemek p95'te 50 ms'yi veya 5 MB'ı aşar.
5. Veri özel nitelikli veya ayrı erişim/saklama kuralı ister (sağlık, rehberlik iç notları).

Taşıma tek migration'la yapılır: tablo oluşturulur, `records`'tan veri kopyalanır, eski satırlar silinir; school-core'a aynı state şeklini veren bir depo bağdaştırıcısı yazılır. Öncesi ve sonrası için aynı servis testleri geçmelidir.

## 5. Migration kuralları

- Şema değişikliği yalnız migration ile: `pnpm --filter @kampus/api exec drizzle-kit generate --name <ne_yapildigi>` (ör. `add_audit_log`). Üretilen SQL okunur, gerekirse elle düzenlenir ve commit edilir.
- `drizzle-kit push` yalnız atılacak yerel veritabanında; paylaşılan ortamda yok.
- Uygulanmış (main'e girmiş) migration değiştirilmez; düzeltme yeni migration'dır. Geri alma da ileri yönlü yeni migration'dır.
- Her migration tek transaction'dır ve tek mantıksal değişikliktir. Şemayı kullanan kod aynı committe gelir.
- Kırıcı değişiklik genişlet/daralt (expand/contract) ile iki adımdır: önce yeni kolon/tablo eklenir ve iki yere yazılır; kod yeniye geçtikten sonra ayrı migration eskiyi kaldırır.
- `not null` kolon mevcut tabloya varsayılan değerle veya önce dolgu (backfill) migration'ıyla eklenir.
- Büyük tabloda indeks `create index concurrently` ile ayrı, transaction dışı migration'da oluşturulur.
- Veri dönüştüren migration idempotent yazılır ve PGlite testinde örnek veriyle denenir.
- CI: migration'lar boş veritabanına baştan uygulanır; `drizzle-kit check` ve şemayla migration arasında fark olmadığı doğrulanır.

## 6. İndeks

- Her indeks ve benzersiz kısıt `institution_id` ile başlar: `unique (institution_id, email)`.
- Her yabancı anahtar kolonu indekslidir.
- Arşivlenmemiş kayıtlarda tekillik kısmi indeksle: `create unique index … on goals (institution_id, student_id, scope) where archived_at is null and status <> 'closed'`.
- `records` üzerinde sık filtrelenen anahtar için ifade indeksi: `create index records_student_idx on records (institution_id, collection, (data->>'studentId'))`. `data` üzerinde genel GIN indeksi ölçüm olmadan eklenmez.
- Yeni indeks `EXPLAIN (ANALYZE, BUFFERS)` çıktısıyla gerekçelendirilir (commit gövdesinde); kullanılmayan indeks kaldırılır.
- 100 ms'yi aşan sorgu `db.slow_query` olayıyla loglanır.

## 7. Arşivleme ve silme

- Kullanıcı işlemiyle silme = arşivleme: `archived_at = now()`, `version + 1`. Sorgular varsayılan olarak `archived_at is null` süzer; depo fonksiyonları bunu varsayılan yapar.
- Arşivden geri alma `archived_at = null`; aktarılmış bağlı görevler otomatik geri taşınmaz (CLAUDE.md iş kuralı).
- Bağlı kaydı olan kayıt arşivlenirken bağlılar school-core kuralıyla aktarılır veya işlem reddedilir; geçmiş finans/not/yoklama korunur.
- Kalıcı silme (`delete`) yalnız üç yolla: saklama süresi dolan kayıtların imha işi, veri sahibinin silme talebi, süresi dolan teknik kayıtlar (Better Auth `sessions` ve `verifications`, `idempotency_keys`; günlük `pg-boss` temizlik işiyle). Her biri denetim kaydına yazılır. Ayrıntı: [guvenlik-kvkk.md](guvenlik-kvkk.md#10-saklama-ve-silme).

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
  created_at       timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log (institution_id, entity_type, entity_id, created_at desc);
create index audit_log_actor_idx on audit_log (institution_id, actor_user_id, created_at desc);
```

- Yalnız eklenir. Uygulamanın veritabanı rolüne bu tabloda `insert` ve `select` verilir; `update`/`delete` yetkisi yalnız imha işinin rolündedir.
- İşlemle **aynı transaction'da** yazılır; denetim kaydı yazılamazsa işlem de olmaz. Better Auth olaylarında kanca Better Auth'un işleminden sonra çalışır; yazılamazsa `error` düzeyinde loglanır.
- Yazılan olaylar: bütün yazma işlemleri; giriş başarısı/başarısızlığı, çıkış, parola değişimi/sıfırlama, oturumların toplu kapatılması (Better Auth `hooks`/`databaseHooks` ile); rol, üyelik ve modül değişikliği; kişisel veri dışa aktarımı (CSV/PDF); özel nitelikli veri okuması (sağlık, rehberlik iç notu); veri sahibi talepleri ve imha.
- `changes` önceki/sonraki değer değil, değişen alan adlarını tutar (`{ "fields": ["status", "feedback"] }`). Değer gerekiyorsa yalnız sınıflandırması "genel" olan alanların değeri yazılır.
- Denetim kaydı imleçli sayfalamayla yalnız `yonetici` rolüne açılır.
