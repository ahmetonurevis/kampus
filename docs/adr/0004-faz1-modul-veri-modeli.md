# ADR 0004 · Faz 1 içerik, beceri ve CEFR modüllerinin veri modeli

- Durum: Kabul edildi (2026-10-30, Oğuzhan Demirci); "Açık sorular" bölümünde önerilen seçenekler kabul edildi
- Onaylayan: Oğuzhan Demirci
- Ayrıntılandırdığı: ADR 0001 karar 6 (kademeli normalleştirme); dosyalar için ADR 0003

## Bağlam

Faz 1'in ürün maddeleri (ister listesi §6): içerik havuzu ve taksonomi (IST-030, 031, 033–036), beceri modülleri (IST-042, 045, 047, 048, 051, 052, 056, 057) ve CEFR (IST-058, 060, 062). İş kuralları `docs/domain/kaynak-platformu.md` (DOM-KYN), `beceri-gelisimi.md` (DOM-BEC) ve `dil-okulu.md` (DOM-DIL) içindedir.

Bugün okul verisi `records` tablosunda (`(institution_id, collection, id)` + `data jsonb`) tutulur; API işlem için koleksiyonları bütün olarak yükler, school-core işlemini çalıştırır, farkı yazar (`operation-runner.ts`). İçerik bugün `materials`, `videos`, `bank`, `questions`, `quizzes`, `homework`, `submissions`, `quizAttempts` koleksiyonlarına dağılmıştır; kurum, lisans, onay ve sürüm yoktur.

Bu modüllerin `records`'a sığıp sığmadığını belirleyen ihtiyaçlar (veritabani §4 ölçütleri):

- **Büyüklük (ölçüt 1, 4):** havuz 10.000 öğede sayfalı süzülür (IST-035); deneme, teslim sürümü ve rubrik puanı öğrenci × görev başına birikir, bir kurumda yılda 20.000'i kolayca geçer. Bütün koleksiyonu yükleyen çalıştırıcı bunu taşıyamaz.
- **Kısıt (ölçüt 2):** öğrenci × atama başına tek teslim (DOM-BEC-040), sürüm numarası tekilliği, atamanın sabit içerik sürümüne yabancı anahtarla bağlanması, kullanılmış rubrik sürümünün silinememesi (DOM-BEC-022).
- **Raporlama (ölçüt 3):** içerik başına atama ve başarı (IST-038), menşe oranı (DOM-KYN-053, IST-123), kriter ve beceri kırılımı (IST-048, IST-057).
- **Ayrı erişim/saklama (ölçüt 5):** ses kaydı ve teslimler (ADR 0003).
- **Kurum dışı içerik:** Kampüs kütüphanesi (DOM-KYN-044) bütün kurumlara salt okur sunulur; `records`'un kurum anahtarlı yapısında güvenli ifade edilemez.

## Kararlar

1. **Faz 1 modülleri ilişkisel tablolarda.** İçerik, görev, teslim, puan ve CEFR kararları `records`'a yazılmaz; aşağıdaki tablolarla (karar 9) tutulur. Bütün tablolar veritabani §2 zorunlu kolonlarını taşır, kimlik uygulamada üretilen `uuid`'dir, her yabancı anahtar `(institution_id, …_id)` bileşiktir; böylece başka kurumun satırına bağlanmak veritabanınca imkânsızdır. `records`'ta kalan tek yeni veri, kurumun küçük ayarlarıdır (karar 10).

2. **İş kuralı yine school-core'da, State dışında.** Yeni kurallar school-core'da saf fonksiyon ve Zod şeması olarak yazılır (`src/content/`, `src/skills/`, `src/cefr/`; karar 11) ve State'e koleksiyon eklemez. Girdi, servisin Drizzle ile yüklediği tipli satırlardır; fonksiyon `now` alır, karar veya yazılacak değişikliği döndürür. API servisi tek transaction'da yükler, core'u çağırır, sürüm kontrolüyle yazar ve `audit_log`'u aynı transaction'da ekler. `operation-runner` bu yapıya açık transaction kabul edecek biçimde genişletilir; böylece `records`'a dokunan adım (ör. kur geçişinin yenileme teklifi) aynı transaction'a girer. Web ve mobil aynı Zod şemalarıyla form doğrular.

3. **Kaynak ve sürüm ayrı satırdır.** `resources` kimliği, sahibini, türünü, paylaşım kapsamını ve güncel yayındaki sürümü tutar; `resource_versions` içeriği tutar. Yayımlanan sürüm değişmez: `published_at` dolu satırda içerik, etiket ve lisans kolonları güncellenmez (servis reddeder, test denetler). Düzenleme yeni `Taslak` sürüm açar (DOM-KYN-032). Durum sürümün kolonudur: `draft`, `in_review`, `published`, `rejected`, `archived`, `removed` (DOM-KYN-030, 051); ret gerekçesi ve onaylayan aynı satırdadır. Onaylayıcı ve kendi kaynağını onaylama yasağı core'dadır (DOM-KYN-031).
   - `content` jsonb tür başına core Zod şemasıyla doğrulanır (okuma parçası, ses, soru, quiz, ödev şablonu …; DOM-KYN-002). Soru ve görev cevap anahtarı ayrı `answer_key` kolonundadır; öğrenci/veli yanıt şemasında bulunmaz ve anahtar açılma kuralı (DOM-BEC-045) bu kolona uygulanır.
   - Süzülen etiketler kolondur: `subject_id`, `grade_levels int[]`, `cefr_level`, `primary_skill`, `skills text[]`, `content_type`, `duration_minutes`, `difficulty`, `license_kind`. Kazanımlar `resource_version_outcomes` bağlantı tablosundadır. Menşe/lisans ayrıntısı (yayınevi, sözleşme no, bitiş, kaynak gösterimi) `license` jsonb'dir; yayım kuralı core'dadır (DOM-KYN-020, 024).
   - Arama: başlık ve metinden üretilmiş `tsvector` kolonu + GIN indeksi; dil yapılandırması Açık soru 5. Liste her zaman sayfalıdır (api-tasarimi §3).
   - Quiz ve alıştırma seti soruları kendi sürüm kimlikleriyle listeler (`resource_version_items`); sorunun yeni sürümü quiz'i değiştirmez.
   - Kopya ve uyarlama yeni `resources` satırıdır; `derived_from_version_id` (aynı kurumda bileşik FK) veya platform kaynağında `derived_from_platform_version_id` taşır (DOM-KYN-050).

4. **Atama sabit sürüme bağlanır.** `task_assignments` içerik sürümünü (`resource_version_id`), görevin ayarlarını (`kind`: `evaluation`/`practice`, deneme hakkı, sayım politikası, süre, dinleme hakkı, döküm gösterimi, taslak sayısı, geç kabul) ve kullanılıyorsa `rubric_version_id`'yi atama anında sabitler (DOM-KYN-032, DOM-BEC-041, 042). Hedefler `task_assignment_targets` satırlarıdır (sınıf/şube, dil grubu, öğrenci; kimlikler `records` kayıtlarına işaret eder ve core kapsam kuralıyla doğrulanır). Aynı içerik farklı son tarihle ayrı atamalardır (IST-034).
   - Anahtar düzeltmesi yeni içerik sürümüdür; atamanın puanlandığı sürüm `scoring_version_id` kolonundadır (başta `resource_version_id`'ye eşit). Değişimi gerekçeli ayrı işlemdir (`POST /task-assignments/:id/rescore`), etkilenen öğrenci sayısını önizler ve denetim kaydına yazılır. Otomatik yeniden puanlama kapsamı Açık soru 2.

5. **Hesaplanan değer saklanmaz; karar anının kopyası saklanır.**
   - Saklanmaz, her okumada core'dan hesaplanır: otomatik puan (cevaplar + puanlama sürümü; DOM-BEC-010), rubrik toplamı ve 100'lük puan (DOM-BEC-021), son puan seçimi (ikinci puanlayıcı ve koordinatör kuralı; DOM-BEC-024), sözcük sayısı, devam oranı, beceri bazlı CEFR önerisi ve genel öneri (DOM-BEC-030…033), içerik kullanım ve menşe oranları (IST-038, DOM-KYN-053).
   - Raporlar SQL ile ham satırlardan toplanır; tekrar eden ağır sorgu ölçümle gerekirse materyalleştirilmiş görünümle hızlandırılır, görünüm kaynak değildir ve yeniden üretilebilir.
   - Saklanır, çünkü kararın kendisidir: not defterine aktarım anındaki puan (`score_transfers`; DOM-BEC-060), yerleştirme ve kur geçiş kararındaki öneri ve kanıt listesi (`evidence_snapshot` jsonb; DOM-BEC-030, DOM-DIL-070). Kopya yalnız gerekçe olarak gösterilir, başka bir hesabın girdisi olmaz.

6. **Teslim, deneme ve taslak.**
   - Otomatik görev: `task_attempts` (başlangıç ve son süre sunucu saatiyle, cevaplar, teslim zamanı; DOM-BEC-043). Dinleme hakkı `attempt_media_plays` satırlarıyla sayılır (ADR 0003 karar 6).
   - Öğretmen puanlı görev: `task_submissions` öğrenci × atama başına tek satır (`unique (institution_id, assignment_id, learner_id)`), `submission_versions` değişmez gönderimler (metin, `files` bağlantıları, gönderim zamanı; geç bayrağı saklanmaz, son tarih ve uzatmadan hesaplanır (karar 5); sürüm sınırı core'da; DOM-BEC-040, 044, 046). Yazmada otomatik taslak `submission_drafts` (öğrenci × atama başına bir satır, iyimser kilitli, üzerine yazılır); öğretmen yalnız gönderilmiş sürümleri görür ve iki sürümü yan yana açar (IST-047).
   - Konuşma: `submission_versions` satırı `speaking_recording` dosyasına bağlıdır; rıza ön koşulu ve saklama ADR 0003'tedir.
   - Rubrik puanı: `rubric_scores` (sürüm, rubrik sürümü, puanlayan, `rater_role`: `first`/`second`/`final`, kriter başına bant ve yorum, genel yorum). Puanlanan sürüm sabitlenir.

7. **Rubrik sürümlüdür.** `rubrics` + `rubric_versions` (analitik/bütüncül, kriter × bant, ağırlık, CEFR tanımlayıcı veya kazanım eşlemesi). Kullanılmış sürüm FK ile korunur, yalnız arşivlenir (DOM-BEC-022). Rubrik kurumundur; ortak rubrik aynı kurumdaki birçok görevde kullanılır (IST-048).

8. **Seviye tespiti, CEFR profili ve kur geçişi.**
   - Seviye tespit sınavı bölümlü bir quiz kaynağıdır (bölüm: dil kullanımı, okuma, dinleme otomatik; yazma, konuşma rubrikli). `placement_sessions` bir adayı veya öğrenciyi (`learner_kind`: `student`/`prospect`, `records` kimliği), form sürümünü, yeri (`in_person`/`remote`; uzaktan `ön tespit`, DOM-DIL-011) ve bölüm atamalarını bağlar. Geçerlilik (90 gün, DOM-DIL-012) bitiş zamanından hesaplanır.
   - CEFR profili saklanmaz; değerlendirme türündeki puanlanmış sonuçlardan hesaplanır (IST-060, DOM-BEC-031). Profili değiştiren her insan kararı `level_decisions` satırıdır: `kind` (`placement`, `progression`, `correction`), beceri (genel için `null`), seviye, gerekçe, karar veren, `evidence_snapshot`. Profil ekranı öneriyi ve kararları ayrı gösterir (DOM-BEC-034).
   - Kur geçişi `progression_decisions`: kayıt (dil grubu kaydı, `records` kimliği), sonuç (`passed`, `repeat`, `incomplete_attendance`), devam ve beceri puanı kopyası, gerekçe, karar veren (DOM-DIL-070). Üst kur kaydı ve yenileme teklifi aynı transaction'da mevcut core işlemleriyle `records`'a yazılır (karar 2; IST-062). Yalnız `language_school`; `school`'da modül kapalıdır (DOM-YTK-012).

9. **Kurum dışı içerik: yalnız Kampüs kütüphanesi, yalnız okuma ve kopya.**
   - Platform içeriği ayrı tablolardadır: `platform_resources`, `platform_resource_versions` (aynı kolonlar, `institution_id` yok, durum yalnız `published`/`archived`). Yazma yalnız platform bakım betiğiyle (guvenlik-kvkk §6), HTTP'den değil. Kurum tablosunda `institution_id`'yi boş bırakan veya "her kurum" anlamına gelen satır yoktur; kiracı kuralı istisnasız kalır.
   - Kurum personeli kütüphaneyi tek uçtan (`GET /library-resources`) salt okur süzer; öğrenci ve veli görmez. Kurumda kullanmak için kopyalanır: kopya kurumun `resources` satırıdır, menşesi "Kampüs örnek içeriğinden türetildi" (DOM-KYN-044, IST-039). Atama, teslim ve puan yalnız kurum tablolarına bağlanır; platform sürümüne FK yalnız soy bilgisidir.
   - `Lisanslı yayın` hiçbir koşulda kurum dışına çıkmaz; kurumlar arası doğrudan paylaşım ve yayınevinin lisans vererek içerik sunması (IST-039 genişlemesi) ayrı ADR'dir (DOM-KYN-043).
   - Kazanım kataloğu da aynı biçimdedir: MEB öğretim programı kodları sürümüyle `platform_learning_outcomes`'ta, kurumun kendi kodları `learning_outcomes`'ta (DOM-KYN-011, IST-032 Faz 2). Kaynak etiketi hangisine işaret ettiğini `outcome_source` ile taşır. CEFR seviyeleri, beceriler, içerik türleri ve tanımlayıcı kimlikleri tablo değil school-core sabitidir (DOM-KYN-012, DOM-BEC-004).

10. **`records`'ta kalanlar.** Kurum başına küçük, yılda bir değişen ayarlar core koleksiyonu olarak `records`'ta tutulur: `cefrTargets` (düzey → hedef CEFR, ders yılı başında kilitlenir; DOM-BEC-063). Eski `materials`, `videos`, `bank`, `questions`, `quizzes`, `homework`, `submissions`, `quizAttempts` koleksiyonları yeni tablolar gelince tek veri migration'ıyla kopyalanır (Açık soru 4), okuma köprüsünde kapanır ve demo kalıcılığıyla birlikte silinir.

11. **Core'a gelecekler (yeni koleksiyon değil, modül).**

    | Modül                   | İçerik                                                                                                                |
    | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
    | `content/taxonomy.ts`   | CEFR seviyeleri, beceri ve kip sözlüğü, içerik türleri, lisans türleri, dosya amaçları (ADR 0003 karar 3)             |
    | `content/resource.ts`   | Tür başına içerik şeması, yayım denetimi (DOM-KYN-003, 010, 013, 020, 024), durum geçişleri, onaylayıcı, kopya kuralı |
    | `content/visibility.ts` | Paylaşım kapsamı ve öğrencinin gördüğü kaynak (DOM-KYN-040…042)                                                       |
    | `skills/assignment.ts`  | Atama ayarları, hedef kapsamı, sabitleme, yeniden puanlama önizlemesi                                                 |
    | `skills/scoring.ts`     | Otomatik puan, kısa cevap normalleştirmesi, deneme sayımı, süre ve geç teslim (DOM-BEC-010, 042…045)                  |
    | `skills/submission.ts`  | Sürüm sınırı, taslak, sözcük sayısı, konuşma deneme hakkı                                                             |
    | `skills/rubric.ts`      | Rubrik şeması, puan hesabı, ikinci puanlayıcı ve uyuşmazlık (DOM-BEC-020…024)                                         |
    | `cefr/suggestion.ts`    | Kanıt seçimi, beceri ve genel öneri (DOM-BEC-030…034)                                                                 |
    | `cefr/placement.ts`     | Bölüm sonuçları, öneri, yerleştirme kararı, geçerlilik (DOM-DIL-010…012)                                              |
    | `cefr/progression.ts`   | Ölçme, devam, devamsızlık bildirimi, geçiş koşulları ve karar (DOM-DIL-013, 060…062, 070)                             |
    | `cefr/targets.ts`       | `cefrTargets` şeması ve yıllık kilit (DOM-BEC-063); State koleksiyonu kaydı F5b'de. `data/` yalnız örnek veridir      |

12. **API'ye gelecek tablolar.**

    | Tablo                                                                                                      | Not                               |
    | ---------------------------------------------------------------------------------------------------------- | --------------------------------- |
    | `learning_outcomes`, `platform_learning_outcomes`                                                          | Kazanım kataloğu, sürümlü         |
    | `platform_resources`, `platform_resource_versions`                                                         | Kampüs kütüphanesi (karar 9)      |
    | `resources`, `resource_versions`, `resource_version_outcomes`, `resource_version_items`, `resource_shares` | İçerik havuzu, paylaşım hedefleri |
    | `rubrics`, `rubric_versions`                                                                               |                                   |
    | `task_assignments`, `task_assignment_targets`                                                              |                                   |
    | `task_attempts`, `attempt_media_plays`                                                                     | Otomatik görev                    |
    | `task_submissions`, `submission_versions`, `submission_drafts`, `rubric_scores`                            | Yazma ve konuşma                  |
    | `score_transfers`                                                                                          | Not defterine aktarım (`school`)  |
    | `placement_sessions`, `level_decisions`, `progression_decisions`                                           | CEFR                              |
    | `files`, `consents`                                                                                        | ADR 0003 ve guvenlik-kvkk §9      |

    Öğrenci kimlikleri (`learner_id`, hedef sınıf/grup) `records` kayıtlarına işaret ettiği için veritabanı FK'sı taşımaz; bütünlüğü core ve servis sağlar, öğrenci arşivi bağlı açık görevleri core kuralıyla kapatır. Bu sınır öğrenci/sınıf koleksiyonları normalleştirilince kalkar.

13. **Önerilen iş bölümü (brief girdisi).**
    - **F3 · İçerik havuzu:** karar 3, 9, 10; `content/*`, kaynak ve kütüphane uçları, eski içerik migration'ı, `files` (ADR 0003). IST-030, 031, 033, 035, 036.
    - **F4 · Beceri görevleri:** karar 4–7; `skills/*`, atama, deneme, teslim, taslak, rubrik ve puan uçları, konuşma kaydı ve dönüştürme işi. IST-034, 042, 045, 047, 048, 051, 052, 056, 057.
    - **F5 · CEFR:** karar 8, 10; `cefr/*`, seviye tespiti, profil, kur geçişi. IST-058, 060, 062.

## Sonuçlar

- İş kuralı tek yerde kalır, ama bu modüllerde core `State` ve `runWorkflow` dışında çalışır; çevrimdışı demo bu modülleri hiç almaz (zaten kaldırılıyor). Mobil ve web yalnız API'yi kullanır.
- Kiracı sınırı bileşik FK ile veritabanında da korunur; platform içeriği ayrı tablolarda olduğu için "kurum kapsamı istisnası" tek okuma ucuna ve kopya işlemine iner. Bu iki yol çapraz kurum testleriyle denetlenir.
- İlk kez ilişkisel iş tabloları geliyor: `veritabani.md` §2 tablolarının, `.claude/rules/veritabani.md`'nin ve `api-tasarimi.md` köprü notunun F3 ile güncellenmesi gerekir. Normalleştirme her modül için ayrı ADR yerine bu ADR'de toplu kararlaştırıldı (ADR 0001 karar 6'daki "her biri ayrı ADR" bu küme için karşılanmış sayılır).
- Takip: CEFR-CV tanımlayıcı kimliklerinin alıntı kapsamı (DOM-BEC-004) ve MEB İngilizce kazanım listesinin içe aktarma biçimi F3 başlamadan netleşmeli.

## Alternatifler

- **Hepsini `records` koleksiyonu yapmak:** core işlemleri değişmeden çalışırdı; ama 10.000 öğelik havuz ve öğrenci × görev satırları her işlemde bütün koleksiyonu yüklemeyi, tekil teslim ve sabit sürümü yalnız uygulama kuralına bırakmayı, raporları uygulamada hesaplamayı gerektirir; dört normalleştirme ölçütüne birden takılır. Elendi.
- **Kaynak ve sürümü tek satırda (`data.versions[]`):** yayımlanmış sürümün değişmezliği ve atamanın sürüme FK'sı kurulamaz; satır 256 KB sınırına yaklaşır. Elendi.
- **Platform içeriği `institution_id is null` satırlarıyla aynı tabloda:** tek sorgu kolaylığı, ama her sorguda "kurumum veya boş" koşulunu doğru yazmaya bağlı bir kiracı istisnası açar ve bileşik FK'yı bozar. Elendi.
- **Platform içeriği her kuruma kurulumda kopyalamak (bugünkü demo):** kiracı sınırı basit; ama düzeltmeler kurumlara ulaşmaz, havuz şişer ve "kurum özgün" oranı bozulur. Kullanıcının seçtiği öğe kopyalanır, toplu kopya yok.
- **Hesaplanan puan ve öneriyi saklamak:** okuma hızlı, ama anahtar/rubrik düzeltmesinde eski değerlerin sessizce yanlış kalması CLAUDE.md "hesaplanan değer saklanmaz" kuralına aykırı. Gereken yerde yeniden üretilebilir görünüm kullanılır.
- **Ayrı içerik mikro hizmeti veya belge veritabanı:** ikinci veri deposu ve dağıtık transaction gerektirir; ADR 0001 tek PostgreSQL kararıyla çelişir. Elendi.

## Açık sorular (önerilen seçeneklerle kapandı)

1. **Kampüs kütüphanesinden kopyalanan öğe hangi durumda başlar?**
   - a) Değiştirilmemiş kopya doğrudan `Yayında`; düzenlenince yeni sürüm onaya girer **(önerilen; platform içeriği zaten gözden geçirilmiş)**
   - b) Her kopya `Taslak` başlar ve kurum onayından geçer (DOM-KYN-050'nin harfiyen uygulanması)
   - c) Kütüphane öğesi kopyasız doğrudan atanabilir
   - Uygulama notu (F3a): 1a uygulandı (`content/copy.ts` `planCopy`); değiştirilmemiş kütüphane kopyası kurum yayım koşullarını karşılıyorsa onaysız `Yayında` başlar ve kuruma açılabilir. Koşulları karşılamayan kopya eksikleriyle `Taslak` başlar.
2. **Anahtar düzeltmesinden sonra puanlar.** DOM-BEC-011 kendiliğinden yeniden hesap, DOM-KYN-033 açık işlem diyor; iki kural çelişiyor.
   - a) Açık işlem: öğretmen önizler ve onaylar; aktarılmış ve karara girmiş sonuçlar kopyasıyla sabit kalır **(önerilen)**
   - b) Kendiliğinden yeniden hesap; yalnız aktarılmış/karara girmiş sonuçlar onay ister
   - c) Düzeltme yalnız yeni atamalarda geçerli
3. **Faz 1 seviye tespitine kimler girer?**
   - a) Kayıtlı öğrenci ve kurumda sınava giren aday (personel cihazından); hesapsız bağlantı Faz 2 (IST-059) **(önerilen)**
   - b) Yalnız kayıtlı öğrenci
   - c) Hesapsız aday bağlantısı da Faz 1'e çekilir
4. **Eski içerik koleksiyonları (demo materyal, 153 soru, video, quiz).**
   - a) Örnek içerik Kampüs kütüphanesine taşınır, kurum kayıtları kurumun `resources`'una `Kurum özgün` taslak olarak kopyalanır **(önerilen)**
   - b) Yalnız kütüphaneye taşınır, kurum kayıtları atılır
   - c) Taşınmaz, yeni modüller boş başlar
5. **Metin arama dil yapılandırması.**
   - a) `simple` + büyük/küçük harf ve Türkçe karakter normalleştirmesi; İngilizce ve Türkçe metin aynı indekste **(önerilen)**
   - b) İçerik diline göre `turkish`/`english` kök bulucu, iki indeks
   - c) `pg_trgm` benzerlik araması
   - Uygulama notu (F3a): PostgreSQL `tsvector` kolonu yalnız core `searchDocument` çıktısından üretilir (`to_tsvector('simple', …)`); sorgu terimleri `searchQueryTerms`'ten gelir. İki taraf aynı `normalizeSearchText` (NFKD, Türkçe küçültme) fonksiyonundan geçer; SQL'de ikinci normalleştirme yazılmaz.
