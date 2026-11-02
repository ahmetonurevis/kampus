# Kaynak platformu

Kurumun kendi ders ve beceri kaynaklarını ürettiği, etiketlediği, onayladığı ve sınıflarına dağıttığı kütüphane. Amaç yayınevi ve üçüncü taraf dijital platform bağımlılığını azaltmaktır; bu yüzden kurallar hem telif riskini hem "kurum özgün içerik" oranını ölçülebilir kılar. İçeriğin öğrenciye görev olarak verilmesi ve puanlanması [beceri-gelisimi.md](beceri-gelisimi.md), not etkisi [akademik-olcme.md](akademik-olcme.md), kim neyi görür sorusu [yetki-ve-kapsam.md](yetki-ve-kapsam.md) içindedir.

Bugünkü kodda kaynaklar `materials`, `videos`, `bank` (soru bankası), `quizzes` ve `homework` koleksiyonlarına dağılmış durumdadır; ortak kaynak kaydı, lisans, onay ve sürüm kavramları yoktur. Kaynak, sürüm, lisans, onay ve görünürlük kuralları ADR 0004 ile school-core'a geldi (`packages/school-core/src/content/`: `taxonomy.ts`, `resource.ts`, `visibility.ts`, `copy.ts`); ilişkisel tablolar, API ve ekranlar henüz yoktur.

## İçerik modeli

### DOM-KYN-001 · Kaynak kurumun kaydıdır

- **Kural:** Her kaynak tek bir kuruma (`institution_id`) ve bir sahibe (oluşturan öğretmen veya yönetici) aittir. Öğretmenin görevi gereği ürettiği kaynak üzerindeki mali hakları, iş sözleşmesinde aksi yazmıyorsa kurum kullanır; öğretmen kurumdan ayrıldığında kaynak kurumda kalır (bkz. `DOM-KYN-052`).
- **Gerekçe:** Kurumun kendi kaynak havuzu ancak içerik kişiye değil kuruma bağlıysa birikir.
- **Kaynak:** 5846 sayılı FSEK md. 18/2 ("memur, hizmetli ve işçilerin işlerini görürken meydana getirdikleri eserler üzerindeki haklar bunları çalıştıran veya tayin edenlerce kullanılır"; RG 13/12/1951-7981, mevzuat.gov.tr konsolide metin). Öğretmen iş sözleşmelerinin bu konuda ne yazdığı **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `materials` ve `videos` kayıtlarında `teacherId` var (`packages/school-core/src/data/seed.js:457-527`); kurum kimliği yok. Core kuralı (ADR 0004; ekran sonra): `packages/school-core/src/content/resource.ts` (`planNewResource`: sahip ve yazar işlemi yapan kişi); kurum kimliği servis ve tablo kolonudur. API: `POST /api/v1/resources` (`apps/api/src/services/resource-commands.ts`); kurum kimliği oturumdan gelir, gövdedeki `institutionId` atılır; `resources` tablosu kurum kapsamlı (`apps/api/src/db/schema/resources.ts`).

### DOM-KYN-002 · İçerik türleri

- **Kural:** Kaynak türü sabit listeden seçilir: `metin`, `okuma parçası`, `ses`, `video`, `çalışma kâğıdı`, `soru`, `quiz`, `ödev şablonu`. Türün zorunlu alanları:
  - **metin / çalışma kâğıdı:** başlık, gövde veya dosya, hedef süre.
  - **okuma parçası:** gövde metni, kelime sayısı (sistem hesaplar), tek bir düzey/CEFR seviyesi, en az bir anlama sorusu bağlantısı önerilir.
  - **ses / video:** dosya, süre, döküm veya altyazı (`DOM-KYN-003`).
  - **soru:** kök, doğru cevap, seçmeli ise en az üç çeldirici, çözüm açıklaması, kazanım/beceri etiketi.
  - **quiz:** soruların sürüm referanslı listesi, süre, deneme hakkı (bkz. `DOM-BEC`), puanlama yöntemi.
  - **ödev şablonu:** yönerge, teslim türü (dosya, metin, ses kaydı), değerlendirme ölçütü veya rubrik.
- **Gerekçe:** Tür, hangi alanın denetleneceğini ve öğrenciye nasıl sunulacağını belirler; serbest "Doküman/Video" ayrımı beceri çalışmasına yetmez.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — materyal formu yalnız `Doküman` ve `Video` türlerini tanır (`apps/web/src/views/Learning.vue:56,276-318`); soru bankası satırları kök, cevap, üç çeldirici, konu ve çözümü taşır (`packages/school-core/src/data/question-bank.js:3`). Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/resource.ts` (`resourceContentSchema`, `wordCount`).

### DOM-KYN-003 · Ses ve videoda erişilebilirlik

- **Kural:** Ses ve video kaynağı, döküm (transcript) veya zaman kodlu altyazı (WebVTT) eklenmeden yayına alınamaz. Dinleme becerisi görevinde döküm öğrenciye görev tamamlanana kadar gösterilmez ama kayıtta bulunur.
- **Gerekçe:** İşitme engelli öğrenci ve sessiz ortam erişimi; dinleme görevinde dökümün erken görünmesi ölçmeyi bozar.
- **Kaynak:** İşletme kuralı (CLAUDE.md erişilebilirlik zorunluluğu).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — örnek videolar `captions` ve `transcript` taşır (`packages/school-core/src/data/seed.js:457-502`); yüklenen videoda altyazı zorunlu değil (`apps/web/src/views/Learning.vue:286-298`). Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/resource.ts` (`publicationIssues`, `learnerView`: dinleme dökümü varsayılan gizli, `showTranscript` ile açılır).

### DOM-KYN-004 · Dosya doğrulaması ve depolama

- **Kural:** Dosyanın türü uzantıdan değil içerikten (MIME/imza) doğrulanır; çalıştırılabilir, makro içeren veya parola korumalı dosya kabul edilmez. Kurum başına toplam depolama kotası ve tür başına azami boyut kurum ayarıdır. Dosyalar depolama arayüzünün arkasında tutulur; öğrenciye geçici, kapsam denetimli bağlantıyla sunulur.
- **Gerekçe:** Yükleme, kötü amaçlı dosyanın öğrencilere dağıtılması için en kısa yoldur; doğrudan dosya bağlantısı kapsam denetimini atlatır.
- **Kaynak:** İşletme kuralı; ADR 0001 karar 8.
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — yalnız uzantıya bakılır (`apps/web/src/views/Learning.vue:281-285`); dosya içeriği saklanmaz, yalnız ad ve boyut kaydedilir. Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/taxonomy.ts` (`FILE_PURPOSES`, `assertFileAllowed`). API (F3c2a, ADR 0003): `POST /api/v1/files` türü içerikten (sihirli bayt, `file-type`) bulur, amaç sınırında akışı keser (413), kurum kotasını kurum kilidi altında sayar (`institution_settings.storage_quota_bytes`, boşsa 50 GB); dosya depolama arayüzünün (`apps/api/src/storage`, disk sürücüsü) arkasındadır ve `GET /api/v1/files/:fileId/url` kapsam denetimli, HMAC imzalı ve süreli bağlantı verir (`apps/api/src/services/files.ts`). Web istemcisi yüklemeden önce aynı core tablosuyla uyarır (`packages/react-shared/src/use-file-upload.ts`); bildirilen tür iki tarafta da `canonicalMimeType` ile takma addan (`audio/x-m4a`, `image/jpg`, `video/webm`) kanonik MIME'a çevrilir, tanınmayan türde karar sunucuya kalır. Eksik: makro/parola korumalı Office ve virüs taraması (ClamAV, `TODO(F3c2-scan)`), tür başına sınırın kurum ayarı olması, ekran.

### DOM-KYN-005 · Video izleme ilerlemesi

- **Kural:** Öğrencinin ders videosunu izleme ilerlemesi sunucuda tutulur; öğrenci videoyu yeniden açınca kaldığı yerden devam eder. Yalnız öğrenci kendi ilerlemesini yazar ve yalnız kendi düzeyindeki (okuma kapsamındaki) videoya; başka düzeyin videosu olmayan videoyla aynı "bulunamadı" yanıtını alır. Yüzde konum ve süreden hesaplanır, 0–100 arasına sıkıştırılır ve geri gitmez (izlenen en yüksek değer saklanır); son konum ayrı saklanır ve her kayıtta güncellenir, konum süreyi aşamaz. Süre en az 1 saniyedir (tam saniyeye yuvarlanır). Aynı kayıt tekrarlanınca sonuç değişmez. **Denetim istisnası:** sık yazılan (istemci 15 sn'de bir) ve tek başına denetim değeri taşımayan teknik kayıt olduğu için denetim satırı yalnız kaydın ilk yazımında bırakılır, aynı kaydın sonraki güncellemelerinde bırakılmaz; "bütün yazmalar ve audit_log tek transaction'da" kuralının tek ve dar istisnasıdır (API işlem çalıştırıcısında `auditPolicy: 'firstWriteOnly'`, yalnız `video.progress` eylemi kullanabilir). Uç kullanıcı başına dakikada 12 istekle sınırlıdır (429). Veli ve öğretmen ilerlemeyi okuma kapsamında görür, yazmaz. Modül `learning` kapalıysa yazılmaz.
- **Gerekçe:** Uzun dersi tek oturumda bitirmeyen öğrencinin kaldığı yeri her cihazda bulması gerekir; yüzdenin geri gitmesi tamamlanmış dersi "yarım" gösterir ve öğretmenin izleme verisini bozar.
- **Kaynak:** İşletme kuralı; IST-041 (kaldığı yerden devam sunucuda tutulur).
- **Kurum türü:** ikisi
- **Kodda:** var — core `packages/school-core/src/lib/video-progress.ts` (`recordVideoProgress`, `video.progress` eylemi `lib/authorize.ts`); API `POST /api/v1/videos/:videoId/progress` (`apps/api/src/services/video-progress.ts`); web `apps/web-react/src/pages/learning/VideoPanel.tsx`. İlerleme kaydı `videoProgress` koleksiyonundadır (`<studentId>:<videoId>` anahtarı); yazma sıklığı istemci tarafında sınırlanır (15 sn; duraklatma, kapatma, bitiş).

### DOM-KYN-006 · Kaynak sürümünün dosyaları

- **Kural:** Öğretmen veya yönetici kendi yüklediği materyal dosyasını (PDF, belge, sunum, tablo, görsel, ses, video) kaynak sürümüne bağlar. Sürümün dosyaları sıralı bir listedir; içerikteki ana dosya (ses, video ve dosya türünde zorunlu, metin ve çalışma kâğıdında gövdenin yerine geçebilen, soruda görsel) bu listeden biridir. İçerik türüne göre amaç ve sayı sabittir:

  | İçerik türü                                                        | Dosya amacı                    | Sürüm başına |
  | ------------------------------------------------------------------ | ------------------------------ | ------------ |
  | metin, çalışma kâğıdı, dosya, ödev şablonu                         | `material`                     | en çok 10    |
  | ses                                                                | `listening_audio` / `material` | 1            |
  | video                                                              | `material`                     | 1            |
  | soru                                                               | `question_image`               | 1            |
  | okuma parçası, dış bağlantı, kitap referansı, quiz, alıştırma seti | —                              | dosya yok    |

  Yeni bağlanan dosya aynı kurumda, işlemi yapanın yüklediği, kullanıma hazır (`ready`), amacı türe uygun ve başka kayda bağlı olmamalıdır; aksi hâlde işlem reddedilir ve hiçbir kayıt değişmez. Bağlama sürümün yazıldığı işlemde yapılır. Kullanılmış (yayımlanmış, incelemedeki, arşivlenmiş) sürümün dosya bağı değişmez; yeni sürüm önceki sürümün dosyalarını yeni bağla taşır ve istenirse listeyi değiştirir; aynı kaynağın eski sürümündeki dosya geri eklenebilir, silinmiş dosya taşınmaz. Dosya tek kaynağa aittir (ilk bağlandığı sürümün kaynağı) ve yalnız o kaynağın sürümleri arasında taşınır. Tek istisna kopyadır: kopya, türetildiği sürümün dosyalarını yeni bağla gösterir (dosya kopyalanmaz) ve kendi sonraki sürümlerinde taşır; asıl kaynağın kopyalanmamış bir sürümündeki dosyayı ise ekleyemez, o dosya başka kayda bağlı yeni dosya gibi denetlenip reddedilir. Dosyaya, onu bağlayan sürümlerden birini okuyabilen kişi erişir; öğrenci ve veli yalnız kendilerine görünen yayın sürümünün dosyasını açar. O sürümlerden birine atanmış görevi gören kişi de dosyayı açar (öğrencinin kendi görevi, velinin çocuklarının görevi, atayan ve sınıfın öğretmeni; soru görselinde soruyu içeren quiz'in görevi); sonradan yayımlanan sürümün yeni dosyası eski sürüme atanmış göreve açılmaz. Kaldırma aşağı yayılır: kaldırılan kaynağın ve ondan türeyen kopyaların (kopyanın kopyası dahil) sürümleri, atanmış görevler dahil hiçbir yoldan dosya açmaz; asıl kaynak ve kardeş kopyalar açık kalır (`DOM-KYN-051`).

- **Gerekçe:** Materyal kurumun kaynağıdır ve yayınevi platformuna bağımlılığı azaltmanın yolu, dosyanın da kaynakla birlikte sürümlenip aynı kapsam kuralıyla dağıtılmasıdır. Kopyada aynı dosyayı paylaşmak basit ve güvenlidir: dosya içeriği değiştirilemez, kopya yeni bayt ve kota tüketmez, erişim kopyanın kendi okuma kuralından geçer. Kaldırmada dosya kaldırılan kaynaktan türeyen kopyalarda da kapanır ve etkilenen kopyalar listelenir; kaldırılan bir kopya asıl kaynağı kapatmaz, çünkü kaldırma kararı yalnız o kopyanın içeriği içindir ve asıl kaynak da ihlal içeriyorsa yönetici onu ayrıca kaldırır (`DOM-KYN-051`). Atanmış görevden okuma, paylaşılmadan atanan kaynakta ve eski sürüme atanmış görevde kursiyerin görev içeriğindeki dosyayı açabilmesi içindir.
- **Kaynak:** İşletme kuralı; ADR 0003 karar 3, 5, 6.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — core kuralı `packages/school-core/src/content/taxonomy.ts` (`RESOURCE_FILE_RULES`), `packages/school-core/src/content/resource-files.ts` (`planVersionFiles`, `resourceFileCountIssue`), sürüm girdisi `resourceVersionInputSchema.fileIds`; bağ tablosu `resource_version_files` (`apps/api/src/db/schema/resources.ts`); API bağlama ve okuma kuralı `apps/api/src/services/resource-files.ts` (`POST /resources`, taslak `PATCH`, `POST /resources/:resourceId/versions` `fileIds`; `GET /files/:fileId/url`; atanmış görev yolu `assignedLinkedVersion`), yanıtta `files` meta verisi; testler `apps/api/test/resource-files.test.ts`. Ekran sonra (OG-250 adım 2); kaldırmada dosya imhası yok (`TODO(kaynak-dosya-imhasi)`).

## Etiketler

### DOM-KYN-010 · Kurum türüne göre zorunlu etiketler

- **Kural:** Yayına alınacak kaynakta:
  - `school`: ders, sınıf düzeyi (5–12; birden çok olabilir) ve en az bir kazanım kodu zorunludur.
  - `language_school`: CEFR seviyesi ve en az bir beceri zorunludur.
  - İngilizce beceri kaynağı `school` kurumunda da CEFR seviyesi ve beceri taşıyabilir; bu durumda ders `İngilizce` ve sınıf düzeyi de zorunludur.
- **Gerekçe:** Etiketsiz kaynak aranamaz, öneri motoruna ve eksik kazanım/etüt eşleştirmesine girmez.
- **Kaynak:** İşletme kuralı; ADR 0001 karar 4.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — materyalde ders ve düzey metni var (`packages/school-core/src/data/seed.js:508-519`); kazanım kodu, CEFR ve beceri yok. Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/resource.ts` (`publicationIssues`).

### DOM-KYN-011 · Kazanım kodu resmî programdan seçilir

- **Kural:** Kazanım/öğrenme çıktısı serbest metin olarak girilmez; kurumun etkin öğretim programı sürümündeki koddan (ör. `M.7.1.2.3`) seçilir. Kod, program sürümüyle birlikte saklanır; program değiştiğinde eski kodlu kaynaklar "program güncellemesi bekliyor" olarak işaretlenir, silinmez.
- **Gerekçe:** Optik analiz, deneme eksikleri ve kaynak önerisi aynı kazanım kimliğiyle eşleşmezse "eksik kazanıma uygun kaynak" önerilemez.
- **Kaynak:** MEB öğretim programları; 2024 sonrası programlarda "öğrenme çıktısı" kodlaması ve geçiş takvimi **doğrulanmalı**.
- **Kurum türü:** `school`
- **Kodda:** çelişiyor — konular serbest metin dizisidir (`packages/school-core/src/data/curriculum.js:9`); soru bankasında konu adı metin olarak tutulur (`packages/school-core/src/data/question-bank.js:3`). Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/resource.ts` (`resourceTagsSchema`: `outcomeId` + `outcomeSource`); katalog ve program sürümü yok.

### DOM-KYN-012 · CEFR seviyesi ve beceri sözlüğü

- **Kural:** CEFR etiketi `Pre-A1, A1, A2, A2+, B1, B1+, B2, B2+, C1, C2` listesinden seçilir. Beceri etiketi en az biri olmak üzere `okuma`, `dinleme`, `yazma`, `konuşma`; isteğe bağlı `sözlü etkileşim`, `yazılı etkileşim`, `aracılık`, `kelime`, `dil bilgisi`, `sesletim`. Okuma ve dinleme parçasında tek seviye verilir, seviye aralığı verilmez. İstisna (DOM-KYN-012, dil kullanımı): `dil kullanımı` yalnız soru, quiz ve alıştırma setinde birincil beceri olabilir; okuma parçası, ses ve video dört temel beceriden (`okuma`, `dinleme`, `yazma`, `konuşma`) birini, yazma/konuşma görevi (ödev şablonu) dört temel beceriden birini veya aracılık görevinde `aracılık`ı birincil beceri olarak taşır. Kural iki kurum türünde de uygulanır.
- **Gerekçe:** Seviye aralıklı parça seviye önerisi hesabını bozar; beceri sözlüğü sabit olmazsa raporlar bölünür.
- **Kaynak:** CEFR-CV (2020) seviye ve ölçek yapısı.
- **Kurum türü:** ikisi
- **Kodda:** yok. Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/taxonomy.ts` (`CEFR_LEVELS`, `SKILLS`, `PRIMARY_SKILLS`), `packages/school-core/src/content/resource.ts` (`publicationIssues`: `language_use_primary_not_allowed`, `core_skill_required`).

### DOM-KYN-013 · Etiketsiz soru değerlendirmeye girmez

- **Kural:** Kazanım (veya beceri) etiketi olmayan soru quiz'e, ödev şablonuna ya da deneme cevap anahtarına eklenemez. Etiket değişikliği yeni soru sürümü açar (`DOM-KYN-032`).
- **Gerekçe:** Kazanım bazlı eksik analizi ve etüt yerleştirmesi soru etiketine dayanır.
- **Kaynak:** İşletme kuralı; CLAUDE.md "cevap anahtarının her sorusu ders/kazanıma bağlıdır".
- **Kurum türü:** ikisi
- **Kodda:** kısmen — optik cevap anahtarı soru başına ders/kazanım ister (`packages/school-core/src/lib/assessment-automation.js`); soru bankası ve quiz için zorunlu değil. Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/resource.ts` (`publicationIssues`: soru ve quiz öğeleri).

## Lisans ve telif

### DOM-KYN-020 · Menşe ve lisans alanı zorunlu

- **Kural:** Her kaynak yayına alınmadan önce menşe/lisans türü taşır:
  - `Kurum özgün` (kurumda üretildi, alıntı yok),
  - `Alıntı içerir` (özgün içerik + `DOM-KYN-022` kapsamında alıntı),
  - `Açık lisans` (lisans adı ve sürümü, ör. CC BY 4.0; ticari kullanıma izin vermeyen lisans özel okulda kullanılmaz),
  - `Lisanslı yayın` (yayınevi/sağlayıcı, sözleşme numarası, kapsam, bitiş tarihi),
  - `Kamu malı` (eser sahibinin ölümünden itibaren koruma süresi dolmuş; dayanak notu zorunlu).
- **Gerekçe:** Telif ihlalinin hukuki ve cezai sonucu kuruma döner; ayrıca "yayınevi bağımlılığı azaldı mı" sorusu bu alanla ölçülür (`DOM-KYN-053`).
- **Kaynak:** FSEK md. 52 (mali haklara dair sözleşmeler yazılı olur); ticari olmayan lisansların özel okul kullanımına uygun olmadığı işletme yorumudur — **doğrulanmalı**. Koruma süresi FSEK md. 27 — **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok — materyal yükleme lisans/menşe sormaz (`apps/web/src/views/Learning.vue:276-318`). Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/resource.ts` (`resourceLicenseSchema`, `publicationIssues`); açık lisans izin listesi `packages/school-core/src/content/taxonomy.ts`.

### DOM-KYN-021 · Yayınevi içeriği yalnız yazılı lisansla yüklenir

- **Kural:** Yayınevi kitabının taranmış sayfası, test kitabı sorusu, cevap anahtarı, yayınevi dijital platformundan indirilen ses/video veya etkileşimli içerik yalnız `Lisanslı yayın` kaydıyla yüklenir. Lisans bitiş tarihinde kaynak otomatik yayından kalkar (arşiv), yeni atamaya girmez; mevcut atamada yeni deneme başlatılamaz, süren deneme teslim edilebilir. Lisans kapsamı "basılı kitap sahibi öğrenciler" ile sınırlıysa paylaşım kapsamı da bu öğrencilerle sınırlanır. Lisanslı yayın kurum dışına çıkmaz: Kampüs kütüphanesine girmez, başka kuruma paylaşılmaz (`DOM-KYN-043`). Kurum içindeki kopya ve uyarlama `DOM-KYN-050`'ye uyar: lisans uyarlamaya açıkça izin vermiyorsa veya süresi dolmuşsa kopyalanamaz, kopya lisansı aynen miras alır.
- **Gerekçe:** Ders kitabı alınmış olması, içeriğin dijital ortamda çoğaltılması ve umuma iletimi için izin değildir.
- **Kaynak:** FSEK md. 22 (çoğaltma), md. 25 (umuma iletim), md. 52; md. 34/1 son cümlesi ("bu serbestlik, hak sahibinin meşru menfaatlerine haklı bir sebep olmadan zarar verir veya eserden normal yararlanma ile çelişir şekilde kullanılamaz"). Eğitim amaçlı piyasaya sürülen yayınlar için md. 34 serbestisine dayanılamayacağı işletme yorumudur — **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok. Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/resource.ts` (bitiş günü), `packages/school-core/src/content/visibility.ts` (kitap sahibi sınırı, `isAssignable`), `packages/school-core/src/content/copy.ts` (uyarlama izni, süresi dolmuş lisansın kopyası); otomatik arşiv işi yok. API: `POST /api/v1/task-assignments` lisansı dolmuş içeriği core planından önce 409 `resource_license_expired` ile reddeder (bitiş günü dahil atanabilir); `POST /api/v1/task-assignments/:assignmentId/attempts` lisansı dolmuş içerikte (puanlama sürümü veya sorularından biri) yeni denemeyi aynı kodla reddeder, süren deneme kaydedilir ve teslim edilir (`services/task-work.ts` `assertLicenseActive`). Öğrenci ve veli atama ayrıntısı lisansı dolmuş içeriği yalnız süren işi (deneme, teslim veya öğrencinin taslağı) olana gösterir, ötekine `contentUnavailable: 'license_expired'`; durum özeti yeni denemeyi `blockedBy: 'license_expired'` ile kapatır (`services/task-progress.ts`).

### DOM-KYN-022 · Alıntı sınırı ve biçimi

- **Kural:** Başka bir eserden alıntı yalnız şu koşullarla yapılır: alıntı içerikte ayırt edilebilir biçimdedir (tırnak, blok alıntı veya görsel çerçeve), eser adı + eser sahibi + alındığı yer (yayın, sayfa veya URL) yazılır, alıntı kaynağın asıl içeriğini aydınlatmaya hizmet eder. Yasa sayısal sınır koymaz; platform muhafazakâr sınır uygular: alıntı, kaynağın özgün bölümünden uzun olamaz; tam ünite, tam bölüm, tam test veya tam şarkı/şiir alıntı sayılmaz, `Lisanslı yayın` gerektirir. Görseller için yalnız alenileşmiş eser ve konuyu aydınlatma amacı.
- **Gerekçe:** FSEK alıntıyı "maksadın haklı göstereceği nispet" ile sınırlar; bu belirsiz ölçü platformda denetlenebilir bir eşiğe çevrilmelidir.
- **Kaynak:** FSEK md. 35/1 (1–4. bentler) ve md. 35/2 ("İktibasın belli olacak şekilde yapılması lazımdır. İlim eserlerinde ... kullanılan eserin ve eser sahibinin adından başka bu kısmın alındığı yer belirtilir"). Sayısal eşik işletme kuralıdır.
- **Kurum türü:** ikisi
- **Kodda:** yok. Core kuralı (ADR 0004; API ve ekran sonra): yalnız kaynak gösterimi zorunluluğu `packages/school-core/src/content/resource.ts`; alıntı uzunluk eşiği yok.

### DOM-KYN-023 · Eğitim serbestilerine dar yorum

- **Kural:** Platform, FSEK md. 33 (temsil serbestisi) ve md. 34 (eğitim amaçlı seçme ve toplama eser) serbestilerine dayanarak lisanssız içerik yayınlamaz. Seçme-toplama niteliğindeki kurum derlemesi (ör. farklı eserlerden kısa okuma parçaları seçkisi) yalnız alıntı kuralına (`DOM-KYN-022`) uyan parçalarla ve her parçada eser ve eser sahibi adıyla yapılır.
- **Gerekçe:** md. 33 yalnız "yüzyüze eğitim" ve "doğrudan veya dolaylı kâr amacı gütmeksizin" temsili kapsar; ücretli özel okulun dijital platformu bu koşulları karşılamayabilir. md. 34 serbestisi meşru menfaat sınırına tabidir.
- **Kaynak:** FSEK md. 33, md. 34 (metinler mevzuat.gov.tr konsolide metinden okundu). Özel okulun dolaylı kâr amacı taşıdığı yorumu **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-KYN-024 · Kaynak gösterme korunur

- **Kural:** Kaynak gösterimi (eser, eser sahibi, yayın/yer, yıl, sayfa veya URL) içeriğin görünür parçasıdır; öğrenci ekranında, PDF çıktısında ve kopyalarda korunur, kopyalayan veya uyarlayan kişi silemez. Kaynak gösterimi eksik veya yanlış içerik onaya gönderilemez.
- **Gerekçe:** Kaynak göstermeksizin alıntı ve yanıltıcı kaynak gösterme suçtur.
- **Kaynak:** FSEK md. 71/1-3 ve 71/1-5 (kaynak göstermeksizin iktibas; yetersiz, yanlış veya aldatıcı kaynak gösterme).
- **Kurum türü:** ikisi
- **Kodda:** kısmen. Core kuralı (ADR 0004): `packages/school-core/src/content/resource.ts` (`attributionSchema`, `assertLineagePreserved`, `learnerView`). API: öğrenci ve veli atama ayrıntısı (`GET /api/v1/task-assignments/:assignmentId`, `content.attributions`; `apps/api/src/services/task-progress.ts`) sabitlenen sürümün kaynak gösterimini taşır. Web: öğrencinin yazma çalışma alanı (`apps/web-react/src/pages/tasks/StudentWritingWorkspace.tsx`, `student-task-model.ts` `writingBrief`) yönergenin altında kaynak gösterimini listeler. PDF çıktısı yok.

### DOM-KYN-025 · Telif bildirimi ve yayından kaldırma

- **Kural:** Hak sahibi veya kurum personeli bir kaynak için telif bildirimi yaptığında kaynak derhâl `İncelemede` durumuna alınır, öğrenci ve veliye görünmez, yeni atamaya girmez. Yönetici kararıyla ya yeniden yayına alınır ya da kaldırılır (`DOM-KYN-051`). Bildirim, karar ve gerekçe denetim kaydında tutulur.
- **Gerekçe:** İhlal iddiasında yayına devam etmek zararı ve sorumluluğu büyütür.
- **Kaynak:** İşletme kuralı; FSEK md. 66-68 (tecavüzün ref'i ve men'i) — **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok. Core kuralı (ADR 0004; ekran sonra): `packages/school-core/src/content/resource.ts` (`planVersionTransition` `report`: bildirimi yalnız kaynağı okuyabilen personel yapar, `staffCanReadVersion`; bildirilen içeriği yalnız yönetici yeniden onaylar; kaldırma `planResourceRemoval`); bildirim kaydı yok. API: `POST /api/v1/resources/:id/versions/:versionId/report` yayındaki sürümü incelemeye alır, `POST /api/v1/resources/:id/remove` (yalnız yönetici, gerekçeli) kaldırır; bildirim gerekçesi saklanmaz (`TODO(content-report-log)`). Öğrenci ve veli atama ayrıntısı (`apps/api/src/services/task-progress.ts` `withdrawnFromLearners`) kaynağın herhangi bir sürümü bildirimle incelemede veya kaldırılmışsa, eski sürüme sabitlenen atamada da içeriği göstermez (`contentUnavailable: 'unavailable'`).

### DOM-KYN-026 · Öğrenci eseri kaynak havuzuna alınmaz

- **Kural:** Öğrencinin ödev teslimi, yazma ve konuşma kaydı öğrencinin eseridir ve kişisel veridir. Kaynak platformuna örnek olarak eklenmesi; öğrencinin (reşit değilse velinin) amaç ve süre belirten açık izniyle, ad ve tanıtıcı bilgiler çıkarılarak yapılır. İzin geri alınınca örnek yayından kalkar.
- **Gerekçe:** Öğrenci işçi değildir; md. 18/2 kurala kuruma hak tanımaz. Ses kaydı ve yazı tanıtıcı olabilir.
- **Kaynak:** FSEK md. 18/1; KVKK md. 5/1 (açık rıza), md. 3/1-a (açık rıza tanımı); reşit olmayanın temsili TMK md. 342.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-KYN-027 · Dış bağlantı kaynak değildir

- **Kural:** Dış sitedeki video veya sayfaya bağlantı `Dış bağlantı` türüyle eklenir; içerik kopyalanmaz, indirilmez, platformda yeniden barındırılmaz. Dış bağlantılar kurum özgün içerik oranına sayılmaz. Gömülü oynatıcı, öğrencinin kimliğini veya kurum bilgisini dış servise göndermeyecek biçimde açılır; öğrenci verisi dış servise aktarılmaz.
- **Gerekçe:** Bağlantı, telif sorununu içeriği kopyalamaktan daha az doğurur ama üçüncü taraf bağımlılığını azaltmaz; öğrenci verisinin dış servise sızması ayrı bir KVKK aktarımıdır.
- **Kaynak:** İşletme kuralı; ADR 0001 karar 8 (dış SaaS bağımlılığı eklenmez); KVKK md. 8-9 (aktarım).
- **Kurum türü:** ikisi
- **Kodda:** yok. Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/taxonomy.ts` (`link` türü, `external` gösterge kümesi).

## Onay, sürüm, yayın

### DOM-KYN-030 · Durum makinesi

- **Kural:** Kaynak durumları: `Taslak → İncelemede → Yayında → Arşiv`. İnceleyen `Reddedildi` dediğinde gerekçe zorunludur ve kaynak `Taslak`'a döner. Öğrenci ve veli yalnız `Yayında` kaynağı görür; `Taslak` yalnız sahibine, `İncelemede` sahibine ve onaylayıcıya görünür.
- **Gerekçe:** Öğrenciye ulaşan her içerik bir kez gözden geçirilmiş olmalıdır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** yok — yüklenen materyal anında öğrenci kütüphanesine girer (`apps/web/src/views/Learning.vue:300-310`). Core kuralı (ADR 0004; ekran sonra): `packages/school-core/src/content/resource.ts` (`planVersionTransition`), `packages/school-core/src/content/visibility.ts` (`canReadVersion`). API: `POST /api/v1/resources/:id/versions/:versionId/{submit,publish,withdraw,approve,reject,reopen,archive,report}` (`apps/api/src/services/resource-commands.ts`); eşzamanlı iki onayda biri 409 (`apps/api/test/pg-content.test.ts`).

### DOM-KYN-031 · Kim onaylar

- **Kural:** Onaylayıcı, `school` kurumunda aynı dersin zümre başkanı veya yönetici; `language_school` kurumunda akademik koordinatör veya yönetici. Kaynağı yazan kişi kendi kaynağını onaylayamaz; zümrede tek öğretmen varsa yönetici onaylar. İstisna: `Kurum özgün` ve paylaşım kapsamı yalnız öğretmenin kendi sınıfı/öğrencisi olan kaynak onaysız yayına alınabilir; aynı kaynak zümre veya kurum kapsamına açılırken onaya girer. `Alıntı içerir` ve `Lisanslı yayın` kaynakları kapsamdan bağımsız her zaman onaya girer.
- **Gerekçe:** Dört göz ilkesi telif ve içerik hatasını yakalar; ama öğretmenin günlük sınıf içi kâğıdını bekletmek kullanımı öldürür.
- **Kaynak:** İşletme kuralı. Zümre başkanının görevleri (OİKY/OKY ve zümre öğretmenler kurulu hükümleri) **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok — zümre başkanı rolü yok. Core kuralı (ADR 0004; ekran sonra): `packages/school-core/src/content/resource.ts` (`requiresReview`, `canReview`); zümre başkanı yetkisi `ContentActor.reviewer`. API: onay ve ret `approve`/`reject` uçlarında; zümre başkanı verisi olmadığından yalnız yönetici onaylar (`TODO(content-reviewer)`).

### DOM-KYN-032 · Yayındaki içerik değişmez, sürüm açılır

- **Kural:** `Yayında` olan kaynak düzenlenemez; düzenleme aynı kaynağın yeni sürümünü `Taslak` olarak açar. Yeni sürüm yayına girince önceki sürüm yeni atamalarda kullanılmaz ama silinmez. Öğrenciye verilmiş ödev, quiz veya okuma görevi atandığı sürüme bağlı kalır; puanlar ve teslimler o sürümle hesaplanmış kalır.
- **Gerekçe:** Öğrenci bir soruyu cevapladıktan sonra sorunun değişmesi puanı geriye dönük anlamsızlaştırır.
- **Kaynak:** İşletme kuralı; CLAUDE.md "anahtar revizyonu eski optik analizin kullanımını engeller" ilkesinin kaynak platformuna genellemesi.
- **Kurum türü:** ikisi
- **Kodda:** yok. Core kuralı (ADR 0004; ekran sonra): `packages/school-core/src/content/resource.ts` (`planDraftUpdate`, `planNewVersion`); atama yalnız güncel yayındaki sürüme bağlanır ve onu sabitler: `packages/school-core/src/skills/assignment.ts` `resolveAssignmentSettings` (`resourceVersionId`, başta ona eşit `scoringVersionId`, `rubricVersionId`). API: `PATCH /api/v1/resources/:id/versions/:versionId` (`If-Match` zorunlu; yayındaki sürüm 409 `version_immutable`), `POST /api/v1/resources/:id/versions` (ikinci açık sürüm 409 `open_version_exists`); yeni yayın önceki sürümü aynı işlemde arşivler. Atama: `POST /api/v1/task-assignments` içeriğin güncel yayındaki sürümünü sabitler (taslak, arşivli veya güncel olmayan sürüm 409 `resource_version_not_assignable`); atanmış sürüm, puanlama ve rubrik sürümü `PATCH` ile değişmez (409 `assignment_setting_frozen`).

### DOM-KYN-033 · Hatalı soru düzeltmesi

- **Kural:** Yayındaki soruda cevap anahtarı hatası bulunursa düzeltilmiş sürüm yayınlanır; bu soruyu içeren tamamlanmış quiz denemeleri ve notlar kendiliğinden değişmez. Yeniden puanlama, öğretmenin veya yöneticinin başlattığı ayrı bir işlemdir; etkilenen öğrenci sayısı önizlenir, eski ve yeni puan denetim kaydına yazılır, öğrenci ve veliye bildirilir.
- **Gerekçe:** Sessiz puan değişikliği not itirazı ve güven sorununa yol açar.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — core kuralı `packages/school-core/src/skills/assignment.ts` `previewRescore` (etkilenen öğrenci sayısı ve puan farkı, saf) ve `planRescore` (gerekçeli ayrı işlem, son onayda yeniden hesaplanır, eski ve yeni puanlama sürümünü döndürür); denetim kaydı ve bildirim API'dedir.

## Paylaşım kapsamı

### DOM-KYN-040 · Kapsam basamakları

- **Kural:** Paylaşım kapsamı şu değerlerden biridir: `yalnız ben` (taslak çalışma), `öğrenci` (bir veya birkaç öğrenci), `sınıf/grup` (öğretmenin atandığı şube veya dil grubu), `zümre` (aynı kurumdaki aynı branş öğretmenleri, yalnız öğretmen görür), `kurum` (kurumun tüm öğretmenleri; öğrencilere yalnız düzey/seviye eşleşirse). Öğretmen yalnız atandığı sınıf ve öğrencilere `sınıf/grup` ve `öğrenci` kapsamı verebilir.
- **Gerekçe:** Öğretmenin kendi sınıfı dışındaki öğrencilere içerik göndermesi kapsam sızıntısıdır.
- **Kaynak:** İşletme kuralı; ADR 0001 karar 7 (öğretmen kendi sınıfları/branşı).
- **Kurum türü:** ikisi
- **Kodda:** yok — materyalde kapsam alanı yok. Core kuralı (ADR 0004; ekran sonra): `packages/school-core/src/content/visibility.ts` (`shareTargetsSchema`, `planShareChange`). API: `POST /api/v1/resources/:id/share` (öğretmen yalnız ders verdiği sınıf ve öğrencilere, kapsam dışı 403; kurumda olmayan hedef 422); eski hedefler silinmez, arşivlenir.

### DOM-KYN-041 · Öğrencinin gördüğü kaynak

- **Kural:** Öğrenci bir kaynağı yalnız şu üç koşul birlikte sağlanırsa görür: kaynak `Yayında`, kapsam öğrenciyi içeriyor (doğrudan, aktif sınıfı/grubu veya kurum kapsamı) ve kaynağın düzey/seviye etiketi öğrencinin düzeyi/seviyesiyle eşleşiyor. Veli, çocuğunun gördüğü kaynakları salt okur görür. Kapsam sunucuda uygulanır; istemci filtresi güvenlik sınırı değildir.
- **Gerekçe:** Öğrenci kütüphanesi kendi düzeyindeki içeriği göstermeli; kapsam sızıntısı sunucuda engellenmelidir.
- **Kaynak:** İşletme kuralı; ADR 0001 karar 7.
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — öğrenci tüm düzeylerin materyallerini görür, düzey yalnız kullanıcının seçtiği filtredir (`apps/web/src/views/Learning.vue:123-133`). Core kuralı (ADR 0004; ekran sonra): `packages/school-core/src/content/visibility.ts` (`canReadVersion`). API: `GET /api/v1/resources` ve ayrıntı (`apps/api/src/services/resources.ts`): öğrenci/veli yalnız güncel yayın sürümünü cevap anahtarsız görür; SQL süzgeci core ile eşit (`apps/api/test/resource-visibility.test.ts`).

### DOM-KYN-042 · Zümre içinde okuma, sahiplikte yazma

- **Kural:** `Zümre` veya `kurum` kapsamındaki kaynağı diğer öğretmenler okur, kendi sınıfına atar ve kopyalar (`DOM-KYN-050`); düzenleme ve arşivleme yalnız sahibine, zümre başkanına ve yöneticiye açıktır.
- **Gerekçe:** Ortak havuz büyürken içeriğin sahibi belli kalmalıdır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — öğretmen yalnız kendi materyallerini listeler (`apps/web/src/views/Learning.vue:127`); zümre paylaşımı yok. Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/resource.ts` (`canManage`), `packages/school-core/src/content/visibility.ts`.

### DOM-KYN-043 · Kurumlar arası paylaşım varsayılan olarak yoktur

- **Kural:** Bir kurumun kaynağı başka bir kurumda görünmez, aranamaz, atanamaz ve kopyalanamaz; aynı kişi iki kurumda çalışsa bile kaynak taşıyamaz. Kurumlar arası paylaşım ileride açılacaksa ayrı ADR, kaynak sahibi kurum yöneticisinin kaynak başına açık işlemi ve yalnız `Kurum özgün` veya uygun `Açık lisans` kaynaklarla sınırlı olur; `Lisanslı yayın` hiçbir koşulda kurum dışına çıkmaz.
- **Gerekçe:** Kiracı sınırı (ADR 0001) içerik için de geçerlidir; yayınevi lisansı kuruma özeldir ve devredilemez.
- **Kaynak:** ADR 0001 karar 4; FSEK md. 48-52 (lisans/devir) — **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok — kurum kavramı yok. Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/visibility.ts` (`libraryVersionVisible`).

### DOM-KYN-044 · Platform örnek içeriği

- **Kural:** Kampüs'ün hazır içeriği (müfredat özeti, örnek soru bankası, örnek videolar) kurum kaynağı değildir; kurum kurulurken salt okur "Kampüs kütüphanesi" olarak sunulur. Kurum bu içeriği kopyalayıp uyarladığında kopya kurumun kaynağı olur ve menşe alanında "Kampüs örnek içeriğinden türetildi" yazar.
- **Gerekçe:** Platform içeriği tüm kurumlarda ortaktır; bir kurumun düzenlemesi diğerlerini etkilememelidir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — örnek içerik her demo durumuna kopyalanır (`packages/school-core/src/data/seed.js:335,457-527`), ayrı kütüphane yok. Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/copy.ts` (`planCopy`), `packages/school-core/src/content/visibility.ts` (`canBrowseLibrary`).

## Kopyalama, uyarlama, arşiv

### DOM-KYN-050 · Kopya ve uyarlama soyu

- **Kural:** Kopyalanan veya uyarlanan kaynak yeni bir kaynaktır: yeni sahibi kopyalayan kişidir, `Taslak` olarak başlar, "türetildiği kaynak + sürüm" bağını ve lisans/menşe alanını miras alır, kaynak gösterimleri korunur (`DOM-KYN-024`). `Lisanslı yayın` kaynağı lisans uyarlamaya açıkça izin vermiyorsa veya lisans süresi dolmuşsa kopyalanamaz; kopyanın lisansı bütün alanlarıyla (bitiş tarihi, kitap sahibi sınırı, uyarlama izni) kaynağınkiyle aynı kalır, kopyalayan değiştiremez. Asıl kaynağın yeni sürümü kopyaları değiştirmez; kopya sahibine "asıl kaynak güncellendi" bildirimi gider.
- **Gerekçe:** Uyarlama hakkı (işleme) eser sahibine aittir; soy bilgisi telif bildiriminde etkilenen tüm kopyaların bulunmasını sağlar.
- **Kaynak:** FSEK md. 21 (işleme hakkı), md. 18/2.
- **Kurum türü:** ikisi
- **Kodda:** yok. Core kuralı (ADR 0004; ekran sonra): `packages/school-core/src/content/copy.ts` (`planCopy`, `copyLineage`), `packages/school-core/src/content/resource.ts` (`assertLineagePreserved`); "asıl kaynak güncellendi" bildirimi yok. API: `POST /api/v1/resources/:id/copy`; kopya `derived_from_version_id` ile soyunu, kaynak lisansını ve kaynak gösterimini taşır (değiştirmek 422 `license_inherited`/`attribution_inherited`).

### DOM-KYN-051 · Arşiv ve kaldırma

- **Kural:** Arşivlenen kaynak aramaya ve yeni atamaya girmez; geçmiş ödev, quiz ve teslimler atandıkları sürümü salt okur göstermeye devam eder. Kaynak silinmez. İstisna "kaldırma"dır: telif ihlali (`DOM-KYN-025`) veya kişisel veri nedeniyle yönetici kararıyla dosya ve içerik silinir; başlık, menşe, kaldırma gerekçesi ve tarih kalır, geçmiş görevlerde "Bu içerik kaldırıldı" görünür.
- **Gerekçe:** Geçmiş not ve teslimlerin bağlamı korunmalı; ihlal içeren içerik ise arşivde de dağıtılmaya devam etmemelidir.
- **Kaynak:** İşletme kuralı; KVKK md. 7.
- **Kurum türü:** ikisi
- **Kodda:** kısmen. Dosya (OG-250, sabah kararları 36 ve 39): kaldırma aşağı yayılır; kaldırılan kaynağın ve `derived_from_version_id` zincirinde ondan türeyen kopyaların (torunlar dahil) sürümleri, atanmış görevler dahil hiçbir yoldan dosya açmaz, asıl kaynak (ata) ve kardeş kopyalar açık kalır (`apps/api/src/services/resource-files.ts` `openLinkedVersions`); kopya kaldırılınca asıl kaynak aynı içeriği taşıyorsa yönetici onu ayrıca kaldırır. Bağ satırları silinmez, yalnız okuma kapanır, karar geri alınabilir. Kaldırma nedeni (telif / kişisel veri) saklanmaz, iki neden aynı davranır; arşiv (yayından kaldırma) kopyanın dosyasını kapatmaz. Dosya imhası yok (`TODO(kaynak-dosya-imhasi)`). Core kuralı (ADR 0004; ekran sonra): `packages/school-core/src/content/resource.ts` (`archive` geçişi; kaynak düzeyinde kaldırma `planResourceRemoval`: bütün sürümler, dosyalar, türetilmiş kopyalar ve soruyu içeren quiz'ler). API: sürüm `archive` geçişi ve `POST /api/v1/resources/:id/remove` (içerik ve cevap anahtarı silinir, `resources.archived_at` dolar; yanıtta etkilenen kopya ve quiz sürümleri); dosya tablosu yok.

### DOM-KYN-052 · Öğretmen ayrılınca sahiplik devri

- **Kural:** Öğretmen arşivlendiğinde kaynakları silinmez ve yayında kalır; sahipliği aynı branşın zümre başkanına, yoksa yöneticiye devredilir. Öğretmenin `yalnız ben` kapsamlı taslakları yöneticiye görünür olur ve 90 gün sonra arşivlenir.
- **Gerekçe:** Kurum havuzu kişiye bağlı kalırsa her ayrılışta küçülür; sahipsiz içerik güncellenemez.
- **Kaynak:** FSEK md. 18/2; 90 gün işletme kuralıdır.
- **Kurum türü:** ikisi
- **Kodda:** yok — kadro arşivi kaynakları ele almaz. Core kuralı (ADR 0004; ekran sonra): `packages/school-core/src/content/visibility.ts` (sahip ayrılınca taslak yöneticiye görünür); sahiplik devri yok. API: okuma uçları sahibi ayrılan kaynağın taslağını yöneticiye gösterir (`ownerActiveSql`, `apps/api/src/db/resources.ts`); sahiplik devri ucu yok.

### DOM-KYN-053 · Bağımlılık göstergesi

- **Kural:** Yönetici raporu, dönem bazında atanan kaynakların menşe dağılımını gösterir: `Kurum özgün + Alıntı içerir` oranı, `Lisanslı yayın` oranı, `Dış bağlantı` oranı; ders/beceri ve düzey kırılımıyla. Oran yalnız gerçek atama kayıtlarından hesaplanır, saklanmaz.
- **Gerekçe:** Ürünün ana hedefi (yayınevi bağımlılığını azaltmak) ölçülmeden yönetilemez.
- **Kaynak:** İşletme kuralı; ADR 0001 Bağlam.
- **Kurum türü:** ikisi
- **Kodda:** yok. Core kuralı (ADR 0004; API ve ekran sonra): `packages/school-core/src/content/taxonomy.ts` (`LICENSE_KINDS` `indicator`); oran hesabı yok.

## Mevcut kodla farklar

| Kural            | Fark                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM-KYN-002      | Materyal türü yalnız `Doküman`/`Video`; okuma parçası, ses, çalışma kâğıdı, ödev şablonu ayrımı yok (`apps/web/src/views/Learning.vue:56,276-318`).                    |
| DOM-KYN-003      | Yüklenen videoda altyazı/döküm zorunlu değil (`apps/web/src/views/Learning.vue:286-298`).                                                                              |
| DOM-KYN-004      | Dosya türü yalnız uzantıdan anlaşılıyor; içerik saklanmıyor (`apps/web/src/views/Learning.vue:281-285`).                                                               |
| DOM-KYN-011      | Kazanım serbest metin konu adı; resmî kod ve program sürümü yok (`packages/school-core/src/data/curriculum.js:9`, `packages/school-core/src/data/question-bank.js:3`). |
| DOM-KYN-020, 021 | Lisans/menşe alanı ve yayınevi lisans kaydı yok; her dosya doğrudan yüklenebiliyor.                                                                                    |
| DOM-KYN-030, 031 | Onay akışı ve zümre başkanı rolü yok; yüklenen materyal anında yayında (`apps/web/src/views/Learning.vue:300-310`).                                                    |
| DOM-KYN-032      | Kaynak sürümü yok; quiz ve ödev kaynağın güncel hâline bağlı.                                                                                                          |
| DOM-KYN-041      | Öğrenci tüm düzeylerin materyallerini görüyor; düzey yalnız istemci filtresi (`apps/web/src/views/Learning.vue:123-133`).                                              |
| DOM-KYN-043      | Kurum kavramı olmadığı için kiracı sınırı uygulanmıyor (ADR 0001 geçişi bekliyor).                                                                                     |
