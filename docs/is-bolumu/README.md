# İş bölümü

İki geliştirici (Oğuzhan Demirci ve Ahmet Onur Evis, bu belgede "Onur") Claude Code oturumlarıyla paralel çalışır. Bu belge her işin tek sahibini, iki tarafın birbirine sunduğu sözleşmeleri ve bağımlılıkları tanımlar. Kişisel görev tabloları [onur.md](onur.md) ve [oguzhan.md](oguzhan.md) dosyalarındadır; yeni makinede başlarken [ilk-kurulum.md](ilk-kurulum.md).

Canlı durum (kim ne üzerinde çalışıyor, neyi bitirdi, ne revizyonda) görev tablolarının Durum sütunundadır; oturumlar başlarken ve bitirirken yazar, oturum hook'u iki tabloyu özetler. Issue yalnız karşı taraftan iş isteği ve hata bildirimidir. Tarih, süre ve son gün yoktur; sıra D1–D5 dalgalarıyla gösterilir.

Git, dal ve ortak dosya kuralları burada tekrarlanmaz: [.claude/rules/ortak-calisma.md](../../.claude/rules/ortak-calisma.md) ve [docs/muhendislik/git-ve-surum.md](../muhendislik/git-ve-surum.md) §7.

## İlke

- **Tek sahip.** Her alan kümesinin tek sahibi vardır; bir kümenin işi iki kişiye bölünmez.
- **Uçtan uca.** Sahip kümenin core kuralını, API ucunu ve migration'ını, web ve mobil ekranlarını, PDF şablonlarını, bildirim metinlerini, alan belgesini ve testlerini birlikte yazar.
- **Platform tek elden.** Kimlik, yetki, denetim, bildirim, dosya, PDF motoru, KVKK altyapısı, tasarım sistemi, web kabuğu ve mobil kabuk Oğuzhan'dadır. Onur bunları yayımlanmış uç, kanca ve bileşenlerle kullanır, içlerine yazmaz.
- **Sözleşmeyle çalışma.** Diğer tarafın dosyasına yazılmaz. İhtiyaç değişiklik isteğiyle (issue) sahibine iletilir.
- **İzin yok, görünürlük var.** Herkes kendi alanında kimseye sormadan yazar, birleştirir ve gönderir. Karşı tarafa yalnız onun alanında bir şey gerektiğinde issue açılır; bu izin değil, iş isteğidir. Kurallara uyulup uyulmadığını kişiler değil repodaki kancalar denetler.
- **Kurum türü küme değildir.** Okul ve dil okulu her kümede birlikte yürür. Dil okulunun paket satışı finanstadır; kur ve grup kurum yapısındadır.

## Kümeler

140 ister maddesi on alan kümesine ve platforma dağıtıldı. Her kümenin modülleri, IST kimlikleri, dizinleri, PDF ve bildirimleri ile alan belgesi aynı kişidedir. IST sütunundaki sayılar madde sayısıdır.

| Küme                                 | Sahip                          | Ana konu                                            | IST |
| ------------------------------------ | ------------------------------ | --------------------------------------------------- | --- |
| K1 Kayıt ve CRM                      | Onur                           | Aday, kesin kayıt, yenileme, sınıf geçişi           | 12  |
| K2 Finans                            | Onur                           | Tarife, tahsilat, iade, paket, muhasebe             | 16  |
| K3 Kurum yapısı ve ders planı        | Oğuzhan                        | Kampüs, sınıf, kur, grup, kadro, program            | 10  |
| K4 Akademik değerlendirme ve devam   | Oğuzhan                        | Yoklama, not, karne, geçme kararı                   | 9   |
| K5 Ölçme ve öğrenci gelişimi         | Oğuzhan                        | Deneme, optik, etüt, rehberlik, hedef               | 5   |
| K6 İngilizce becerileri ve CEFR      | Oğuzhan                        | Görev, rubrik, seviye tespiti, CEFR                 | 24  |
| K7 İçerik ve kaynak havuzu           | Oğuzhan                        | Havuz, taksonomi, soru bankası, telif               | 13  |
| K8 İletişim ve veli                  | Oğuzhan                        | Duyuru, mesaj, randevu, veli onayı                  | 8   |
| K9 Ön büro ve okul yaşamı            | Onur (öneri B, karar bekliyor) | Talep, takvim, servis, yemek, kulüp                 | 3   |
| K10 Yayın, işletim ve kurum kurulumu | Onur (öneri A, karar bekliyor) | Sunucu, yedek, operatör paneli, mağaza              | 3   |
| Platform                             | Oğuzhan                        | Kimlik, yetki, KVKK, bildirim, dosya, PDF, kabuklar | 41  |

K9 ve K10 karar çıkana kadar Oğuzhan'dadır.

### K1 · Kayıt ve CRM (Onur, kesin)

- **Kapsam:** aday yaşam döngüsü, tanışma görüşmesi ve deneme dersi, kesin kayıt (tarife, kimlik, veli ve ödeyici, kampüs onayı), kayıt sözleşmesi ve onayı, kayıt yenileme, sınıf geçişi ve mezuniyet işlemi, dondurma ve ayrılış kaydı, yetişkin kursiyerin sözleşme tarafı olması, resmî kayıt listeleri, kayıt hunisi.
- **Menü:** Aday Öğrenciler, Tanışma Görüşmeleri, Kayıt İşlemleri, Kayıt Raporları, Kayıt Yenileme. Modüller `crm`, `renewal`.
- **IST:** Faz 1: 079, 091. Faz 1'e çekilen: 092, 100. Faz 2: 059, 082, 085, 088, 117. Bölünen: 007, 084, 134.
- **Dizinler:** core `lib/{prospects,prospect-form,enrollment}.ts`, `school-workflows.ts` içindeki renewal bloğu; API `routes/prospects*`, `services/prospects.ts`, `db/student-identities.ts`; web `pages/crm/`, sonra `pages/renewal/`; e2e `adaylar.spec.ts` ve kayıt senaryoları.
- **PDF ve bildirim:** kayıt sözleşmesi, yenileme sözleşmesi, öğrenci belgesi. Görüşme ve deneme dersi hatırlatması, kayıt onayı, yenileme daveti, sözleşme onay isteği.
- **Belge:** `kayit-ve-crm.md` (DOM-KAY); `dil-okulu.md` içinde Deneme dersi ve Kursiyer türleri bölümleri.
- **Sınır:** yılsonu geçme kararını K4 verir. Sınıf geçişini ve mezuniyeti Onur bu kararı okuyarak işler.

### K2 · Finans (Onur, kesin)

- **Kapsam:** ücret tarifesi ve ilanı, taksit, burs ve indirim, tahsilat ve dekont, cari ekstre, gecikme, ayrılışta iade, muhasebe aktarımı, kasa ve gün sonu, çevrim içi ödeme ve sanal POS, e-Arşiv, dil okulunda paket ve saat bakiyesi, öğretmen hakediş dökümü.
- **Menü:** Finans & Tahsilat, Tahsilat Takibi, Finans & Ödeme Planı, Ödeme Yap, Dekontlar, Sözleşmeler, Ödemelerim (yalnız web), Ayarlar içindeki ödeme ve banka sekmesi. Modül `finance`.
- **IST:** Faz 1: 078, 104, 105, 106, 110, 111. Faz 2: 087, 107, 108, 109, 112, 113, 114, 133. Faz 3: 089, 115.
- **Dizinler:** core `lib/{fee-tariffs,payments,withdrawals,finance-export}.ts`; API `routes/{payments,fee-tariffs,withdrawals,finance-exports}.ts`, migration 0016–0022; web `pages/finance/`, `settings/PaymentSettingsSection.tsx`; react-shared `use-{payment-commands,fee-tariffs,withdrawals,finance-exports}.ts`; mobil veli finans ekranları.
- **PDF ve bildirim:** dekont, taksit taahhütnamesi, cari ekstre, iade dökümü, gün sonu raporu. Vade yaklaşıyor, gecikme, tahsilat alındı, iade ödendi.
- **Belge:** `finans.md` (DOM-FIN), `dil-okulu.md` Paket bölümü (DOM-DIL-050–054), ADR 0006.
- **Sınır:** muhasebe rolünü platform tanımlar. Rolün finans yetkilerini Onur değişiklik isteğiyle belirler.

### K3 · Kurum yapısı ve ders planı (Oğuzhan)

- **Kapsam:** kampüs, sınıf ve derslik, kadro ve arşiv, akademik yıl ve dönem, dil okulunda kur, program ve grup, ders programı ve yedek öğretmen, birebir ders, telafi ve grup değişikliği, bekleme listesi ve grup açılışı.
- **Menü:** Kampüsler & Sınıflar, Eğitim Kadrosu, Program Yönetimi, Ders Programım; yeni kur ve grup ekranları.
- **IST:** Faz 1: 010, 011, 076, 077, 094. Faz 2: 083, 084 (telafi, grup değişikliği), 086. Faz 3: 090, 137.
- **Dizinler:** core `lib/school-management.ts`, planning bloğu; web `pages/management/`, ders programı sayfaları; mobil `Timetable.tsx`, `SchoolLists.tsx`.
- **Belge:** `dil-okulu.md` Seviye, kur ve program ile Grup bölümleri; `yetki-ve-kapsam.md` vekil öğretmen.
- **Onur'a sunar:** sınıf, kur, grup ve kapasite; akademik yıl, dönem ve öğretim günleri.

### K4 · Akademik değerlendirme ve devam (Oğuzhan)

- **Kapsam:** yoklama ve devamsızlık, mazeret, not ve sınav, MEB dönem ve yılsonu puanı, karne ve gelişim raporu, sınıf geçme kararı, dil okulunda devam şartı ve kur bitirme belgesi, erken uyarı, davranış takibi.
- **Menü:** Yoklama, Sınıflarım, Sınıf Analizi, Notlarım, Devamsızlığım, Akademik Takip, Akademik Gelişim, Öğretmen Görüşleri, İzin & Mazeret, Risk Altındaki Öğrenciler.
- **IST:** Faz 1: 072, 080, 081, 093, 095 (not ve sınav). Faz 2: 074, 121, 134 (not ve devamsızlık şablonu). Faz 3: 101.
- **Dizinler:** core `lib/grades.ts`, `domain.ts` içindeki yoklama ve not, `requests.ts` mazeret kısmı; web `pages/academic/`, `requests/Absence*`; mobil `Attendance.tsx`.
- **PDF ve bildirim:** karne, gelişim raporu, teşekkür ve takdir belgesi, kur bitirme belgesi. Anlık devamsızlık, mazeret sonucu.
- **Belge:** `akademik-olcme.md` (DOM-AKD-001–054), `dil-okulu.md` Devam ve Belgeler bölümleri, DOM-ILT-052, 053.
- **Onur'a sunar:** yılsonu sonuçları; ders saati ve yoklama özeti.

### K5 · Ölçme ve öğrenci gelişimi (Oğuzhan)

- **Kapsam:** deneme sınavı, optik değerlendirme, otomatik etüt, rehberlik dosyası, hedef ve gelişim planı, çalışma planı, kazanım raporu.
- **Menü:** Optik Değerlendirme, Otomatik Etüt, Deneme Sınavları, Sınav Analizi, Rehberlik & Takip, Hedef & Gelişim Planı, Çalışma Planı.
- **IST:** Faz 2: 096, 097, 098, 119, 136.
- **Dizinler:** core `lib/{assessment-automation,delimited-input,tutor-conflicts}.ts`, ilgili iş akışı blokları; API `routes/assessment.ts`; web `pages/assessment/`; mobil `OpticalScreen.tsx`, `TutoringScreen.tsx`.
- **Belge:** `akademik-olcme.md` Deneme ve optik (DOM-AKD-060–063), `iletisim-ve-veli.md` Rehberlik gizliliği, `optik-degerlendirme-etut.md`, `hedef-gelisim-plani.md`.

### K6 · İngilizce becerileri ve CEFR (Oğuzhan)

- **Kapsam:** okuma, dinleme, yazma ve konuşma görevleri, ödev ve quiz ataması, rubrik ve puanlama, ikinci puanlayıcı ve itiraz, kelime ve alıştırma, seviye tespiti, CEFR profili, kur geçiş kararı, beceri raporları.
- **Menü:** Ödevler & Değerlendirme, Quiz Oluştur, Ödevlerim, Quiz & Testler; yeni seviye tespiti, CEFR profili ve beceri panosu ekranları.
- **IST:** Faz 1: 042, 045, 047, 048, 051, 052, 056, 057, 058, 060, 062, 095 (ödev ve quiz), 118. Faz 2: 043, 044, 049, 053, 055, 061, 063. Faz 3: 046, 050, 054, 064.
- **Dizinler:** core `skills/`, `cefr/`; API `routes/{rubrics,task-assignments,task-attempts,task-submissions}.ts`; web `pages/tasks/`, `pages/learning/`; mobil `Quiz.tsx`, ses kaydı.
- **PDF ve bildirim:** ödev çalışma kâğıdı, değerlendirme formu, CEFR profil raporu. Görev atandı, son teslim yaklaşıyor, puan açıldı.
- **Belge:** `beceri-gelisimi.md` (DOM-BEC), `dil-okulu.md` Seviye tespiti ve Kur geçme bölümleri, ADR 0004.
- **Onur'a sunar:** aday için seviye tespiti oturumu; kur geçiş kararı.

### K7 · İçerik ve kaynak havuzu (Oğuzhan)

- **Kapsam:** kurum içerik havuzu, etiket taksonomisi, müfredat ve CEFR kataloğu, soru bankası, lisans ve telif, onay ve sürüm, içerikten etkinlik, materyal ve ders videoları, içerik analitiği.
- **Menü:** İçerik Havuzu, Materyal Kütüphanesi, Materyaller, Ders Videoları.
- **IST:** Faz 1: 030, 031, 033, 034, 035, 036. Faz 2: 032, 037, 038, 123. Faz 3: 039, 040, 139.
- **Dizinler:** core `content/`, müfredat ve soru bankası verisi; API `routes/{resources,resource-commands}.ts`; web `pages/content/`, materyal ve video sayfaları; mobil `Video*.tsx`.
- **Belge:** `kaynak-platformu.md` (DOM-KYN).

### K8 · İletişim ve veli (Oğuzhan)

- **Kapsam:** duyuru, mesajlaşma, randevu ve veli görüşmesi, Öğretmenime Sor, dijital veli onayı, bülten, anket, yanıt süresi raporu, mesaj çevirisi.
- **Menü:** Duyurular, Mesajlar, Randevu & Mesajlar, Etüt & Görüşmeler, Etüt Randevusu, Öğretmenime Sor, Soru Kuyruğu, SLA Raporu.
- **IST:** Faz 1: 066, 067, 070. Faz 2: 068, 069, 071, 120. Faz 3: 075.
- **Dizinler:** core `lib/{communication,communication-access,appointments,questions}.ts`; API `routes/{communication,appointments,questions}.ts`; web `pages/communication/`; mobil `Conversations.tsx`.
- **Belge:** `iletisim-ve-veli.md` (DOM-ILT; talep bölümü K9 ile gider), ADR 0005.

### K9 · Ön büro ve okul yaşamı (Onur, öneri B, karar bekliyor)

- **Kapsam:** şikayet ve talep, okul takvimi ve etkinlikler, okul servisi, yemek menüsü, kulüpler, giriş-çıkış ve teslim yetkisi, revir ve ilaç onayı.
- **Menü:** OKUL YAŞAMI kategorisi (Okul Takvimi, Okul Servisi, Yemek Menüsü, Kulüpler & Sosyal Gelişim), Şikayet & Talep, Şikayet & Talepler.
- **IST:** Faz 2: 099. Faz 3: 102, 103.
- **Dizinler:** `calendar`, `transport`, `meals`, `clubs` blokları; `requests.ts` talep kısmı (mazeret ayrı dosyaya ayrılır); web `requests/Request*`.
- **Belge:** `iletisim-ve-veli.md` Talep ve şikayet (DOM-ILT-080), DOM-ILT-051.
- **Gerekçe:** servis, yemek ve kulüp tarifede ek hizmet kalemidir (DOM-FIN-003); servis kaydı açılınca ek hizmet taksiti doğar. Ön büro menüsünün tamamı tek sahipte toplanır. Velinin talepleri çoğunlukla kayıt ve ödemeyle ilgilidir.
- **Şimdilik:** karar çıkana kadar Oğuzhan'da. Kabul edilirse D4'te Onur'a geçer.

### K10 · Yayın, işletim ve kurum kurulumu (Onur, öneri A, karar bekliyor)

- **Kapsam:** sunucu, alan adı ve TLS, dağıtım ve CI yayın işi, PostgreSQL yedeği ve geri dönüş provası, izleme ve log, güvenlik olayı kaydı, Türkiye'de barındırma, operatör paneli, yeni kurum kurulumu ve pilot verisinin aktarımı, Android ve iOS derleme, imzalama ve mağaza yayını.
- **IST:** Faz 1: 024. Faz 2: 012, 029. 124 ve 128'in yayın kısmı.
- **Dizinler:** `deploy/`, `scripts/{deploy,build-android}.sh`, `compose.yaml`, `.github/workflows/`, `docs/mobile-release.md`, yeni `docs/isletim/`.
- **Gerekçe:** demo.onurevis.com ve sunucusu Onur'dadır. İlk API yayını yaklaşıyor ve pilot kurulumu kayıt ile finans verisini taşır. Oğuzhan'ın makinesinde Android SDK yok. Kod üretimi paralel ajanlarla sürerken yayının ayrı ve sakin bir elde olması riski azaltır.
- **Şimdilik:** karar bekliyor. Kabul edilirse Onur sunucu hazırlığına D2'de başlar.

### Değerlendirilen ama önerilmeyen adaylar

- **Kurum ayarları:** önerilmez. Modül açma ve kapama, roller ve akademik yıl her kümenin dayandığı platform sözleşmesidir. Onur'un kendi ayar sekmesi (ödeme, banka) zaten ondadır.
- **İnsan kaynakları:** şimdilik önerilmez. Kadro, sınıf ve ders programı arşivde birlikte taşınır (K3). Hakediş dökümü K2'dedir. Personel özlüğü ve izin D5'te yeniden değerlendirilir.

## Bölünen IST maddeleri

Beş madde iki farklı veriyi kapsar. Her parça kendi verisinin sahibine gider; parçalar arasında sözleşme vardır.

| IST      | Onur'daki parça                                    | Oğuzhan'daki parça                         |
| -------- | -------------------------------------------------- | ------------------------------------------ |
| 007      | Öğrenci ve veli toplu aktarımı (K1)                | Davet ve personel aktarımı (platform)      |
| 084      | Kayıt dondurma (K1)                                | Telafi ve grup değişikliği (K3)            |
| 134      | e-Okul'dan öğrenci aktarımı (K1)                   | Not ve devamsızlık şablonu (K4)            |
| 116      | Finans ve kayıt pano kartları, yuvaya takılır      | Pano kabuğu, akademik ve iletişim kartları |
| 124, 128 | Mağaza derlemesi ve yayını (K10, A kabul edilirse) | Uygulama ve mobil kabuk                    |

## Platform

Platformun tek sahibi Oğuzhan'dır. Onur platformu yalnız sözleşme tablosundaki uç, kanca ve bileşenlerle kullanır; platform dosyalarına yazmaz. Eksik ya da hata için değişiklik isteği açar. Onur'u bekleten platform isteği Oğuzhan'ın kendi alan işinden önce gelir.

| Parça                             | Kapsam                                                                                                                                                                                                   | IST                                    | Dizinler                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Kimlik ve oturum                  | Better Auth, giriş, parola ve kaba kuvvet koruması, iki adımlı doğrulama, taze oturum, davet, personel aktarımı, kurumsal hesapla giriş                                                                  | 003, 007, 025, 026, 138                | `apps/api/src/auth.ts`, `pages/auth/`, `ReauthModal`                                                                  |
| Kurum, modül, rol ve kapsam       | Kurum türü ve izolasyon, modül açma ve kapama, rol ve kapsam, koordinatör ve ek roller, çoklu rol ve kurum, veli–öğrenci bağı ve velayet, yetişkin kursiyer kapsamı                                      | 001, 002, 004, 005, 006, 008, 009, 019 | core `lib/{authorize,scope,institution-modules}.ts`, `modules/`; API `plugins/`, `routes/{me,memberships,modules}.ts` |
| Denetim kaydı                     | Sunucu denetim kaydı, İşlem Geçmişi sekmesi                                                                                                                                                              | 014                                    | `lib/audit.ts`, `routes/audit-events.ts`                                                                              |
| KVKK altyapısı                    | Aydınlatma, amaç bazlı rıza, çocuğa uygun aydınlatma, özel nitelikli veri, saklama ve imha, ilgili kişi başvurusu, veri işleme sözleşmesi ve alt işleyenler, dışa aktarım maskesi                        | 016–018, 020–023, 028                  | Yeni privacy modülü: core, API, bileşen                                                                               |
| Bildirim altyapısı                | Bildirim merkezi, tercih ve sessiz saat, kanal yükseltme, uygulama içi, e-posta, SMS, push, İYS sorgusu                                                                                                  | 065, 073, 125, 131, 132, 135           | `feature/bildirim-merkezi` dalındaki core, API ve kancalar                                                            |
| Dosya ve medya                    | Depolama, imzalı bağlantı, kota, tarama, S3, medya akışı, mobilde yükleme ve ses kaydı                                                                                                                   | 027, 041, 126                          | `apps/api/src/storage/`, `routes/files.ts`, `useFileUpload`; ADR 0003                                                 |
| PDF motoru                        | Yerleşim, çizim, font, kurum başlığı ve markası. Şablonlar alan sahibindedir.                                                                                                                            | 013                                    | `lib/pdf/{layout,render,document-state}.ts`; şablonlar `lib/pdf/templates/<alan>.ts`                                  |
| Tasarım sistemi ve web kabuğu     | Tokenlar, shadcn bileşenleri, ortak liste bileşenleri, sidebar ve menü, Genel Bakış ve Çocuklarım kabuğu, pano kart yuvası, ayar sekme yuvası, okul iş akışı motoru, zamanlanmış rapor, İngilizce arayüz | 015, 116, 122, 127                     | `components/`, `pages/{dashboard,settings,workflows,shell}/`, `workflow-presentation.ts`                              |
| Mobil kabuk                       | Expo uygulaması, gezinme ve kategori ekranları, oturum, tema, push kaydı, önbellek, öğretmen hızlı işlemleri. Alan ekranlarını alan sahibi yazar.                                                        | 124, 128, 129, 130                     | `apps/mobile/` kabuğu, `Home`, `CategoryScreen`, `WorkflowScreen`                                                     |
| API çatısı ve paylaşılan paketler | `app.ts` iskeleti, hata biçimi, Idempotency ve If-Match, OpenAPI üretimi, `api-client`, `react-shared` çekirdeği, açık API ve webhook                                                                    | 140                                    | `apps/api/src/{app,errors,openapi}.ts`, `packages/{api-client,react-shared}`                                          |
| Geçiş                             | Vue'nun kaldırılması, demo kalıcılığının silinmesi, `apps/web-react` → `apps/web`                                                                                                                        |                                        | `apps/web/`, `stores/demo.js`, `demo-persistence.ts`                                                                  |

Platform bileşenleri (DataTable, form alanları, sağ panel, PDF önizleme) alan ekranlarında serbestçe kullanılır; davranış değişikliği istekle gelir.

- Kayıt formundaki rıza adımının tamamı Onur'dadır; rıza modelini, uçları ve `<ConsentStep>` bileşenini platform verir.
- Finans bildirimlerinin içeriği ve tetiklenmesi Onur'dadır; gönderim, kanal, tercih ve sessiz saati bildirim altyapısı uygular.

## Sözleşmeler

Sözleşme, sahibin diğer tarafa sunduğu uç, kanca, servis fonksiyonu ya da bileşendir. Dalga sütunu sözleşmenin hangi iş sırasında hazır olacağını gösterir (D1–D5; bkz. kişisel listeler). Uçların hepsi `/api/v1` altındadır.

Değişiklik isteği izin değil, iş isteğidir ve yalnız karşı tarafın alanında bir şey gerektiğinde açılır. İsteyen, alan sahibinin `sahip:` etiketiyle bir issue açar (ne gerekiyor, neden, örnek çağrı). Sahip isteği kendi sırasına koyar; karşı tarafı bekleten istek öne alınır. Kırıcı değişiklikte eski uç ya da alan, tüketen taraf geçene kadar korunur. Hata bildirimi aynı yoldan gelir, ek etiketi `bug` olur.

### Oğuzhan'dan Onur'a

| Sözleşme                                                                                                          | Ne için                                                                                   | Dalga                                       |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------- |
| Aydınlatma ve rıza: `GET /privacy-notices/:purpose`, `POST /consents`, geri çekme; `<ConsentStep>`, `useConsents` | Kayıt formundaki rıza adımı, adayın aydınlatması ve ticari ileti onayı (DOM-KAY-003, 004) | D1                                          |
| Bildirim gönderimi: `notify(tx, { type, recipients, data })`, alan başına tür dosyası                             | Finans ve kayıt bildirimleri                                                              | uygulama içi D1, e-posta D2, SMS ve push D3 |
| Dosya: `POST /files`, imzalı indirme, `useFileUpload`, amaç kaydı                                                 | Kimlik ve velayet belgesi, dekont eki, imzalı sözleşme taraması                           | hazır; S3 ve tarama D2                      |
| PDF motoru: `renderDocument(template, data)`, `DocumentTemplate` tipi, kurum başlığı                              | Dekont, sözleşme, taahhütname, ekstre alan dosyaları                                      | D1; mobil paket D3                          |
| Taze oturum: `requireFreshSession`, `<ReauthModal>`                                                               | Ayrılış, iade, tahsilat iptali                                                            | hazır; platforma D1                         |
| Yetki eylemi ve rol: `authorize.ts` eylem tablosunda Onur bloğu; muhasebe rolü                                    | Her yeni kayıt ve finans ucu; akademik veriyi görmeyen muhasebe                           | blok D1; muhasebe D3                        |
| Veli–öğrenci bağı: `linkGuardian(tx, …)`, velayet kısıtı                                                          | Kesin kayıt, kardeş kaydı, ödeyici                                                        | D1                                          |
| Akademik yıl ve dönem: `GET /academic-years`, öğretim günleri                                                     | Tarifenin eğitim yılı, yenilemenin hedef yılı, iadede gün sayımı                          | yıl, dönem D1; öğretim günü D3              |
| Sınıf, kur ve grup: `GET /classes`, `GET /courses`, `GET /groups` (kapasite, kampüs, düzey)                       | Kesin kayıtta sınıf seçimi, paket satışı                                                  | sınıf hazır; kur, grup D1                   |
| Pano ve ayar yuvaları: `dashboard-cards`, `settings-sections` kayıtları                                           | Finans ve kayıt kartları, ödeme ayarı sekmesi                                             | D1                                          |
| Mobil kabuk rotası: kategoriye ekran kaydı, API kancaları                                                         | Veli finans ekranları, sözleşme onayı                                                     | D2                                          |
| Seviye tespiti oturumu: `POST /placement-sessions` (aday kimliği, süreli bağlantı), sonuç okuma                   | Aday için seviye tespiti bağlantısı (IST-059)                                             | D3                                          |
| Ders saati özeti: `GET /lesson-hours` (kursiyer ve öğretmen bazında, iptal ve telafiyle)                          | Paket bakiyesi, hakediş, e-Özel listesi                                                   | D3                                          |
| Kur geçiş kararı: `GET /level-decisions`                                                                          | Kur yenileme ve üst kur teklifi                                                           | D3                                          |
| Yılsonu sonuçları: `GET /year-end-results` (geçti, kaldı, sorumlu, mezun olabilir)                                | Sınıf geçişi ve mezuniyet                                                                 | D4                                          |
| Denetim kaydı: `audit.record(tx, …)`                                                                              | Her yazma işlemi                                                                          | hazır                                       |

### Onur'dan Oğuzhan'a

| Sözleşme                                                                                                             | Ne için                                                                      | Dalga |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----- |
| Finans özeti: `GET /finance-summary` (tahsil edilen, vadesi geçen, açık tutar; dönem kırılımı)                       | Yönetici panosu, erken uyarı (IST-121)                                       | D1    |
| Öğrenci bakiyesi: `GET /students/:id/balance`, veli kapsamlı                                                         | Veli Genel Bakış ve Çocuklarım kartları, mobil veli ana ekranı               | D1    |
| Pano kartları: finans ve kayıt kart bileşenleri, yuvaya kayıtlı                                                      | Yönetici ve ön büro Genel Bakış                                              | D2    |
| Kayıt durumu ve olayları: öğrencinin `enrollmentStatus` alanı (aktif, dondurulmuş, ayrıldı, mezun) ve geçiş olayları | Sınıf listeleri, yoklama, görev hedefleri, mesaj kapsamı, bildirim alıcıları | D2    |
| Kimlik okuma: `GET /students/:id/identity` (maskeli, yetkili, denetimli)                                             | İlgili kişi başvurusu dökümü (IST-022), e-Okul şablonu                       | D3    |
| Paket bakiyesi: `GET /students/:id/package-balance`                                                                  | Birebir ders planlama (IST-083), kursiyer ana sayfası                        | D4    |
| Ek hizmet aboneliği: `student_services` (servis, yemek, kulüp kalemi)                                                | K9 Oğuzhan'da kalırsa okul yaşamı ekranları                                  | D4    |

## Bağımlılıklar

Kritik yollar: rıza → kayıt formu → pilot; bildirim → SMS → gecikme hatırlatması; Vue'nun kaldırılması → demonun silinmesi → ilk yayın. Bekleyen taraf durmaz: sözleşme gelene kadar geçici veriyle kendi tarafını yazar, sözleşme gelince bağlar.

| Bekleyen iş                                                              | Önce gelmesi gereken                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Kayıt formunda rıza adımı (Onur)                                         | Rıza uçları ve `<ConsentStep>` (Oğuzhan)                        |
| Finans bildirimleri (Onur)                                               | `notify()` (Oğuzhan)                                            |
| Pano finans kartları ve risk listesi (Oğuzhan)                           | `finance-summary` (Onur)                                        |
| Tarifede yıl seçimi, iadede gün sayımı (Onur)                            | Akademik yıl, öğretim günleri (Oğuzhan)                         |
| Kesin kayıtta veli bağı (Onur)                                           | `linkGuardian` (Oğuzhan)                                        |
| Paket satışı (Onur)                                                      | Kur ve grup (Oğuzhan)                                           |
| İlk yayın                                                                | Vue'nun kaldırılması, demonun silinmesi, sunucu ve yedek (A)    |
| Sınıf listeleri, yoklama, görev hedefleri kayıt durumunu izler (Oğuzhan) | Kayıt durumu ve olayları (Onur)                                 |
| Gecikme hatırlatması SMS'le (Onur)                                       | SMS kanalı (Oğuzhan)                                            |
| Pilot canlı                                                              | VİS ve hukukçu görüşü, pilot verisinin aktarımı, SMS ve e-posta |
| Çevrim içi ödeme (Onur)                                                  | Ödeme sağlayıcı kararı                                          |
| Aday için seviye tespiti bağlantısı (Onur)                               | `placement-sessions` (Oğuzhan)                                  |
| Paket bakiyesi, hakediş, e-Özel listesi (Onur)                           | `lesson-hours` (Oğuzhan)                                        |
| Mobil veli finans ekranları (Onur)                                       | Mobil kabuk rotası, mobil PDF paketi (Oğuzhan)                  |
| İlgili kişi başvurusu dökümü (Oğuzhan)                                   | Kimlik okuma (Onur)                                             |
| Birebir ders planlama (Oğuzhan)                                          | Paket bakiyesi (Onur)                                           |
| Kur yenileme ve üst kur teklifi (Onur)                                   | `level-decisions` (Oğuzhan)                                     |
| Sınıf geçişi ve mezuniyet (Onur)                                         | `year-end-results` (Oğuzhan)                                    |

## Karar bekleyenler

Kararlar birlikte alınır. Sağ sütun kararın hangi işi beklettiğini gösterir.

| Konu                                                      | Öneri                                                                                           | Bekleyen iş                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------- |
| Platformun sahibi                                         | Oğuzhan. Onur'un onayı gerekiyor.                                                               | Bu belgenin yürürlüğe girmesi    |
| Ek küme A: Yayın, işletim ve kurum kurulumu               | Onur'a verilsin. Gerekçe K10'da.                                                                | Sunucu hazırlığı (D2)            |
| İlk yayının türü                                          | Örnek kurumlarla kapalı yayın, gerçek kişisel veri yok. Gerçek veri pilotla gelir.              | İlk yayın (D2)                   |
| `main`'e PR akışı ve CODEOWNERS                           | Vue kaldırıldığında başlasın; PR'ı alanın sahibi birleştirsin.                                  | Vue'nun kaldırılması (D2)        |
| Pilot kurumlar                                            | Önce özel okul, bir dönem başında; sonra dil okulu, bir kur başında. İster listesi 7.1'e uygun. | Pilot (D3)                       |
| Ödeme sağlayıcısı                                         | ADR olarak yazılsın; ADR 0001'deki "dış SaaS eklenmez" kararıyla uzlaşması gerekçelendirilsin.  | Çevrim içi ödeme (D4)            |
| Android derleme ve imzalama                               | A kabul edilirse Onur'un makinesi; değilse EAS bulut derlemesi. İmza anahtarı repoya girmez.    | Mağaza sürümü (D4)               |
| Nakit tahsilat ve iade tabanı                             | ADR 0006'daki doğrulanmalı maddeler pilot öncesi hukukçuya sorulsun.                            | Pilot (D3)                       |
| Kampüs'ün KVKK rolü, ses kaydı, push'ta yurt dışı aktarım | Aynı hukukçu görüşmesinde sorulsun.                                                             | Pilot (D3)                       |
| Mobilde çevrim içi ödeme                                  | Web'de çalıştıktan sonra; öğrenci ödemeleri telefonda yine gösterilmez.                         | Mobil veli finans ekranları (D4) |
| Ek küme B: Ön büro ve okul yaşamı                         | Onur'a verilsin. Gerekçe K9'da.                                                                 | Talep ve okul yaşamı işleri (D4) |
| İnsan kaynakları kümesi                                   | Şimdilik yok. D5'te yeniden bakılsın.                                                           | —                                |

Kapanan iki soru: kayıt yenileme, sınıf geçişi ve mezuniyet işlemi K1'dedir, geçme kararı K4'tedir. Kimlik tablosu K1'dedir; maskeleme ve dışa aktarım yetkisi platformdadır (IST-028).

## Çalışma düzeni

Kimse kendi alanındaki iş için karşı taraftan onay beklemez. Ayrı rapor, günlük not ya da sabit toplantı yoktur; görev tablolarının Durum sütunu kimin neyle uğraştığını gösterir. Görüşme gerektiğinde yapılır.

| Durum                                    | Ne yapılır                                                                                                                       | Karşı taraf beklenir mi |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Kendi alanında iş                        | Satır `çalışılıyor` olur; yazılır, doğrulanır, entegrasyona birleştirilir, gönderilir; satır `bitti` ve birleştirme hash'i olur. | Hayır                   |
| Ortak dosya                              | Herkes kendi bloğuna yazar. Blok dışına çıkan, görev satırının Not'una yazar.                                                    | Hayır                   |
| Migration, ADR, kural kimliği            | Numara görev satırının Not'una yazılır ve kullanılır.                                                                            | Hayır                   |
| Bağımlılık ekleme                        | Eklenir, commit mesajında belirtilir.                                                                                            | Hayır                   |
| Karşı tarafın alanında bir şey gerekiyor | Onun `sahip:` etiketiyle issue açılır; o kendi sırasına koyar. Bu arada geçici veriyle kendi tarafı yazılır.                     | Yalnız o parça          |
| Entegrasyonu kıran hata                  | Kıran düzeltir ya da geri alır. Sahibe ulaşılamıyorsa gören düzeltir, issue'ya not düşer.                                        | Hayır                   |
| Sahiplik ya da kural değişikliği         | Konuşularak karar verilir; alan haritası ve kurallar aynı commit'te güncellenir.                                                 | Evet                    |
| Karar listesindeki konular               | Ürün, hukuk ve maliyet kararları birlikte alınır.                                                                                | Evet                    |

Claude oturumları kuralları `CLAUDE.md` ve `.claude/rules/ortak-calisma.md` üzerinden kendiliğinden yükler. Oturum diğer tarafın alanına yazmaz; gerekirse durur ve değişiklik isteği taslağı yazar.
