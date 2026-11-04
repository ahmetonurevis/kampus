# ADR 0010 · Taksit ve sözleşme ilişkisel tablolarda

- Durum: Taslak (2026-11-04; kabul proje sahiplerinindir)
- Hazırlayan: Onur (ON-045); uygulama ON-046
- Ayrıntılandırdığı: ADR 0001 karar 6 (kademeli normalleştirme), veritabani.md §4
- Kabul edilirse geçersiz kıldığı: ADR 0006 karar 2 ("taksit ve sözleşme `records`'ta kalır"). ADR 0006'nın öteki kararları sürer.

## Bağlam

Taksit (`invoices`) ve sözleşme (`contracts`) bugün `records` koleksiyonlarıdır. Tahsilat (`payments`, `payment_allocations`), ayrılış (`student_withdrawals`), burs (`scholarship_awards`) ve tarife (`fee_tariffs`) ise ilişkisel tablolardadır (ADR 0006). Bu yüzden finans verisinin yarısı veritabanı kısıtıyla korunuyor, yarısı korunmuyor.

### Ertelemenin gerekçesi yeniden incelendi

ADR 0006 karar 2 taşımayı şu gerekçeyle erteledi: "Taşımak Vue ve mobil demo için bağdaştırıcı gerektirir; demo kalıcılığı silinince ayrı ADR ile değerlendirilir." Demo kalıcılığı hâlâ duruyor:

- ON-037 core'daki demo ödeme yolunu yalnız daralttı (`lib/payments-demo.ts`), çünkü Vue ve mobil bu yolu kullanıyor.
- Tam silme OG-072 (Vue'yu silmek), OG-073 (`stores/demo.js`, `demo-persistence.ts`) ve OG-074'e (mobilin AsyncStorage snapshot'ı) bağlı. Üçü de `bekliyor`.

Ancak Vue demosu ve mobil snapshot API veritabanını hiç okumaz; core işlemlerini kendi bellek içi `State`'leri üzerinde çalıştırır. Taşıma core `State` şeklini (`State['invoices']`, `State['contracts']`) korursa demo bundan etkilenmez. Gereken bağdaştırıcı demo tarafında değil, API tarafındadır: işlem çalıştırıcı (`operation-runner.ts`) ile depo (`db/records.ts`) arasına girer. Demonun silinmesini beklemek yalnız bir seçenek için şarttır: core finans kurallarını ADR 0004 karar 2'deki gibi `State` dışına yeniden yazmak (seçenek C).

### Neden şimdi

- **API yayında değil.** Yayın ADR'si ve sunucu işi ON-053 `bekliyor`. veritabani.md §5 de "API henüz yayında değildir" der. Bu yüzden veri taşıma yalnız geliştirme ve test veritabanlarında koşar. İlk pilottan sonra aynı taşıma gerçek finans verisi üzerinde yapılmak zorunda kalır.
- **Kısıt eksiği büyüyor.** ADR 0006'dan sonra eklenen her özellik geçici bir çözümle geldi:
  - ON-028'in onaylı sözleşme koruması (`0056_protect_approved_contracts`), bütün `records` güncellemelerinde koşan, jsonb farkına bakan koşullu bir tetikleyicidir.
  - `student_withdrawals.contract_id` ile `payment_allocations.invoice_id` yabancı anahtar değildir.
  - Ödeyici kapsamı (ON-291, `payerStudentIds`) yalnız uygulamada süzülür.

### Normalleştirme ölçütleri (veritabani.md §4)

Ölçütlerden biri yeter.

| #   | Ölçüt                      | Durum             | Dayanak                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Kurumda 20.000+ kayıt      | Bilinmiyor        | Örnek veri öğrenci başına 8 taksit üretir (`data/seed.ts`), üst sınır varsayılanı 12'dir (DOM-FIN-011). Arşivli satırlar tabloda kalır. Bu durumda 20.000 satıra tek yılda yaklaşık 1.667 öğrenciyle (12 taksit) varılır; 500 öğrenciyle (8 taksit) yaklaşık 5 yılda varılır. Pilot kurumun öğrenci sayısı belgede yok (açık soru 1).                                                                                       |
| 2   | Veritabanı kısıtı          | **Karşılanıyor**  | Yabancı anahtar: `payment_allocations.invoice_id`, `student_withdrawals.contract_id`, sözleşme → tarife ve burs programı, ek protokol → önceki sürüm. Değişmezlik: onaylı sözleşme (DOM-FIN-010, IST-092), bugün jsonb tetikleyicisiyle. Benzersizlik: sürüm başına tek açık ek protokol (core `contract_amendment_open`), sözleşme zincirinde taksit numarası. `check`: tutar, para birimi, onay/imza/iptal alan grupları. |
| 3   | SQL raporlama              | Kısmen, ölçülmedi | Finans toplamları ve dışa aktarım bütün taksitleri uygulamaya yükler (`services/finance-exports.ts`). Pano sayımı da öyle (`countCollection`, `services/dashboard.ts`). Bütçe aşımı ölçülmedi.                                                                                                                                                                                                                              |
| 4   | Yükleme p95 > 50 ms / 5 MB | Ölçülmedi         | `invoice.pay` ve `payment.reverse` (`services/payments.ts`) ile `student.withdraw` `loadScope` vermez. Bu işlemler kurum kilidi altında kurumun bütün `invoices` ve `contracts` kayıtlarını yükler. `records` üzerinde `invoices` için `studentId` ifade indeksi yoktur. Ölçüm `operation.applied.loaded` logu ve `EXPLAIN` ile ON-046a'da yapılır.                                                                         |
| 5   | Özel nitelikli veri        | Karşılanmıyor     | Finans `Ç` sınıfıdır, `Ö` değildir (guvenlik-kvkk §8). Ayrı erişim kuralı core kapsamında karşılanıyor (`FINANCE_PERSONAL`, `ownOrPayerStudent`).                                                                                                                                                                                                                                                                           |

Taşıma ölçüt 2'ye dayanır; 1, 3 ve 4 ON-046a ölçümüyle güçlenir ya da zayıflar, kararı değiştirmez.

### Bugünkü veri şekli (tarama)

- **Taksit** (`State['invoices']`, `data/seed.ts` `OnurStatePatches`):
  - Alanlar: `id`, `studentId`, `installment`, `amount` (kuruş), `dueDate`, `paidAt`, `method`, `reminderAt`, `feeKind`, `contractId`, `academicYear`, `createdAt`, `updatedAt`.
  - `dueDate` takvim günü olarak kullanılır ama ISO anı biçiminde yazılır: `…T09:00:00.000Z` (`enrollment.ts`, `withdrawals.ts` `DAY_TIME`, `school-workflows.ts`).
  - `method` core etiketidir (`'Banka havalesi'`). `payments.method` ise anahtardır (`PAYMENT_METHOD_KEYS`).
  - Okunurken `paidCents` eklenir (`collection-reads.ts` `withPaidAmounts`); bu alan saklanmaz.
- **Sözleşme** (`State['contracts']`):
  - Her sürüm ayrı kayıttır. Ek protokol yeni kimlikle açılır ve önceki sürüme `amendsContractId` ile bağlanır (`lib/contract-approval.ts` `amendContract`).
  - Kayıt, karar anının kopyası olan `ContractTerms` alanlarını taşır: tarife, brüt, indirimler, ek hizmetler, net, ödeyici, burs.
  - `ContractLifecycle` alanları: imza yetkilisi, `approval` (yöntem, an, onaylayan, ödeyici adı, plan kopyası), `proposedPlan`, iptal.
  - Taksitlere bağ `invoiceIds` dizisidir.
- **Taksit bir sürümden fazlasına bağlı olabilir.** Ek protokol onayında korunan taksitler önceki sürümün `contractId`'sini taşımayı sürdürür ama yeni sürümün `invoiceIds`'ine girer. Yerine gelen taksitler önceki sürümün `invoiceIds`'inde kalır ve arşivlenir (`approveContract` → `applyProposedPlan`). Ayrılış kalan taksitleri onaylı sürümün `invoiceIds`'inden düşürür (`withdrawStudent`). Bu yüzden `invoiceIds` taksitin `contractId`'sinden türetilemez; ayrı bir bağ tablosu gerekir.
- **Eski kayıtlar eksik alan taşır.** Örnek veri ve eski kayıtlarda taksitte `contractId`, sözleşmede `invoiceIds` ve `academicYear` yoktur. Belge bu durumda öğrencinin bütün taksitlerine düşer (`document-data.ts`).

## Kararlar

### Seçenekler

- **A · Beklemek.** ADR 0006 karar 2 sürer; taşıma OG-072/073/074 bitince seçenek C ile yapılır.
  - Artısı: bugün iş çıkmaz.
  - Eksisi: kısıt eksiği sürer ve veri taşıma pilottan sonraya, gerçek veriye kalır. Her yeni finans özelliği 0056 gibi bir jsonb geçici çözümü daha ekler.
- **B · Şimdi taşımak, core `State` şekli korunur (önerilen).** Taksit ve sözleşme API'de kendi tablolarına geçer.
  - Çalıştırıcı bu iki koleksiyonu "tablo destekli koleksiyon" deposundan yükleyip yazar. Core işlemleri, Vue ve mobil demo değişmez.
  - Yanıt şekli aynı kalır: `GET /collections/invoices` yine core kaydını döner.
- **C · Şimdi taşımak, finans kuralları `State` dışına (ADR 0004 karar 2).** Core finans fonksiyonları tipli satır alır.
  - Artısı: en temiz yapıdır.
  - Eksisi: demo silinene kadar core'da `State` ile çalışan ikinci bir yol gerekir. Bu da ON-037'nin daralttığı çift kodu geri getirir. Fiilen OG-073/074'ü bekler.
- **D · `records`'ta kalıp kısıt eklemek.**
  - Yöntem: ifade indeksiyle benzersizlik ve `payment_allocations`'a `records` varlığını denetleyen tetikleyici.
  - Artısı: ucuzdur.
  - Eksisi: gerçek yabancı anahtar ve `on delete restrict` olmaz. Her yeni kısıt 0056 gibi bütün `records` yazımına maliyet ekler. Raporlama jsonb üzerinde kalır.

### Önerilen: B

1. **Üç tablo.** `contracts` (her satır bir sözleşme sürümüdür), `invoices` ve `contract_invoices` (sürüm ↔ taksit bağı, core `invoiceIds`).
   - Ayrı `contract_versions` tablosu kurulmaz, çünkü core'da sürüm zaten ayrı kayıttır. Bütün dış bağlar sürüm kimliğine işaret eder: `student_withdrawals.contract_id`, `renewals.contractId`, `invoices.contractId`. Zincir `amends_contract_id` ve değişmez `root_contract_id` kopyasıyla okunur.
   - Tablolar veritabani §2 zorunlu kolonlarını taşır.
2. **Kimlikler korunur.** `id text`, `records` kimliğidir (`contract-s1`, `inv-…`); ADR 0004'teki `uuid` kuralına bilinçli istisnadır. Bu sayede `payment_allocations`, `student_withdrawals`, `renewals`, PDF ve istemci önbelleği değişmeden bağlanır. Satır `version`'ı kopyalanır, istemcinin `If-Match` değeri geçerli kalır.
3. **Core `State` şekli ve HTTP yanıtları değişmez.**
   - Depo, satırı core kaydına çevirir: kuruş `amount`, `dueDate` `YYYY-MM-DDT09:00:00.000Z`, yöntem etiketi, `invoiceIds` sırası.
   - Ters yönde core kaydını satıra çevirir. Şemaya uymayan kayıt programlama hatasıdır: 500, `error` logu, işlem geri alınır.
   - `openapi.json` farkı sıfır olmalıdır.
4. **Değişmezlik kolonla ifade edilir.**
   - Onaylı (`approved_at` dolu) ya da iptal edilmiş (`cancelled_at` dolu) sözleşme satırında yalnız `class_id`, `version` ve `updated_at` değişir. Bunu koşullu bir `BEFORE UPDATE` tetikleyicisi denetler: kolonlar açıkça sayılır, ortak `kampus_reject_immutable_change()` çağrılır, 55000 döner.
   - `invoiceIds` değişikliği `contract_invoices` satırıdır; sözleşme satırına yalnız `version + 1` olarak yansır.
   - Taksitte `student_id`, `contract_id`, `installment`, `fee_kind`, `amount_cents` ve `due_date` hiç değişmez; tarama sonucuna göre bugün bunları değiştiren core işlemi yoktur. Değişebilenler: `paid_at`, `payment_method`, `reminder_at`, `version`, `updated_at`, `archived_at`.
   - `delete` ve `truncate` üç tabloda da yalnız imha istisnasıyla geçer (`kampus.allow_immutable_purge`).
   - 0056 tetikleyicisi daralt adımında kaldırılır.
5. **`paid_at` ve `payment_method` geçiş önbelleği olarak kalır** (ADR 0006 karar 3). Bunları dağılımlardan türetmek eski kayıtları (tahsilat satırı olmadan `paidAt` taşıyan örnek veri) bozar. Kaldırılmaları ayrı karardır (açık soru 4).
6. **Bağlar.** Bütün yabancı anahtarlar `(institution_id, …)` bileşiktir ve `on delete restrict`'tir. Her yabancı anahtar indekslidir.
   - `records`'ta kalan koleksiyonlara giden bağlar yabancı anahtar değildir: `student_id`, `class_id`, `renewals`. Bütünlüklerini core sağlar (ADR 0004 karar 12 sınırı).
7. **Yazma sırası.** Çalıştırıcı tablo destekli koleksiyonları bağımlılık sırasıyla yazar: `contracts` → `invoices` → `contract_invoices`. Kurum kilidi altında olduğu için kilitlenme sırası sorunu çıkmaz. Ertelenmiş (`deferrable`) yabancı anahtar kullanılmaz; çünkü `restrict` ertelenemez.
8. **Yükleme kapsamı.** Depo, `loadScope`'un bugünkü süzgeçlerini (`equals` `studentId`/`contractId`, kimlik listesi, taksit durumu süzgeci) kolon koşuluna çevirir. Çevrilemeyen süzgeç programlama hatasıdır ve testte yakalanır. `invoice.pay`, `payment.reverse` ve `student.withdraw` öğrenciyle daraltılır; ölçüt 4 için ölçüm öncesi ve sonrası yazılır.

### Tablo taslağı

Adlar ve tipler veritabani.md §1–§2 ve `.claude/rules/veritabani.md`'ye uyar. Her tabloda `created_at`, `updated_at`, `archived_at`, `version` vardır; aşağıda tekrar yazılmaz. Her tablo ve kolon Türkçe `COMMENT ON` alır.

```sql
create table contracts (
  institution_id    text not null references institutions (id),
  id                text not null,            -- records kimliği korunur
  student_id        text not null,            -- records `students`; FK değil  -- kvkk: Ç
  root_contract_id  text not null,            -- zincirin ilk sürümü; ilk sürümde kendisi; değişmez
  amends_contract_id text,                    -- önceki sürüm (ek protokol)
  revision          integer not null default 1,
  academic_year     integer,                  -- eski kayıtlarda boş
  class_id          text,                     -- canlı bağ: sınıf arşivi aktarır (0056 istisnası)
  title             text not null,
  contract_at       timestamptz not null,     -- core `date`
  amount_cents      bigint not null,          -- core `amount`  -- kvkk: Ç
  currency          text not null default 'TRY',
  -- Tarifeli kopya (ContractTerms, DOM-FIN-010); eski kayıtlarda boş
  tariff_id         uuid,
  tariff_version    integer,
  gross_cents       bigint,                   -- kvkk: Ç
  net_cents         bigint,                   -- kvkk: Ç
  discounts         jsonb,                    -- karar anı kopyası; core şemasıyla doğrulanır  -- kvkk: Ç
  extras            jsonb,                    -- kvkk: Ç
  terms_approved_by_user_id text,             -- kvkk: K
  payer             text,                     -- 'guardian' | 'student'
  scholarship_program_id uuid,
  scholarship_cents bigint,                   -- kvkk: Ç
  -- İmza yetkilisi (ÖÖKY m.31/4)
  signatory_name    text,                     -- kvkk: K
  signatory_role    text,                     -- 'founder' | 'founder_representative'
  signatory_recorded_at timestamptz,
  signatory_recorded_by_user_id text,         -- kvkk: K
  -- Ödeyici onayı; plan onay anının kopyasıdır (DOM-FIN-051)
  approval_method   text,                     -- 'wet_signature' | 'electronic'
  approved_at       timestamptz,
  approved_by_user_id text,                   -- kvkk: K
  approval_payer_name text,                   -- kvkk: K
  approval_plan     jsonb,                    -- ContractPlanLine[]  -- kvkk: Ç
  -- Ek protokol
  amendment_reason  text,                     -- kvkk: Ç
  proposed_plan     jsonb,                    -- onaya kadar; onayda boşalır
  -- İptal (yalnız onaysız ek protokol)
  cancelled_at      timestamptz,
  cancelled_by_user_id text,                  -- kvkk: K
  cancel_reason     text,                     -- kvkk: Ç
  primary key (institution_id, id),
  foreign key (institution_id, amends_contract_id) references contracts on delete restrict,
  foreign key (institution_id, root_contract_id)   references contracts on delete restrict,
  foreign key (institution_id, tariff_id)          references fee_tariffs on delete restrict,
  foreign key (institution_id, scholarship_program_id) references scholarship_programs on delete restrict
);
```

Sözleşme kısıtları:

- `contracts_currency_check` (`currency = 'TRY'`). `contracts_amounts_check`: tutarlar ≥ 0. `contracts_payer_check`, `contracts_signatory_role_check`, `contracts_approval_method_check`: `oneOf`.
- `contracts_revision_check`: `(amends_contract_id is null) = (revision = 1)` ve `(amends_contract_id is null) = (root_contract_id = id)`.
- `contracts_terms_check`: tarife grubu (`tariff_id`, `tariff_version`, `gross_cents`, `net_cents`, `payer`) ya hep dolu ya hep boş.
- `contracts_signatory_check`, `contracts_approval_check`, `contracts_cancel_check`: her grup ya hep dolu ya hep boş.
- `contracts_approval_requires_signatory_check`: `approved_at is null or signatory_recorded_at is not null` (core `contract_signatory_required`).
- `contracts_approved_or_cancelled_check`: `approved_at is null or cancelled_at is null`.
- `contracts_amendment_open_key`: `unique (institution_id, amends_contract_id) where amends_contract_id is not null and cancelled_at is null`. Bu, core `contract_amendment_open` kuralının veritabanı karşılığıdır.
- İndeksler:
  - `contracts_student_idx (institution_id, student_id)`: kapsam ve öğrenci süzgeci.
  - `contracts_root_idx (institution_id, root_contract_id)`.
  - `contracts_tariff_idx` ve `contracts_scholarship_program_idx`: yabancı anahtar indeksi; kısmi, boş değer girmez.
- Tetikleyiciler: `contracts_settled_immutable_trigger` (karar 4) ve `contracts_purge_only_trigger` (`delete`/`truncate`).

```sql
create table invoices (
  institution_id    text not null references institutions (id),
  id                text not null,            -- records kimliği korunur
  student_id        text not null,            -- records `students`; FK değil  -- kvkk: Ç
  contract_id       text,                     -- taksiti açan sürüm; eski kayıtlarda boş olabilir
  root_contract_id  text,                     -- contract_id'nin zinciri; taksit numarası tekilliği için kopya
  academic_year     integer,
  installment       integer not null,
  fee_kind          text not null default 'tuition',
  amount_cents      bigint not null,          -- kvkk: Ç
  currency          text not null default 'TRY',
  due_date          date not null,            -- core `dueDate` (…T09:00:00.000Z) ↔ gün
  paid_at           timestamptz,              -- geçiş önbelleği (ADR 0006 karar 3)
  payment_method    text,                     -- PAYMENT_METHOD_KEYS anahtarı
  reminder_at       timestamptz,
  position          bigint not null,          -- core dizi sırası (records'taki gibi; açık soru 5)
  primary key (institution_id, id),
  foreign key (institution_id, contract_id)      references contracts on delete restrict,
  foreign key (institution_id, root_contract_id) references contracts on delete restrict
);
```

Taksit kısıtları:

- `invoices_amount_cents_check` (`> 0`), `invoices_installment_check` (`> 0`), `invoices_currency_check`.
- `invoices_payment_method_check`: `oneOf(PAYMENT_METHOD_KEYS)`.
- `invoices_paid_check`: `(paid_at is null) = (payment_method is null)`.
- `invoices_contract_root_check`: `(contract_id is null) = (root_contract_id is null)`.
- `invoices_installment_key`: `unique (institution_id, root_contract_id, installment) where archived_at is null and root_contract_id is not null`. Ek hizmet taksitleri öğrenimin ardından numaralanır (`enrollment.ts`), ek protokol ve ayrılış borcu en büyük korunan numaradan devam eder. Mevcut veride ihlal olup olmadığı ON-046a'da sayılır.
- İndeksler:
  - `invoices_student_due_idx (institution_id, student_id, due_date)`: bakiye, ekstre, kapsam.
  - `invoices_contract_idx (institution_id, contract_id)` ve `invoices_root_contract_idx`: yabancı anahtar indeksi.
  - `invoices_open_due_idx (institution_id, due_date) where archived_at is null and paid_at is null`: hatırlatma işi (`installment-reminders`).
  - `invoices_position_idx (institution_id, position)`.
- Tetikleyiciler: `invoices_terms_immutable_trigger` (karar 4) ve `invoices_purge_only_trigger`.

```sql
create table contract_invoices (
  institution_id text not null,
  contract_id    text not null,
  invoice_id     text not null,
  position       integer not null,            -- core `invoiceIds` sırası
  primary key (institution_id, contract_id, invoice_id),
  foreign key (institution_id, contract_id) references contracts on delete restrict,
  foreign key (institution_id, invoice_id)  references invoices  on delete restrict
);
create index contract_invoices_invoice_idx on contract_invoices (institution_id, invoice_id);
```

- `invoiceIds`'ten düşmek (ayrılış) satırı arşivlemektir (`archived_at`); satır silinmez.
- Daralt adımında iki yabancı anahtar daha eklenir:
  - `payment_allocations (institution_id, invoice_id) → invoices`
  - `student_withdrawals (institution_id, contract_id) → contracts`
  - İkisi de `on delete restrict`, önce `not valid`, sonra ayrı migration'da `validate constraint`.

### Geçiş: genişlet / daralt

Her adım ayrı commit ve ayrı birleştirmedir; adım bitince ağaç yeşildir.

1. **Ön denetim (şema değişmez).** `records` üzerinde sayım betiği ve `test:pg` ölçüm testi çalışır.
   - Sayılanlar:
     - `contractId`'siz ve hiçbir `invoiceIds`'te olmayan taksit
     - birden çok sürüme bağlı taksit (ek protokolde beklenir)
     - saat bölümü `T09:00:00.000Z` olmayan `dueDate`
     - `uuid` olmayan `tariffId`
     - `amount ≤ 0`
     - tanınmayan `method`
     - zincirde yinelenen taksit numarası
     - kaydı olmayan `payment_allocations.invoice_id` ve `student_withdrawals.contract_id`
   - Ölçülenler: ölçüt 4 yükleme süreleri.
   - Çıktı ON-046 notuna yazılır. Sorunlu kayıt varsa nasıl çözüleceği kopyalamadan önce kararlaştırılır.
2. **Genişlet.** Migration üç tabloyu, kısıtları, indeksleri, tetikleyicileri ve yorumları açar; tablolar boştur.
   - Depolar yazılır: `db/invoice-store.ts`, `db/contract-store.ts`.
   - Çalıştırıcıya depo kaydı eklenir (aşağıda, Oğuzhan'ın kodu).
   - Bu adımda okuma ve yazma hâlâ `records`'tadır.
3. **Kopyalama ve çift yazma.** İdempotent veri migration'ı `records`'tan tablolara kopyalar (`on conflict do nothing`).
   - Kopyalanan değerler: kimlik, sürüm, `position`, arşiv durumu ve `invoiceIds` sırası.
   - `contractId`'siz eski taksit için sıra şöyledir: önce onu `invoiceIds`'inde taşıyan ilk sürüm, sonra öğrencinin tek sözleşmesi. İkisi de yoksa bağ boş kalır.
   - Çalıştırıcı bu iki koleksiyonu iki yere, aynı transaction'da yazar. Kaynak `records`'tır.
   - Eşlik testi her finans servis testinden sonra iki deponun core kaydını karşılaştırır.
4. **Okuma geçişi.** Kaynak tablolara geçer: çalıştırıcı yüklemesi, genel koleksiyon okuması, finans servisleri ve hatırlatma işi. `records` ayna olarak yazılmayı sürdürür.
   - Geri dönüş bu adımın commit'ini geri almaktır (`git revert -m 1`). Ayna güncel olduğu için veri kaybı olmaz.
5. **Daralt.** `records`'a yazma durur ve `invoices`/`contracts` satırları silinir. veritabani.md §4 taşımada eski satırların silinmesini öngörür; yine de bu adım denetim kaydına yazılır.
   - 0056 tetikleyicisi kaldırılır.
   - `payment_allocations` ve `student_withdrawals` yabancı anahtarları `not valid` olarak eklenir; ayrı migration'da `validate` edilir.
   - Ön denetimde çözülen eski kayıtlar için `invoices.contract_id` `not null` olur (açık soru 3).
   - `db/collections.ts` iki koleksiyonu `records` deposundan çıkarır; depo bu adlara yazmayı reddeder.
   - Bu adımdan sonra geri dönüş ileri yönlü bir migration'dır: tablolardan `records`'a kopyalanır, tetikleyici geri eklenir. Bu yol daralt öncesinde PGlite'ta bir kez denenir.

**Çift yazma süresi.** 4. adım en az bir teslim (sürüm) boyunca yeşil kalmadan 5. adıma geçilmez. API o sırada yayına girmişse süre en az bir yayın sürümüdür. Yayında veri yoksa 3–5. adımların veritabani §4'teki gibi tek migration'a sıkıştırılması açık soru 2'dir.

### Etkilenen uçlar ve ekranlar

Yanıt şeması değişmez; ekranlar davranış olarak etkilenmez, aynı e2e'lerle doğrulanır.

- **Tahsilat:** `POST /api/v1/payments`, `POST /payments/:paymentId/reverse`, `GET /payments`, `GET /payments/:paymentId` (dağılım → taksit).
- **Sözleşme:** `POST /api/v1/finance/contracts/:contractId/{signatory,approve,amendments,cancel-amendment}`.
- **Ayrılış:** `POST /api/v1/students/:studentId/{withdrawal-quote,withdraw}`, `POST /withdrawals/:withdrawalId/pay-refund`.
- **Yenileme:** `GET/POST /api/v1/finance/renewals`, `…/quote`, `…/:renewalId`, `…/:renewalId/activate`; `/api/v1/workflows/renewal` (sözleşme ve taksit açar).
- **Kesin kayıt:** `POST /api/v1/prospects/:prospectId/enroll` (`APPEND_ONLY` kapsamı tabloya ekleme olur).
- **Finans okumaları:** `GET /api/v1/finance/{totals,overview,summary,exports}`, `…/students/:studentId/{balance,statement}`.
- **Genel okuma:** `GET /api/v1/collections/{invoices,contracts}`, `…/:id`, `…/counts`; `GET /api/v1/dashboard`.
- **Sınıf/kampüs arşivi:** `DELETE /api/v1/{classes,branches,teachers}/:id` (`record.archive`, planlı yenilemenin sözleşme `class_id`'si).
- **İş:** taksit hatırlatma (`jobs/installment-reminders.ts`).
- **Ekranlar:** React Finans & Tahsilat ve Sözleşmeler sekmesi (`pages/finance/*`), Ödemelerim ve aile sayfaları, kesin kayıt, yenileme, pano kartları, PDF (dekont, sözleşme, taahhütname). Vue ve mobil demo etkilenmez; mobil API'ye geçince (OG-074) aynı uçları kullanır.

### Oğuzhan'ın etkilenecek kodu

Alan haritasına göre Oğuzhan'ındır; iş isteği issue'suyla (`sahip:oguzhan`) ya da kullanıcının vereceği `alan-izni` ile yapılır.

- **Çalıştırıcı ve depo** (`services/operation-runner.ts`, `db/records.ts`, `db/collections.ts`):
  - Koleksiyon başına depo kaydı (`CollectionStore`: yükle, kimlikle yükle, süzgeçle yükle, sayfa, yaz).
  - `loadOperationRecords` ve `writeRecords`'ın depoya dağıtılması, bağımlılık sırasıyla yazma.
  - `records` varsayılanı değişmez. Bu en büyük ve tek engelleyici değişikliktir.
- **Genel okuma** (`services/collection-reads.ts`, `collection-joins.ts`, `read-scope.ts`, `routes/collections.schemas.ts`): `sqlPage`, `readRows`, `withPaidAmounts` ve `DERIVED_STATUS` depo üzerinden okur; kapsam kuralı aynıdır.
- **Pano** (`services/dashboard.ts`): sayım arayüzü aynı kalır.
  - Aylık tahsilat ve "bugün tahsil edilen" bugün taksitin `paidAt`'ini gruplar; kısmi ödemeyi saymaz.
  - Bunun `payments` tablosuna geçmesi davranış değişikliğidir, ayrı takip işidir.
- **Sınıf listeleri ve arşiv** (`lib/school-management.ts`): sınıf arşivi yalnız planlı yenilemenin sözleşmesinin `classId`'sini aktarır; o sözleşmenin ek protokolleri eski sınıfta kalır. Tabloda sorun çıkarmaz (`class_id` her satırda canlı bağdır) ama core tutarsızlığıdır (takip).
- **Belge verisi** (`lib/document-data.ts`, `web-react/src/lib/pdf/document-state.ts`): veri şekli aynıdır. `invoiceIds`'siz eski kayıt düşüşü, daralt sonrası bütün kayıtlar bağlı olursa kaldırılabilir (takip).
- **Ortak dosyalar:**
  - `apps/api/drizzle/**`: migration'lar.
  - `apps/api/src/unique-constraints.ts`: Oğuzhan'ın. `contracts_amendment_open_key` → 409 `contract_amendment_open` sınıflaması isteğe bağlıdır; Onur'un tablolarında zorunlu değildir.
  - `docs/muhendislik/veritabani.md` §4 ve `.claude/rules/veritabani.md`: daralt committinde güncellenir.
  - Test altyapısı: `test/support/pglite.ts`, `migrations.test.ts`.

### Test stratejisi

- **Aynı servis testleri öncesi ve sonrası geçer** (veritabani §4). Kapsanan dosyalar: `payments.test.ts`, `finance-contracts.test.ts`, ayrılış, yenileme, kesin kayıt, finans dışa aktarım, `finance-payer-scope.test.ts`, hatırlatma işi, `collections` ve `dashboard`. Her uç için 401, 403, başka kurum 404, 400 ve kaydın değişmemesi, mükerrer istek (`Idempotency-Key`).
- **Depo birim testleri:**
  - Her alanda core kaydı ↔ satır gidiş-dönüşü: eski kayıt, ek protokol, ayrılış, burs, onaysız ve onaylı sürüm.
  - Çevrilemeyen süzgecin programlama hatası olması.
  - `invoiceIds` sırasının korunması.
- **Kısıt testleri (PGlite):**
  - Onaylı ve iptal edilmiş sözleşmede donmuş kolon güncellemesi 55000 alır; `class_id` güncellemesi geçer.
  - Taksitte tutar ve vade güncellemesi 55000 alır.
  - İkinci açık ek protokol 23505 alır; zincirde yinelenen taksit numarası 23505 alır.
  - Kullanılmış taksiti ve sözleşmeyi silmek reddedilir; imha istisnası yalnız `delete`'i açar.
- **Migration testi:** örnek `records` verisiyle (eski kayıt, ek protokol, ayrılış borcu) kopyalama, ikinci koşunun etkisizliği ve eşlik karşılaştırması. Geri dönüş migration'ı (daralt sonrası) aynı veriyle denenir.
- **`test:pg`:**
  - Eşzamanlı iki tahsilat ve iki ek protokol yarışı (kısmi benzersiz indeks son güvence).
  - `not valid` + `validate` adımı.
  - Ölçüt 4 ölçümü (`EXPLAIN (ANALYZE, BUFFERS)`, commit gövdesinde).
- **E2E:** `pnpm test:e2e:react` içinde finans, sözleşme onayı (`contract-approval.spec.ts`), aile ödemeleri ve yenileme senaryoları değişmeden geçer. Vue e2e etkilenmez.
- **Kapsam:** API eşikleri 85/80 düşmez.

## Sonuçlar

- Bugün `records` kimliğine işaret eden iki bağ gerçek yabancı anahtar olur: tahsilat dağılımı ve ayrılış. Onaylı sözleşmenin değişmezliği jsonb farkı yerine kolonlarla korunur.
- Finans kuralları core'da kalır; Vue ve mobil demo değişmez. Seçenek C'ye (State dışı core) geçiş sonra da mümkündür; satırlar zaten tiplidir.
- Çalıştırıcıya ikinci bir depo türü girer. Bu, `records` dışındaki koleksiyonlar için de kullanılabilecek genel bir uzantıdır; yalnız bu iki koleksiyonda açılır.
- `paid_at` önbelleği ve `position` geçiş kolonları olarak kalır; ikisi de hesaplanabilen ya da core'a özgü değerlerdir ve ayrı kararla kalkar.
- `records` kimliklerinin `text` kalması ADR 0004'ün `uuid` kuralına istisnadır; bu iki tabloyla sınırlıdır.
- Kabul edilirse ADR 0006 karar 2 geçersiz olur. 0006'nın "Alternatifler" bölümündeki "Ertelendi" notu bu ADR'yle kapanır.

## Alternatifler

- **A · Beklemek**, **C · State dışı core** ve **D · `records`'ta kısıt**: yukarıdaki seçenekler. A ve D kısıt eksiğini kapatmaz. C, demo silinene kadar çift kod ister.
- **Ayrı `contract_versions` tablosu (sözleşme kökü + sürüm satırları).** Kök satırı öğrenci, yıl, ödeyici ve sınıfı tutar; sürüm satırı koşulları ve onayı tutar. Reddedildi:
  - Dış bağların hepsi sürüm kimliğine işaret eder; kök kimliği core'da yoktur, depo uydurmak zorunda kalır.
  - Sınıf arşivi yalnız bir sürümün `classId`'sini değiştirdiği için kök satırda tek `class_id` tutarsızlık üretir.
  - Onaylı sürümde `version` artışı için yine koşullu tetikleyici gerekir.
- **`invoiceIds`'i `invoices.contract_id`'den türetmek.** Ek protokolde korunan taksit iki sürüme bağlıdır, ayrılış ise onaylı sürümden taksit düşürür; bilgi kaybolur. Reddedildi.
- **`paid_at`'i hemen dağılımlardan türetmek.** Tahsilat satırı olmadan ödenmiş görünen eski kayıtlar bozulur, sahte tahsilat üretmek ise dekont numarası tüketir. Ertelendi (açık soru 4).

## Açık sorular

1. **Kurum büyüklüğü.** Pilot kurumun öğrenci sayısı ve taksit sayısı nedir? Ölçüt 1'in ne zaman karşılanacağı buna bağlıdır, karar buna bağlı değildir.
2. **Çift yazma süresi.** API yayına girmeden ON-046 biterse 3–5. adımlar tek migration'a sıkıştırılsın mı (veritabani §4), yoksa genişlet/daralt yine de en az bir teslim boyunca mı sürsün (veritabani §5)? Öneri: veri yayında değilse sıkıştırmak; ama 4. adımın geri alınabilir commit'i ayrı kalsın.
3. **Sözleşmesiz eski taksitler.** Ön denetimde hiçbir sözleşmeye bağlanamayan taksit çıkarsa ne yapılacak? Seçenekler: `contract_id` boş kalır (daralt `not null` olmaz), öğrencinin sözleşmesine yönetici kararıyla bağlanır ya da arşivlenir. Para kaybı riski olduğu için sahibin kararı gerekir.
4. **`paid_at` önbelleği.** Ne zaman kalkacak, eski ödenmiş kayıtlar nasıl ele alınacak? Seçenekler: göç tahsilatı (ayrı dekont serisi) ya da "sistem öncesi ödendi" işareti. ADR 0006 karar 3'ün devamıdır.
5. **Core dizi sırası.** Taksit sırası için `position` korunacak mı, yoksa core işlemleri `(due_date, installment, id)` sırasına mı bağlanacak? İkincisi core'da ayrı iştir.
6. **Kesin kayıt sözleşmesinin taksitleri onaydan önce değişebilir mi?** Bugün değiştiren işlem yok; tetikleyici bunu her durumda kilitliyor. Ön büronun onaydan önce plan düzeltmesi isteniyorsa ek protokol dışında bir yol gerekir (DOM-FIN-010 yalnız onaylıyı kilitler).
7. **Çalıştırıcı değişikliğini kim yapacak?** Oğuzhan mı yapacak (issue), yoksa Onur bu dosyalar için `alan-izni` mi alacak? Sahiplik konusu olduğu için birlikte karar verilmelidir.

## ON-046 iş listesi

Her parça ayrı görev satırı ya da alt adım olabilir. Migration numarası iş başında sıradaki numaradır, satırın Not'una yazılır.

| Parça | İş                                                                                                                                                                                     | Sahip                             | Bağımlılık              | Boyut |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------- | ----- |
| 046a  | Ön denetim betiği ve `test:pg` ölçümü: sayımlar, ölçüt 4 yükleme süreleri, sonuç Not'a                                                                                                 | Onur                              | —                       | S     |
| 046b  | Çalıştırıcı ve depo kaydı (`CollectionStore`, bağımlılık sırasıyla yazma), `records` varsayılanı için regresyon testi                                                                  | Oğuzhan (issue) ya da izinle Onur | açık soru 7             | M     |
| 046c  | Genişlet migration'ı: üç tablo, kısıtlar, indeksler, tetikleyiciler, `COMMENT ON`, Drizzle şeması (`db/schema/invoices.ts`, `contracts.ts`), kısıt testleri                            | Onur                              | 046a                    | M     |
| 046d  | Depolar (`db/invoice-store.ts`, `db/contract-store.ts`): satır ↔ core kaydı, süzgeç çevirisi, gidiş-dönüş testleri                                                                     | Onur                              | 046b, 046c              | M     |
| 046e  | Kopyalama migration'ı ve çift yazma; eşlik testi, migration testi                                                                                                                      | Onur                              | 046d, açık soru 3       | M     |
| 046f  | Okuma geçişi: çalıştırıcı, finans servisleri, hatırlatma işi; `loadScope` daraltması (`invoice.pay`, `payment.reverse`, `student.withdraw`); ölçüm sonrası; `openapi:check` farksız    | Onur                              | 046e                    | M     |
| 046g  | Genel okuma ve pano depo üzerinden (`collection-reads.ts`, `dashboard.ts`), e2e React                                                                                                  | Oğuzhan (issue) ya da izinle Onur | 046f                    | S     |
| 046h  | Daralt: `records` yazımını durdur, satırları sil, 0056'yı kaldır, `payment_allocations`/`student_withdrawals` FK `not valid` + `validate`, `not null`; geri dönüş migration'ı denemesi | Onur                              | 046f, 046g, açık soru 2 | M     |
| 046i  | Belgeler: veritabani.md §4, `.claude/rules/veritabani.md`, DOM-FIN-010/012/030 "Kodda" satırları, `changes/` parçası (yalnız API; core değişmezse gerekmez)                            | Onur                              | 046h                    | S     |

Takip (ON-046 dışı): pano tahsilatının `payments`'tan hesaplanması (Oğuzhan), finans toplamlarının SQL'e indirilmesi (ölçüt 3), `paid_at` önbelleğinin kaldırılması (açık soru 4), sınıf arşivinde ek protokol `classId` tutarsızlığı (Oğuzhan, core), belge verisinde `invoiceIds`'siz düşüşün kaldırılması.
