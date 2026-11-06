# Kayıt ve CRM

Aday (lead) yakalamadan kesin kayda, yenilemeye ve ayrılışa kadar öğrenci/kursiyer yaşam döngüsü. Finansal sonuçlar [finans.md](finans.md), dil okuluna özgü seviye tespiti ve paketler [dil-okulu.md](dil-okulu.md) içindedir. **Doğrulanmalı** maddelerin hukukçu (H-) ve mali müşavir (M-) soruları ile kullanıcı kararları [finance-dogrulanacak-sorular.md](finance-dogrulanacak-sorular.md) içindedir.

## Aday yaşam döngüsü

Aşamalar: `Yeni aday → İletişime geçildi → Görüşme planlandı → Teklif verildi → Kayıt oldu | Vazgeçti`. Dil okulunda `Görüşme planlandı` yerine `Seviye tespiti / deneme dersi planlandı` kullanılır.

### DOM-KAY-001 · Aday bir kişidir, kayıt bir sözleşmedir

- **Kural:** Aday kaydı öğrenci kaydı değildir; aday hiçbir akademik veya finansal kayıt üretmez. Öğrenci/kursiyer, sözleşme ve taksit planı yalnız "kesin kayıt" işleminde, tek atomik işlemde oluşur.
- **Gerekçe:** Satış hunisindeki kişi silinebilir/anonimleştirilebilir olmalı; öğrenci kaydı ise yasal saklama süresine tabidir.
- **Kaynak:** İşletme kuralı; KVKK md. 4 (amaçla sınırlılık).
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/enrollment.ts` (`enrollProspect` öğrenci, veli, taksit ve sözleşmeyi birlikte yazar); API `POST /api/v1/prospects/:prospectId/enroll` (`apps/api/src/routes/prospects.ts`, `services/prospects.ts`) hepsini adayın `Kayıt oldu` durumuyla kurum kilidi altında tek transaction'da yazar; yazım yarıda başarısız olursa hiçbir kayıt değişmez.

### DOM-KAY-002 · Aday tekilliği

- **Kural:** Aynı kurumda aynı normalleştirilmiş telefon veya e-posta ile açık (Kayıt oldu/Vazgeçti dışı) ikinci aday açılamaz; mevcut aday kartına yeni temas (not) eklenir. Kardeş adaylar aynı veli telefonunu paylaşabilir; bu durumda tekillik anahtarı `telefon + aday adı` olur.
- **Gerekçe:** Mükerrer aday, mükerrer arama ve yanlış dönüşüm oranı üretir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`findProspectDuplicate`, `createProspect`, yeniden açmada `changeProspectStage`; kardeş ayrıntısı `DOM-KAY-031`); API `POST /api/v1/prospects` ve `PATCH /api/v1/prospects/:prospectId` (`apps/api/src/routes/prospects.ts`, `services/prospects.ts`) tekilliği kurumun bütün adaylarıyla kurum kilidi altında denetler (eşzamanlı iki istekten biri yazılır, `test:pg`). Çevrimdışı demo `apps/web/src/views/Crm.vue:139-158` mükerrer denetimi yapmaz. Siteye gömülen formda (ON-133) mükerrer reddedilmez: yanıt kişi varlığını belli etmesin diye aynı 202 döner, yeni aday açılmaz, mevcut açık adayın kartına sabit metinli temas notu düşer (24 saatte bir, aday başına en çok 20; iletişimi paylaşan farklı adda not ad ve ilgiyi taşır), ticari ileti onayı yazılmaz.

### DOM-KAY-003 · Aday iletişim verisi ve aydınlatma

- **Kural:** Aday formu kaydedilirken aydınlatma metninin gösterildiği (sürüm + zaman) saklanır. Aday veli adına giriliyorsa veli iletişim bilgisi tutulur, çocuğun verisi en aza indirilir (ad, hedef düzey/seviye, ilgi alanı).
- **Gerekçe:** Aydınlatma yükümlülüğü veri toplanırken yerine getirilir; ispat yükü veri sorumlusundadır.
- **Kaynak:** KVKK md. 10.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — aydınlatma sürümü ve anı (`privacyNotice`), 18 yaş altında veli adı ve en az veri `packages/school-core/src/lib/prospects.ts` (`createProspect`, `DOM-KAY-009`); kesin kayıtta veli zorunluyken (okulda her yaşta, kursta 18 yaş altında; `DOM-KAY-012`) adayın telefonu ve e-postası öğrenciye yazılmaz, öğrencinin kendi iletişimi yalnız isteğe bağlı `studentContact` ile yazılır; yeni veliye adayın e-postası, formdaki veli adı ve telefonu yazılır, mevcut velinin eksik telefonu ve e-postası adayınkiyle tamamlanır, var olan değer ve ad değişmez (`packages/school-core/src/lib/enrollment.ts` `applyEnrollment` `guardianContact`, `lib/enrollment.ts` `enrollProspectWithTariff`); yetişkin kursiyerin iletişimi kendisine yazılır. Veli telefonu, e-postası ve yakınlığı öğretmen ve öğrenciye dönmez (`lib/scope.ts`). Çevrimdışı demo `enrollProspect` yaşı bilmediği için eski davranıştadır. API `POST /api/v1/prospects` ve `POST /api/v1/prospects/:prospectId/enroll`, telefon/e-posta/veli adı log `redact` listesinde. Aday bilgisi düzeltme (KVKK md. 11 düzeltme hakkı): ön büro ve yönetici adayın talebiyle ad, telefon, e-posta, ilgi ve 18 yaş altında veli adını düzeltir (`updateProspectDetails`, yetki `prospect.update`; API `PATCH /api/v1/prospects/:prospectId/details`, `If-Match` zorunlu, web aday detayında "Bilgileri düzenle" paneli). Yalnız gönderilen alanlar değişir, değişiklik yoksa 409 `prospect_unchanged`; açık adayda mükerrer denetimi yeniden çalışır (kardeşliği seçilmiş aday ortak iletişimi kabul eder); onaylı e-posta silinemez (422 `consent_contact_in_use`), yetişkin adayda veli adı 422 `guardian_not_applicable`; aşama ve ticari ileti onayı değişmez, kesin kayda dönmüş adayın düzeltmesi öğrenci ve veli kaydına yansımaz; kayda yalnız düzeltilen alan adları yazılır (`profileEdits`). Aydınlatma metninin kendisi ve sürüm kaydı (metin deposu) yok: platformda aday kitlesi bulunmadığı için sürüm web'de sabittir (iş isteği #14). Siteye gömülen ön başvuru formu (ON-133) ön büro formundan farklı olarak metni yayımlı `aday` kitlesinden gösterir ve gönderilen sürüm güncel sürüm olmalıdır (eski sürüm 409 `notice_outdated`); yayımlı metin yoksa form açılamaz (422 `application_form_notice_missing`), açık uç 404 döner (`lib/prospect-application-form.ts`, `services/prospect-application-forms.ts`).

### DOM-KAY-004 · Pazarlama iletisi onayı

- **Kural:** Adaya kampanya, indirim, bursluluk sınavı duyurusu gibi tanıtım amaçlı SMS/e-posta/arama yalnız ticari elektronik ileti onayı varsa gönderilir; onay kanal bazında (SMS, e-posta, arama) ve ret hakkıyla saklanır. Randevu teyidi, sözleşme ve tahsilat bilgilendirmesi gibi hizmet iletileri onaya bağlı değildir.
- **Gerekçe:** Onaysız ticari ileti idari para cezası doğurur; İYS kaydı gerekir.
- **Kaynak:** 6563 sayılı Kanun md. 6 ve İYS düzenlemeleri — **doğrulanmalı** (H-21; eşik ve İYS kapsamı).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — onay kanal bazında, varsayılan onaysız ve anıyla saklanır (`marketingConsent`, `packages/school-core/src/lib/prospects.ts`). Ön büro ve yönetici adayın talebiyle onayı verir ya da anında geri alır (`setProspectMarketingConsent`, yetki `prospect.consent`; aşamadan bağımsızdır, vazgeçen ve kayıtlı adayda da yapılır); her değişiklik kalıcı olay olarak `marketingConsentHistory`'ye yazılır, aynı karar 409 `marketing_consent_unchanged`, e-postasız adayda e-posta onayı 422 `consent_contact_missing`. API `POST /api/v1/prospects/:prospectId/marketing-consent` (`If-Match` zorunlu), web aday detayında "Ticari ileti onayı" paneli. Gönderimde denetim için `hasMarketingConsent(prospect, kanal)` hazırdır, ama tanıtım iletisi gönderen işlem henüz yoktur. İYS bildirimi OG-108'dedir (dış servis); aday için platformda aydınlatma kitlesi ve rıza öznesi yoktur (iş isteği #14).

### DOM-KAY-005 · Aşama geçişleri

- **Kural:** `Kayıt oldu` aşamasına yalnız kesin kayıt işlemi geçirir; elle seçilemez. `Kayıt oldu` olan adayın aşaması değişmez. `Vazgeçti` seçilirken neden (fiyat, ulaşım, başka okul, akademik uygunsuzluk, diğer) zorunludur.
- **Gerekçe:** Dönüşüm raporu kayıtla tutarlı olmalı; kayıp nedeni satış stratejisinin girdisidir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`changeProspectStage`, `nextProspectStages`, `PROSPECT_LOST_REASONS`; ayrıntı `DOM-KAY-030`); `Kayıt oldu` yalnız `enrollProspect` (`packages/school-core/src/lib/enrollment.ts`) yazar; yalnız açık aday kayda alınır (`DOM-KAY-035`). API `PATCH /api/v1/prospects/:prospectId` (`If-Match` zorunlu). Çevrimdışı demo `apps/web/src/views/Crm.vue:174-186` vazgeçme nedeni sormaz.

### DOM-KAY-006 · Tanışma görüşmesi / deneme dersi çakışması

- **Kural:** Tanışma görüşmesi gelecek tarihli olur ve aynı kampüste aynı görevli/oda için zaman aralığı çakışamaz (tam saat eşitliği yetmez, süre dikkate alınır). Görüşme planlanınca aday `Görüşme planlandı` olur; görüşme yapılmadan aday `Teklif verildi` aşamasına geçebilir.
- **Gerekçe:** Ön büro kapasitesi sınırlıdır; yalnız başlangıç saati karşılaştırması 10:00–10:45 ile 10:30'u çakıştırmaz.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi (dil okulunda deneme dersi için bkz. `DOM-DIL-030`)
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`scheduleProspectMeeting`, süre ve oda/öğretmen çakışması, `tutorConflict`; ayrıntı `DOM-KAY-033`); API `POST /api/v1/prospects/:prospectId/meetings`. Çevrimdışı demo çelişiyor: `apps/web/src/views/Crm.vue:198-203` yalnız aynı kampüs ve birebir aynı başlangıç zamanını engeller.

### DOM-KAY-007 · Kaynak (lead source) zorunlu

- **Kural:** Her adayın kaynağı (web, veli referansı, kampüs ziyareti, telefon, bursluluk sınavı, sosyal medya, kurumsal anlaşma) zorunludur ve kayıttan sonra değiştirilemez. Veli referansı seçilirse referans veren öğrenci/veli bağlanır (referans indirimi için bkz. `DOM-FIN-024`).
- **Gerekçe:** Pazarlama bütçesi kaynak bazlı dönüşümle ölçülür.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — sabit liste (`PROSPECT_SOURCES`) ve veli referansında referans öğrenci (`referrerStudentId`) `packages/school-core/src/lib/prospects.ts`; aday düzenleme işlemi olmadığı için değişmezlik kendiliğinden. Referans indirimi bağı (`DOM-FIN-024`) yok.

### DOM-KAY-008 · Aday saklama ve imha

- **Kural:** `Vazgeçti` aşamasındaki veya 12 ay temas görmeyen aday kayıtları, pazarlama onayı yoksa en geç bir sonraki periyodik imha döneminde anonimleştirilir; dönüşüm istatistiği için yalnız kaynak, aşama ve tarih kalır.
- **Gerekçe:** Kişisel veri işleme amacı ortadan kalkınca silinir/anonimleştirilir.
- **Kaynak:** KVKK md. 7; Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hâle Getirilmesi Hakkında Yönetmelik (periyodik imha süresi en fazla 6 ay) — **doğrulanmalı** (H-22). 12 ay işletme kuralıdır.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-KAY-009 · Aday kaydının asgari alanları

- **Kural:** Aday ad, kampüs, ilgi (hedef düzey/seviye, program), kaynak (`DOM-KAY-007`), telefon ve gösterilen aydınlatma metninin sürümüyle açılır; e-posta isteğe bağlıdır. T.C. kimlik no, doğum tarihi, adres, okul notu gibi veriler aday aşamasında alınmaz; kesin kayıtta istenir (`DOM-KAY-012`). 18 yaş altı adayda telefon ve e-posta velinindir ve veli adı zorunludur; yetişkin adayda veli verisi saklanmaz. `school` adayı her zaman 18 yaş altı sayılır; okul dışındaki türlerde (`language_school`, `course_center`; ADR 0008 karar 5) adayın 18 yaş altı olup olmadığı açıkça seçilir, seçimi olmayan eski kayıt 18 yaş altı sayılır. Ticari ileti onayı (`DOM-KAY-004`) kanal bazında, varsayılan "onay yok" olarak kaydedilir; e-postası olmayan adaya e-posta onayı yazılmaz.
- **Gerekçe:** Aday satış hunisindedir; amaçla sınırlı ve ölçülü veri dışında veri işlemek gereksiz risk doğurur. Veli kuralı yaş bilinmeden uygulanamayacağı için bilinmeyen yaş en korumalı biçimde yorumlanır.
- **Kaynak:** KVKK md. 4/2-ç (amaçla bağlantılı, sınırlı ve ölçülü işleme), md. 10 (aydınlatma); 6563 sayılı Kanun md. 6 — **doğrulanmalı** (H-21; bkz. `DOM-KAY-004`).
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`createProspectSchema`, `createProspect`; yaş grubu kuralı `prospectAgeGroupRequired(type)`: okul dışındaki her türde `minor` yoksa 422 `prospect_age_required`, okulda `minor: false` 422 `prospect_guardian_required`; yetişkin adayda gönderilen veli adı saklanmaz); API `POST /api/v1/prospects` (gövde katı: kimlik no, doğum tarihi, adres 400; `Idempotency-Key` zorunlu). Web aday formu (`pages/crm/prospect-forms.ts`, `ProspectFormPanel.tsx`) "Yaş grubu" alanını aynı kuralla gösterir ve zorunlu tutar; yetişkin adayın gövdesine veli adı girmez (ON-292). Siteye gömülen ön başvuru formu (ON-133; IST-145): `GET /api/v1/prospects/application-forms/:formKey`, `POST …/submissions`, `GET …/frame-policy` oturumsuzdur, kurum iptal edilebilir form anahtarından çözülür; gövde katıdır, kaynak sunucuda `Web sitesi`dir, aday `Yeni aday` açılır (`submitProspectApplication`). Yönetici `GET/PATCH /api/v1/prospects/application-form` ve `POST …/rotate-key` ile anahtarı görür, yeniler, formu açar/kapatır, kurum sitesini yazar (migration 0065, `prospect_application_forms`); web `yonetici/kayit-islemleri` "Web başvuru formu" paneli ve `pages/crm/PublicApplicationFormPage.tsx`. Gönderim IP başına 10 dakikada 5, gövde 4 KB, gizli alan `website`.

## Kesin kayıt

### DOM-KAY-010 · Kontenjan

- **Kural:** Kesin kayıt, hedef sınıfın aktif öğrenci sayısı + aynı sınıfa planlanmış (henüz uygulanmamış) yenilemeler kapasiteye ulaştıysa reddedilir. Sınıf kapasitesi `school` için en fazla 30'dur (okul öncesi 20); kapasite ayarı bu tavanı aşamaz.
- **Gerekçe:** Mevzuat azami sınıf mevcudu koyar; planlanmış yenilemeler de yer tutar.
- **Kaynak:** ÖÖKY md. 48/1 (RG 3/8/2022 değişikliği: okul öncesi 20, diğer okullar 30).
- **Kurum türü:** `school` (dil okulu grup kapasitesi için `DOM-DIL-040`)
- **Kodda:** kısmen — kesin kayıt (`applyEnrollment`, `lib/enrollment.ts`) aktif öğrencileri ve aynı sınıfa planlanmış (`Planlandı`) yenilemeleri birlikte sayar, aynı öğrenci bir kez sayılır; uygulanmış yenileme yer tutmaz (ON-116). Kesin kayıt komutu bu yüzden `renewals` koleksiyonunu yükler (`modules/commands.ts`). Çelişen kalan: sınıf kapasitesi 40'a kadar girilebiliyor (`packages/school-core/src/lib/school-management.ts` `classSchema`; 30 tavanı iş isteğiyle).

### DOM-KAY-011 · Bir aday tek kesin kayıt

- **Kural:** Öğrenciye bağlanmış aday ikinci kez kayda dönüştürülemez. Aynı kişi (T.C. kimlik no veya yabancı kimlik no) aynı kurumda aynı eğitim yılı için ikinci aktif kayıt alamaz.
- **Gerekçe:** Mükerrer öğrenci = mükerrer borç.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var (API) — aday bazında `lib/domain.ts`, kişi bazında `student_identities_number_key` ve 409 `student_identity_duplicate`. Kural yıl der; yenilemede öğrenci kaydı aynı kaldığı için tekillik arşivlenmemiş kimliğe uygulanır, pasif kaydın kimliği yeniden kullanılır. Dil okulunda farklı programlara aynı anda kayıt (DOM-DIL) bu nedenle henüz yapılamaz. Kesin kayıt aynı işlemde `enrollment_completed` bildirimini yazar: 18 altında veliye, yetişkinde kursiyere; iletişim modülü kapalıysa yazılmaz (`notify`).

### DOM-KAY-012 · Kimlik ve yasal temsilci zorunlu alanları

- **Kural:** Kesin kayıtta öğrenci T.C. kimlik no (veya yabancı uyruklu kimlik no) ve doğum tarihi zorunludur. Veli kuralı kurum türüne göredir (kullanıcı kararı, 2 Kasım 2026):
  - **`school` (ortaokul ve lise):** en az bir veli (yakınlık derecesi, telefon) her yaşta zorunludur; öğrenci 18 yaşını doldurmuş olsa da. Doğum tarihinden hesaplanan 18 yaş veli zorunluluğunu kaldırmaz ve bu türde "veli alınmaz" reddi (`guardian_not_applicable`) yoktur. Adaydaki iletişim bilgileri velinin kaydında kalır, öğrenciye yazılmaz; öğrencinin kendi iletişimi istenirse ayrıca ve isteğe bağlı alınır. Ödeyici veli olabilir; öğrenci kardeşin mevcut velisine bağlanabilir (`DOM-KAY-013`).
  - **Kurs türleri (`language_school` ve sınav hazırlık kursu `course_center`: üniversiteye hazırlık, KPSS akademisi, LGS kursu; ADR 0008 karar 5):** 18 yaş ve üstü yetişkin sayılır; veli gerekmez, sözleşme tarafı, ödeyici ve iletişim kursiyerin kendisidir. 18 yaş altında okuldaki veli kuralı uygulanır.
  - **Veli hesabı:** Veli hesabını personel açar; veli kaydı girilir ve hesabın göreceği öğrenci seçilir (kullanıcı kararı, 2026-11-03, K-05). Yönetici ve ön büro kesin kayıt başarı ekranından ya da kayda dönmüş adayın ayrıntısından "Veli hesabı aç" ile açar (ON-290, `DOM-YTK-071`); kursiyerin kendisi seçilen kayıtta veli olmadığı için hesap açılmaz.
- **Gerekçe:** e-Okul/e-Özel kaydı ve sözleşmenin geçerliliği için yasal temsilci gerekir; reşit olmayanın sözleşmesini yasal temsilcisi yapar.
- **Kaynak:** 4721 sayılı Türk Medeni Kanunu (ergin olmayanın temsili) — **doğrulanmalı** (H-10); ÖÖKY md. 53/1 (Bakanlıkça belirlenen tip sözleşme; güncel metin **doğrulanmalı**, H-07).
- **Kurum türü:** ikisi
- **Kodda:** var (API) — `lib/enrollment.ts`, `POST /api/v1/prospects/:prospectId/enroll`; kursta (`course_center`) aynı kural çalışır, core'da kuralın adı `adultEnrollsWithoutGuardian(type)` (`lib/institution-types.ts`, OG-033) ve `isCourse` ile aynı sonucu verir (ON-292). Sözleşme başlığı türden gelir (`enrollmentContractTitle`): okulda "Özel okul eğitim sözleşmesi", dil okulunda "Dil kursu eğitim sözleşmesi", kursta "Özel öğretim kursu eğitim sözleşmesi". Sözleşme PDF'i (`apps/web-react/src/lib/pdf/templates/contract.ts`, `institutionType` seçeneği) okul dışındaki türlerde kayıtlı kişiyi "kursiyer" diye yazar (ADR 0008 karar 1). Kurs ücreti okul gibi düz öğrenim ücretidir; ders saati paketi yalnız dil okulundadır (`priceEnrollment`). Kayıt yenileme kursta yoktur (`DOM-YTK-012`): finans yenileme uçları ve iş akışı yenileme komutu 404, menüde Kayıt Yenileme görünmez; kimlik `student_identities` tablosunda, `GET /api/v1/students/:studentId/identity` maskeli döner ve her okuma denetim kaydına `student_identity.read` olarak yalnız alan adlarıyla yazılır (ON-063, DOM-YTK-052); web'de yönetici ve ön büro sözleşme panelinde "Kimliği göster" ile okur, açılışta okunmaz. Yakınlık `GUARDIAN_RELATIONSHIPS`'tir (`mother`, `father`, `legal_guardian` (vasi), `other`); ödeyici değeri (`payer: 'guardian' | 'student'`) ayrı alandır. 18 yaş doğum tarihinden, işlem anının Europe/Istanbul gününe göre hesaplanır (`lib/age.ts`, CEFR bildirimiyle ortak). Veli zorunluluğu `guardianRequired(institutionType, birthDate, now)`'dır: okulda her yaşta, kursta (`isCourse`: `school` dışındaki her tür) 18 yaş altında. Veli zorunluyken `guardian: null` 422 `guardian_required`; kursta yetişkin kursiyer ödeyicidir (`guardian: null`), veli verilirse 422 `guardian_not_applicable` (okulda dönmez); kurs adayının yaş grubu seçimi (`minor`) doğum tarihiyle uyuşmazsa 422 `birth_date_minor_mismatch` (okulda denetlenmez). Öğrencinin kendi iletişimi isteğe bağlı `studentContact` (`phone`, `email`) ile alınır ve yalnız öğrenciye yazılır. Veli varsa kesin kayıt veli–öğrenci bağını aynı işlemde `student_guardians`'a yazar (`enrollProspectWithTariff` `guardianBond`, API `enrollProspectCommand`; kural `planGuardianLink`): veli kaydına bağlı (hesapsız), yakınlık formdaki ya da mevcut velinin kayıtlı değeri (tanınmıyorsa `other`), velayet `full`, sözleşmenin ödeyicisi veli olduğu için `isPayer: true`, iletişim kısıtı ve teslim yetkisi kapalı; yetişkin kursiyerin kendisi veli değildir, bağ yazılmaz. Her bağ `guardian.link` olarak denetim kaydına alan adlarıyla yazılır. Öğrenci başına tek veli yazılır: ikinci (ayrı) veli kayıttan sonra `POST /api/v1/students/:studentId/guardians` ile eklenir; formda ikinci veli ve ödeyici seçimi yoktur. Mevcut veli kaydının etkin veli hesabı varsa yeni çocuğun bağı aynı işlemde o hesaba yazılır (`student_guardians.membership_id`) ve hesaba çocuk bağlantısı (`membership_links` `child`) eklenir; veli yeni çocuğu ayrıca bağlanmadan görür (ON-128, `db/enrollment-bonds.ts` `findParentAccount`). Hesap devre dışıysa ya da kayda birden çok hesap eşlenmiş görünürse bağ hesapsız kurulur. Web formu aynı kuralı `enrollmentFormSchema` içinde uygular (`allowedGuardianModes`): "Kursiyerin kendisi" yalnız kursta ve 18 yaş ve üstünde sunulur, doğum tarihi değişince veli seçimi buna uyar; yetişkin kursiyerin telefonu ve e-postası isteğe bağlı alanlardır (`studentContact`). Sunucunun `guardian_required` ve `guardian_not_applicable` reddi formda "Veli ve ödeyici" alanına bağlanır. Kurs adayının yaş grubu (`minor`) girilen doğum tarihiyle uyuşmazsa form uyarıyı gönderimden önce "Doğum tarihi" alanında gösterir ve sonraki adıma geçirmez (`pages/crm/enrollment-form.ts` `birthDateAgeGroupMismatch`, ON-126). Aday değişince önceki adayın kimliği, doğum tarihi, veli ve iletişim bilgisi formdan silinir (`prospectChangeValues`, ON-125). Veli hesabı (ON-290): web `apps/web-react/src/pages/crm/GuardianAccountPanel.tsx` kesin kayıtta yazılan veli kaydını (`parentId`; yeni velide yanıtın `parents` kaydı, mevcut velide seçilen kayıt) ve öğrenciyi seçili açar, ad ve e-posta veli kaydından dolar ve düzenlenebilir, veli kaydına bağlı kardeşler (`students?parentId=`) de seçilebilir; gövde `POST /api/v1/institution-members/guardian-invitations` (`studentIds`, `parentId`, `Idempotency-Key`, taze oturum) olarak gider. Kurumda kayıtlı e-posta (409 `member_exists`) alan hatasıdır ve yöneticiye yönlendirir: mevcut hesabı öğrenciye bağlayan web ekranı yoktur. Bekleyen veli davetleri ve iptal Kayıt İşlemleri sayfasında listelenir (`GuardianInvitationsSection.tsx`); iptal yalnız daveti kapatır, açılan hesap ve bağlar kalır. Saf kurallar `pages/crm/enrollment-guardian-account.ts`. Çevrimdışı demo `enrollProspect` eski davranıştadır.

### DOM-KAY-013 · Mevcut veliye bağlama (kardeş)

- **Kural:** Kesin kayıtta velinin telefonu/e-postası kurumda kayıtlı bir veliyle eşleşirse yeni veli açılmaz; öğrenci mevcut veliye bağlanır ve veli kardeş ilişkisini görür. Eşleşme ön büroya önerilir, otomatik birleştirilmez.
- **Gerekçe:** Kardeş indirimi, tek veli hesabı ve tek bildirim akışı aile bağına dayanır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var (API) — `GET /api/v1/prospects/:prospectId/guardian-matches` önerir, `guardian.existingParentId` bağlar. Eşleşme telefonla ya da kardeş adayla kurulur: velinin, öğrencisinin ya da öğrencisine dönüşmüş adayın telefonu (18 yaş altı öğrencinin telefonu boş kaldığı için, DOM-KAY-003); ayrıca adayın kardeş ağındaki (`siblingOfId` iki yönde ve zincir boyunca, DOM-KAY-031) kesin kayda dönmüş adayın velisi telefon farklı olsa da önerilir (ON-103; core `findParentMatches` `prospectId`). Her öneri kaynağını taşır (`match`: `sibling` ya da `phone`), kardeş önerisi listenin başındadır; yanıt ad ve öğrenci sayısı taşır, telefon ve e-posta dönmez (DOM-ILT-073). Ön büro kardeşin velisini seçerse yeni veli kaydı açılmaz, öğrenci aynı veli kaydına eklenir ve veli–öğrenci bağı aynı işlemde yazılır. Web formu kardeş önerisini "kardeş adayın velisi" diye ayırır, kendiliğinden seçmez. Yetişkin kursiyerin kendi kaydı için açılan satır `relationship: 'self'` taşır ve veli değildir; bu satır ve alan eklenmeden önce açılmış yer tutucu (telefonsuz, e-postasız, bütün adayları `minor: false`) öneriye girmez, `existingParentId` ile seçilirse 422 `parent_not_guardian` (`path: ['guardian']`) döner ve kayıt yazılmaz (`isNotGuardian`). Kesin kayıt bağı velayet sahibi ve ödeyici olarak kurduğu için bir öğrencisinde iletişim kısıtlı (`DOM-ILT-074`: kısıtlı veli velayetli ve ödeyici kaydedilemez) ya da velayeti olmayan (`DOM-ILT-070`, `DOM-ILT-071`: velayet belgesiz verilmez) veli de önerilmez; seçilirse aynı 422 `parent_not_guardian` döner, ileti kısıtın hangi öğrencide olduğunu söylemez (ON-105; core `hasNonCustodialBond`, bağlar API'de `student_guardians`'tan veli kimliğiyle okunur, `db/enrollment-bonds.ts`). Ortak velayetli bağ engel değildir. Hesabı personel açar ve öğrenciyi seçer (kullanıcı kararı, 2026-11-03; ON-290); hesap açıldıktan sonra aynı veli kaydına bağlanan kardeş hesaba kendiliğinden eklenir (ON-128, DOM-KAY-012'deki hesap bağı). Çevrimdışı demo her kayıtta yeni veli açar.

### DOM-KAY-014 · Düzeye uygun sınıf

- **Kural:** `school` kaydında öğrencinin hedef düzeyi sınıfın düzeyiyle aynıdır; 9. sınıfa kayıt için ortaokul diploması/öğrenim belgesi bilgisi, ara sınıfa naklen kayıtta önceki okul ve nakil tarihi tutulur.
- **Gerekçe:** Nakil ve düzey MEB kayıt kurallarına tabidir; naklen gelenin dönem puanı önceki okulun puanlarıyla hesaplanır.
- **Kaynak:** OKY md. 52 (naklen gelenlerin dönem puanı).
- **Kurum türü:** `school`
- **Kodda:** kısmen — kesin kayıt formu adayın ilgi metnindeki düzeyi okur ("7. Sınıf · Ortaokul" → 7; `pages/crm/enrollment-form.ts` `interestGrade`), o düzeydeki sınıfları listenin başına alır ve "önerilen" diye işaretler; başka düzeyde sınıf seçilirse uyarır, engellemez (ON-120). Adayda yapısal hedef düzey olmadığı için sunucu denetimi yok; 9. sınıf diploma bilgisi ve naklen kayıtta önceki okul/nakil tarihi tutulmaz.

### DOM-KAY-015 · Kaydın e-Okul/e-Özel karşılığı

- **Kural:** Platformdaki kesin kayıt MEB sistemindeki kaydın yerini tutmaz. Kayıt "MEB'e işlendi" durumu ve işleyen kişi/tarih ile ayrıca işaretlenir; işaretlenmemiş kayıtlar yönetici listesinde görünür.
- **Gerekçe:** Öğrenci, ücret ve burs bilgisi MEBBİS/e-Okul/e-Özel modüllerine işlenmek zorundadır; platform bu yükümlülüğü takip eder, devralmaz.
- **Kaynak:** ÖÖKY md. 55/3, 59/4, 63/3.
- **Kurum türü:** ikisi (dil okulu MEB lisanslıysa e-Özel)
- **Kodda:** yok.

## Yenileme, dönem geçişi, ayrılış

### DOM-KAY-020 · Yenileme planı ile sınıf geçişi ayrı işlemdir

- **Kural:** Yeni yıl yenilemesi (sözleşme + taksit) planlandığında öğrencinin güncel sınıfı değişmez. Sınıf, ayrı "dönem geçişi" işlemiyle ve yalnız öğrenci sınıf geçme kararı aldıktan sonra değişir (`DOM-AKD-040`).
- **Gerekçe:** Kayıt yenileme bahar aylarında, sınıf geçme kararı Haziran'da kesinleşir.
- **Kaynak:** İşletme kuralı; OİKY md. 31/2-b, OKY md. 57-58.
- **Kurum türü:** `school`
- **Kodda:** var — plan `POST /api/v1/finance/renewals` (`lib/renewals.ts` `planRenewal`; iş akışı köprüsü `runWorkflow('renewal')`), geçiş ayrı uç `POST /api/v1/finance/renewals/:renewalId/activate` (`runWorkflow('renewal-activate')`). Plan öğrencinin sınıfını değiştirmez. Sınıf geçme kararı denetimi yok (ON-081).

### DOM-KAY-021 · Yenileme tekilliği ve hedef düzey

- **Kural:** Bir öğrenci için aynı yıla tek yenileme açılır; planlanmış yenilemesi olan öğrenciye ikinci plan açılamaz. Hedef sınıf bir üst düzeydedir; sınıf tekrarı kararı varsa aynı düzeyde yenileme yapılabilir.
- **Gerekçe:** Mükerrer sözleşme ve taksit engellenir; sınıf tekrarı gerçek bir durumdur.
- **Kaynak:** İşletme kuralı; OİKY md. 31, OKY md. 58/1.
- **Kurum türü:** `school`
- **Kodda:** kısmen — tekillik ve hedef düzey `renewalPreconditions` (`lib/school-workflows.ts`; köprü ve tarifeli plan ortak); sınıf tekrarı yolu yok (yalnız +1, ON-081).

### DOM-KAY-022 · Mezuniyet

- **Kural:** Mezuniyet yalnız son düzeydeki (ortaokulda 8, lisede 12) öğrenci için ve mezuniyet koşulu sağlandığında uygulanır; yeni borç oluşturmaz. Mezun öğrencinin geçmiş not, devamsızlık ve tahsilat kayıtları salt okunur korunur; veli/öğrenci hesabı yalnız belgelerine erişir.
- **Gerekçe:** Ortaokul ve lise ayrı kurumlar olabilir; 8. sınıftan ayrılan öğrenci lise kaydına aday olur.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** `school`
- **Kodda:** kısmen — `packages/school-core/src/lib/school-workflows.js:757-776` yalnız 12. sınıfa izin verir; 8. sınıf çıkışı yok.

### DOM-KAY-023 · Dönem geçişinde bağlı kayıtlar

- **Kural:** Dönem geçişinde açık çalışma görevleri ve rehberlik dosyaları yeni sınıfın aynı branş öğretmenine devredilir; kampüs değişiyorsa servis ataması kaldırılır ve eski kampüs kulüp üyelikleri `Ayrıldı` olur; ileri tarihli etüt varsa geçiş engellenir. Geçmiş kayıtlar taşınmaz, silinmez.
- **Gerekçe:** Sorumluluk boşluğu bırakılmaz; geçmiş değiştirilmez.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** `school`
- **Kodda:** var — `packages/school-core/src/lib/school-workflows.js:852-921`.

### DOM-KAY-024 · Kayıt dondurma ve ayrılış

- **Kural:** Öğrenci ayrılırken ayrılış tarihi, nedeni (nakil, taşınma, sağlık, ekonomik, memnuniyetsizlik, diğer) ve hedef okul tutulur; öğrenci pasifleşir, ileri tarihli etüt/servis/kulüp kayıtları sonlanır, iade hesabı `DOM-FIN-040` ile açılır. Dil okulunda kayıt dondurma (`DOM-DIL-052`) ayrılıştan ayrı bir durumdur.
- **Gerekçe:** Ücret iadesi ayrılış tarihine göre hesaplanır; neden verisi kayıp analizi için gerekir.
- **Kaynak:** ÖÖKY md. 56/3.
- **Kurum türü:** ikisi
- **Kodda:** var (API, ayrılış) — `withdrawStudent` (`lib/withdrawals.ts`), `POST /api/v1/students/:studentId/withdraw`. Dil okulunda kayıt dondurma yok.

### DOM-KAY-025 · Borçlu öğrencinin kaydı yenilenmeyebilir

- **Kural:** Ders yılı sonunda ödenmemiş öğrenim ücreti borcu olan öğrencinin yenilemesi yöneticinin açık onayı olmadan planlanamaz. Borç, akademik kayıtlara (karne, not, belge) erişimi engellemek için kullanılmaz.
- **Gerekçe:** Mevzuat yenilememe hakkı verir; belge/karne alıkoyma hakkı vermez.
- **Kaynak:** ÖÖKY md. 55/2 (yenilememe ve resmî okula nakil); karne/belge alıkoyma yasağı işletme yorumu — **doğrulanmalı** (H-23).
- **Kurum türü:** `school`
- **Kodda:** var (API) — tarifeli yenileme planı (`lib/renewals.ts` `planRenewal`, `POST /api/v1/finance/renewals`) önceki eğitim yıllarından vadesi geçmiş ödenmemiş öğrenim ücretini taksit tablosu ve ödeme dağılımlarından hesaplar (`outstandingTuitionCents`; ek hizmet borcu sayılmaz, vadesi gelmemiş taksit borç değildir). Borç varsa `debtApproved: true` olmadan 422 `renewal_debt_unapproved`, onayı yönetici dışındaki rol verirse 403 `renewal_debt_approval_forbidden`; önizleme borcu `outstandingTuitionCents` ile döner, web formu uyarı ve yöneticiye onay kutusu gösterir (ON-057). Eski iş akışı köprüsü (`runWorkflow('renewal')`) bu denetimi yapmaz.

### DOM-KAY-026 · Kayıt durumu türetilir, geçişler olaydır

- **Kural:** Kesin kayıtlı öğrencinin kayıt durumu `Aktif`, `Ayrıldı` veya `Mezun`'dur. Kesin kayıt (`DOM-KAY-001`) öğrenciyi aktif açar; yenileme planı (`DOM-KAY-020`) durumu değiştirmez; dönem geçişi sınıfı değiştirir ve öğrenciyi aktif bırakır; mezuniyet geçişi (`DOM-KAY-022`) mezun, ayrılış (`DOM-KAY-024`) ayrıldı yapar. Ayrılışla iptal edilen yenileme ve uygulanmamış mezuniyet planı geçiş sayılmaz. Sınıf listesi, kontenjan, yoklama ve akademik bildirim yalnız aktif öğrenci içindir; ayrılan ve mezun öğrencinin finans bildirimi (borç taksiti, iade, sözleşme) sürer. Durum ayrıca saklanmaz, öğrencinin aktiflik bayrağından ve geçiş kayıtlarından okunur. Dil okulunda kayıt dondurma (`DOM-DIL-052`) geldiğinde dördüncü durum olur.
- **Gerekçe:** Durumu ayrıca saklamak, onu üreten kayıtla (ayrılış, dönem geçişi) ayrışabilen ikinci bir doğruluk kaynağı açar. Ödev, not ve devamsızlık bildirimi ayrılan aileye gitmemeli; borç ve iade bildirimi gitmelidir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var (core) — `packages/school-core/src/lib/enrollment-status.ts`: `enrollmentStatus(student, { renewals })` ve toplu `enrollmentStatuses(students, { renewals })` (`Map`; mezuniyetler bir kez indekslenir), sonuçlar `ENROLLMENT_STATUS_EFFECTS` (`roster`, `attendance`, `academicNotices`, `financeNotices`), etiketler `ENROLLMENT_STATUS_LABELS`; olaylar `enrollmentEvents(student, { renewals, withdrawals? })` (`enrolled`, `renewed`, `promoted`, `graduated`, `withdrawn`; eskiden yeniye) ve olay → durum tablosu `ENROLLMENT_EVENT_STATUS`. Öğrenciyi yalnız ayrılış (`withdrawStudent`) ve mezuniyet geçişi (`renewal-activate`) pasifleştirdiği için pasif öğrenci uygulanmış mezuniyeti (`renewals`, `Mezun`) varsa mezun, yoksa ayrıldıdır; `isActive` belirleyicidir. Ayrılış olayının günü `student_withdrawals.withdrawal_date`'tir; çevrimdışı State'te ayrılış kaydı yoktur, olay tarihsiz döner. Migration yok. Sınıf listesi, yoklama ve bildirim alıcılarının bu sonuçlara bağlanması Oğuzhan'ın alanındadır; bugün `isActive` okurlar (aynı sonucu verir). Test `tests/enrollment-status.test.ts`.

## Aday işlemleri (ön büro)

`DOM-KAY-002`, `-005`, `-006` ve `DOM-DIL-030`'un işlem düzeyindeki muhafazakâr yorumu. İşlemleri yalnız `yonetici` ve `onburo` yapar (yetki matrisi "Aday, tanışma görüşmesi"); modül `crm`.

### DOM-KAY-030 · Aşama geçiş tablosu

- **Kural:** Açık aşamalar (`Yeni aday`, `İletişime geçildi`, `Görüşme planlandı`, `Teklif verildi`) arasında yalnız ileri gidilir; aşama atlanabilir. Geri dönüş yoktur; tek istisna yöneticinin yanlışlıkla ileri alınan açık aşamayı gerekçeyle geri almasıdır: hedef, geçerli aşamadan önceki bir açık aşamadır, gerekçe zorunludur (2–300 karakter) ve aday kartında saklanır, `Görüşme planlandı` ancak adayın görüşmesi ya da deneme dersi varsa seçilir, görüşme öncesi aşamaya dönerken ileri tarihli görüşme ve deneme dersi kalkar (gerçekleşmiş olanlar kalır); vazgeçen ve kayıtlı aday geri alınmaz (vazgeçen aday yeniden açılır). Ön büro geri alamaz. `Görüşme planlandı` elle seçilmez, görüşme veya deneme dersi planlanınca girilir; `Kayıt oldu` yalnız kesin kayıtla girilir (`DOM-KAY-005`). `Vazgeçti` her açık aşamadan nedenle girilir; adayın ileri tarihli görüşmesi ve deneme dersi kalkar, gerçekleşmiş olanlar kalır. `Vazgeçti` aday yalnız `İletişime geçildi` aşamasına yeniden açılır, neden temizlenir ve açılış tekillik denetiminden (`DOM-KAY-002`) geçer.
- **Gerekçe:** Serbestçe geri alınabilen aşama dönüşüm raporunu bozar; bu yüzden istisna yalnız yöneticide, gerekçeli ve kayıtlıdır; vazgeçen adayın tuttuğu görüşme saati ve deneme yeri başkasına açılmalıdır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`nextProspectStages`, `changeProspectStage`); API `PATCH /api/v1/prospects/:prospectId` (`apps/api/src/routes/prospects.ts`). Geri alma `revertProspectStage`/`revertableProspectStages` (yetki `prospect.stageRevert`, yalnız yönetici; kayıt `stageReverts`) ve API `POST /api/v1/prospects/:prospectId/stage-revert` (`If-Match` zorunlu; 422 `prospect_stage_not_backward`, `prospect_meeting_required`; vazgeçen aday 409 `prospect_closed`, kayıtlı aday 409 `prospect_enrolled`); web aday detayında yönetici için "Aşamayı geri al" formu (`ProspectStageRevertForm`). Denetim kaydına gerekçe metni değil alan adı yazılır.

### DOM-KAY-031 · İletişimi paylaşan aday (kardeş)

- **Kural:** Aynı telefon veya e-postayı taşıyan açık aday varken: ad da aynıysa (boşluk ve büyük/küçük harf farkı gözetilmeden) yeni aday açılmaz; ad farklıysa yeni aday yalnız ön büro iletişimi paylaşan açık adayı kardeş olarak açıkça seçerse açılır. Kardeş seçimi aynı adın mükerrerliğini kaldırmaz. Vazgeçen aday yeniden açılırken iletişimi başka açık adayla paylaşıyorsa ön büro aynı kurumda iletişimi gerçekten paylaşan açık veya kayıtlı bir adayı kardeş seçer; seçilmezse yeniden açılmaz, seçilen kardeş adaya yazılır. Ret iletisi telefon, e-posta veya diğer adayın adını içermez.
- **Gerekçe:** `DOM-KAY-002` kardeşe izin verir ama yazım farkıyla aynı kişinin ikinci kez açılmasını da engellemelidir; açık onay en muhafazakâr yoldur.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`findProspectDuplicate`, `createProspect`, yeniden açmada `changeProspectStage` `siblingOfId`); API `POST /api/v1/prospects` ve `PATCH /api/v1/prospects/:prospectId`, ret eşleşen adayın kimliğini yanıta ve loga koymaz.

### DOM-KAY-032 · Aday notu eklenir, değişmez

- **Kural:** Aday kartına not yalnız eklenir; düzenlenmez ve silinmez. Notu yazan kişi ve an saklanır. `Kayıt oldu` veya `Vazgeçti` adaya not eklenmez; vazgeçen adayla yeni temas önce adayı yeniden açar (`DOM-KAY-030`). Not alanında özel nitelikli veri yazılmaması için form uyarı gösterir.
- **Gerekçe:** Temas geçmişi satış ve şikâyet incelemesinin kanıtıdır; kapalı adaya temas eklemek imha süresini (`DOM-KAY-008`) sessizce uzatır.
- **Kaynak:** İşletme kuralı; KVKK md. 6 (özel nitelikli veri).
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`addProspectNote`, `PROSPECT_NOTE_NOTICE`); API `POST /api/v1/prospects/:prospectId/notes` (yazar adı oturumdan, `If-Match` zorunlu, not metni loglanmaz).

### DOM-KAY-033 · Tanışma görüşmesi planlama

- **Kural:** Görüşme adayın kampüsünde, gelecek bir anda, 15–120 dakika süreyle ve bir odada yapılır; isteğe bağlı görevli öğretmen aynı kampüsün aktif öğretmenidir. Aynı kampüsteki başka adayın görüşmesiyle aynı oda veya aynı öğretmen için aralık örtüşemez; oda bilgisi olmayan eski görüşme kampüsün bütün odalarını tutuyor sayılır. Kayda alınmış veya vazgeçmiş adayın kalan ileri tarihli görüşmesi saati tutmaz. Öğretmenin dersi, randevusu, etüdü ve odanın ders/etüt/etkinlik kullanımı da çakışma sayılır. Yeniden planlama önceki görüşmenin yerini alır. Görüşme `Yeni aday`/`İletişime geçildi` adayı `Görüşme planlandı` yapar; `Teklif verildi` aday geri gitmez (`DOM-KAY-030`).
- **Gerekçe:** `DOM-KAY-006`'nın "görevli/oda" çakışması; bilinmeyen kaynak çakışıyor sayılır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`scheduleProspectMeeting`), çakışma `packages/school-core/src/lib/tutor-conflicts.ts`; API `POST /api/v1/prospects/:prospectId/meetings` (aynı odaya eşzamanlı iki görüşmeden biri yazılır, `test:pg`). Ön büro görevlisinin (kullanıcı) kendi çakışması yoktur (`TODO(crm-meeting-host)`).

### DOM-KAY-034 · Deneme dersi planlama

- **Kural:** Deneme dersi (`DOM-DIL-030`) yalnız `language_school`'da, adayın kampüsündeki açık grubun gelecek ve iptal edilmemiş gerçek dersine planlanır. "Program başına bir kez" aday kaydı başına bir kez olarak uygulanır: gerçekleşmiş deneme dersi tekrar planlanmaz, ileri tarihli olan değiştirilebilir; gerçekleşme dersin güncel kaydından okunur, iptal edilen veya programdan kalkan derse bağlı deneme yapılmamış sayılır. Derse en fazla iki deneme katılımcısı alınır; aktif kursiyer + deneme katılımcısı grup kapasitesini ve 18'i (`DOM-DIL-040`) aşamaz, tam 18 kabul edilir. Katılımcı ve kapasite sayımında yalnız açık adayların denemesi sayılır: kayda alınan aday kursiyer olarak bir kez sayılır, vazgeçenin yeri boşalır. 18 yaş altı (veya yaşı bilinmeyen) adayda veli adı, veli iletişim bilgisi ve ön büronun kaydettiği veli onayı zorunludur. Adayın görüşmesi ile deneme dersi örtüşemez. Deneme kaydı yoklamaya yazılmaz.
- **Gerekçe:** `DOM-DIL-030`'un kapasite ve veli onayı şartlarının en korumalı uygulanışı; seviye ve yaş bandı uygunluğu henüz veriyle denetlenemez.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 48/2.
- **Kurum türü:** `language_school`
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`scheduleTrialLesson`); API `POST /api/v1/prospects/:prospectId/trial-lessons` (okul kurumunda her rol için 404). Seviye ve yaş bandı uygunluğu (`DOM-DIL-041`) denetlenmez, ön büro seçimine bırakılır (`TODO(crm-trial-level)`; önkoşullar `DOM-DIL-030`'dadır). Öğretmenin deneme sonucu (`DOM-DIL-031`) core ve API'de vardır (`recordTrialResult`, `POST /api/v1/prospects/:prospectId/trial-result`); ekranı yoktur.

### DOM-KAY-035 · Kesin kayıt yetkisi ve açık aday şartı

- **Kural:** Adayı kesin kayda (öğrenci, veli, taksit planı, sözleşme) yalnız yönetici ve ön büro dönüştürür; işlem `crm` ve taksit ile sözleşme yazdığı için `finance` modülüne bağlıdır, ikisinden biri kapalıyken reddedilir. Yalnız açık aşamadaki (`Yeni aday`, `İletişime geçildi`, `Görüşme planlandı`, `Teklif verildi`) aday kayda alınır; `Vazgeçti` aday önce `İletişime geçildi` ile yeniden açılır (`DOM-KAY-030`), kayıtlı aday ikinci kez alınmaz (`DOM-KAY-011`), tanınmayan eski aşama reddedilir.
- **Gerekçe:** Kesin kayıt borç ve sözleşme doğurur; vazgeçen adayın doğrudan kaydı yeniden açılıştaki tekillik denetimini (`DOM-KAY-002`) atlatır.
- **Kaynak:** İşletme kuralı; yetki matrisi (`docs/domain/yetki-ve-kapsam.md`). Kâğıt (ıslak imzalı) rızanın personelce sisteme girilmesi **doğrulanmalı** (H-20).
- **Kurum türü:** ikisi
- **Kodda:** var (core) — `packages/school-core/src/lib/enrollment.ts` (`enrollProspect` açık aday şartı, 409 `prospect_closed`), yetki eylemi `prospect.enroll` (`packages/school-core/src/lib/authorize.ts`, `modules/commands.ts`). API `POST /api/v1/prospects/:prospectId/enroll` önce `requireAuthorized` çağırır, sonra core `enrollProspectWithTariff`'ı çalıştırır (`Idempotency-Key` ve `If-Match` zorunlu); `crm` veya `finance` modülü kapalıyken 403 `module_disabled` (kesin kayıt taksit ve sözleşme yazar), öteki roller 403, kapalı aday 409. Çevrimdışı demo çağıranları (`apps/web/src/views/Crm.vue`, `apps/mobile/src/model/operations.ts`) yetki denetlemez (`TODO(crm-enroll)`). Kesin kayıt rıza yazmaz ve rızayı beklemez (`DOM-YTK-057`, `DOM-YTK-061`): web `apps/web-react/src/pages/crm/EnrollmentConsentNotice.tsx` kayıttan sonra personele beklenen rızaları `GET /api/v1/consents/status` ile bildirir (ON-025). Yanıttaki `grantor` öğrenci kaydının doğum tarihinden hesaplandığı, kesin kayıt ise doğum tarihini yalnız `student_identities`'e yazdığı için yeni yetişkin öğrencide sunucu `guardian` döner; ekran kişiyi formdaki doğum tarihiyle düzeltir, sunucunun rıza kararı düzeltilene kadar bu öğrenci rıza veremez.

## API uygulama notları

Aday uçları (`apps/api/src/routes/prospects.ts`) core işlemlerinin varsaydığı koşulları sunucuda sağlar; kesin kayıt ucu da aynı düzendedir:

- `loadScope` aday komutlarında kurumun bütün adaylarını kurum kilidi altında yükler. Tekillik (`DOM-KAY-002`, `-031`), kardeş doğrulaması, görüşme çakışması ve deneme katılımcı/kapasite sayımı bütün adaylara bakar; kısmi yükleme veya kilitsiz okuma eşzamanlı iki isteğin aynı denetimi geçmesine yol açar. State yalnız etkin kurumun kayıtlarını taşır; kardeş "aynı kurumda" şartı buna dayanır.
- Not yazarının gösterilen adı (`authorName`) oturum kullanıcısından alınır; gövdeden okunmaz.
- `createProspect` ucu `Idempotency-Key` ister; aynı anahtarla yinelenen istek ikinci aday açmaz, ilk yanıtı döner.
- Mükerrer kayıt reddinde (`prospect_duplicate`, `prospect_contact_shared`) eşleşen adayın kimliği (`prospectId`) yanıta ve loga konmaz; yanıt yalnız kod, ileti ve alan yolunu taşır.
- Kesin kayıt ucu önce `requireAuthorized(actor, 'prospect.enroll', …)` çalıştırır (`DOM-KAY-035`); `If-Match` (aday sürümü) ve `Idempotency-Key` zorunludur, aynı anahtarla yinelenen istek ikinci öğrenci ve taksit yazmaz. Modül şartı `crm` ve `finance`'tır (`DOM-YTK-040`). Tutar gövdeden alınmaz, yayımlanmış tarifeden kuruş tamsayı olarak hesaplanır ve taksitlere kuruşu kuruşuna dağılır (`DOM-FIN-002`, `-011`). Taksit sayısı tarifede ilan edilen ödeme koşullarından çıkar, ilanda olmayan sayı 422 `payment_term_not_in_tariff`; sözleşme koşulun kopyasını taşır, koşulsuz eski tarifede sınır yoktur (`DOM-FIN-013`). Dil okulunda sözleşme başlığı "Dil kursu eğitim sözleşmesi"dir. Oluşturulan sözleşme yanıtın `records` listesinde (`contracts`) döner. Kimlik numarası, doğum tarihi ve veli iletişimi loglanmaz (`apps/api/src/app.ts` gizleme listesi).
- Kesin kayıtta sınıf adayın kampüsünden değilse 422 `class_campus_mismatch` (`path: ['classId']`, kontenjan denetiminden önce); başka kampüsün sınıfı yalnız açık onayla (`allowOtherCampus: true`) kabul edilir. Web formu bunu yalnız "Başka kampüsün sınıfını bilerek seçiyorum" kutusu işaretliyken gönderir; "Tüm kampüslerin sınıflarını göster" listeleme seçimi tek başına onay sayılmaz. Çevrimdışı demo (`enrollProspect`) her kampüsün sınıfını listelediği için seçimi bilinçli sayar.
- Görüşme ve not uçları `If-Match` (kayıt sürümü) ister; eski sürümle gelen istek `version_conflict` ile reddedilir, aynı adayın görüşmesi veya notu sessizce üzerine yazılmaz.

## Mevcut kodla farklar

| Kural       | Fark                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM-KAY-006 | Çevrimdışı demoda tanışma görüşmesi çakışması yalnız aynı başlangıç anını yakalar (`apps/web/src/views/Crm.vue:198-203`); core (`lib/prospects.ts`) süreyi ve oda/görevliyi denetler. |
| DOM-KAY-010 | Sınıf kapasitesi 40'a kadar girilebilir (`packages/school-core/src/lib/school-management.ts` `classSchema`), ÖÖKY tavanı 30.                                                          |
| DOM-KAY-021 | Sınıf tekrarı için aynı düzeyde yenileme yapılamaz (`packages/school-core/src/lib/school-workflows.js:779`).                                                                          |
| DOM-KAY-022 | 8. sınıf çıkışı/mezuniyeti tanımlı değil (`packages/school-core/src/lib/school-workflows.js:758`).                                                                                    |
