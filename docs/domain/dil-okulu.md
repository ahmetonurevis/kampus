# Dil okulu

`language_school` kurumunun öğretim birimi olan seviye, kur ve grup; seviye tespiti, deneme dersi, devam, kur geçme, belge, paket satışı ve kursiyer türleri. Beceri görevleri, puanlama ve seviye önerisi hesabı [beceri-gelisimi.md](beceri-gelisimi.md), ücret ve iade [finans.md](finans.md), aday ve kesin kayıt [kayit-ve-crm.md](kayit-ve-crm.md) içindedir.

Mevzuat notu: MEB izinli bir yabancı dil kursu ÖÖKY md. 4/1-s tanımında "kişisel gelişim kursu" (çeşitli kurs) kapsamına girer; aynı kurum ortaöğretim derslerine destek veriyorsa "özel öğretim kursu" (md. 4/1-p) olabilir. Bazı hükümler (grup tavanı, seviye belirleme sınavı, haftalık saat) bu iki tür için farklıdır. Kurumun ruhsat türü kurum profilinde tutulur ve mevzuat profili (`DOM-AKD-001`) buna göre seçilir. Hangi dil okulunun hangi türde ruhsatlı olduğu **doğrulanmalı**.

## Seviye, kur ve program

### DOM-DIL-001 · Seviye ölçeği sabittir, kur kurumundur

- **Kural:** Seviye değerleri sabit listedir: `Pre-A1, A1, A2, A2+, B1, B1+, B2, B2+, C1, C2`. Kurum her seviyeyi bir veya daha çok kura böler (ör. `B1.1`, `B1.2`); kur tam olarak bir seviyeye bağlıdır ve sırası vardır. Seviye listesine kurum değer ekleyemez; kur adı ve sayısı kurum ayarıdır.
- **Gerekçe:** Seviye önerisi, kur geçme ve raporlar ortak ölçekle karşılaştırılabilir olmalı; kurların ayrıntısı kurumdan kuruma değişir.
- **Kaynak:** CEFR-CV (Pre-A1 ve artı seviyeler A2+, B1+, B2+). C1+ gibi resmî olmayan ara değerler kullanılmaz.
- **Kurum türü:** `language_school` (`school` İngilizce dersinde yalnız beceri profili için, bkz. `DOM-BEC-060`)
- **Kodda:** seviye ölçeği `packages/school-core/src/content/taxonomy.ts` `CEFR_LEVELS` (sıra `rank`); kur `packages/school-core/src/lib/courses.ts` (`DOM-DIL-005`), tablo `courses`. Kur sırası seviye sırası ve addır (`orderedCourses`); seviye içi sıra `nextCourseId` zinciridir (`DOM-DIL-007`).

### DOM-DIL-002 · Kur süresi ders saatiyle tanımlanır

- **Kural:** Her kurun toplam ders saati, haftalık saati ve başlangıç/bitiş tarihi vardır. Bir ders saati 45 dakikadır; uygulamalı ders 90 dakikalık blok olabilir. Kurun toplam saati, kurumun MEB onaylı öğretim programında o seviye için öngörülen süreden az olamaz. GLH değerleri yalnız planlama önerisidir: kur saatleri GLH'ye eşitlenmez, çünkü GLH ders dışı yönlendirilmiş çalışmayı da içerir.
- **Gerekçe:** Ücret, devam oranı ve iade ders saatiyle hesaplanır; onaylı programın süresinin altına inen kur denetimde sorun çıkarır.
- **Kaynak:** ÖÖKY md. 10/6 (45 dakika, 90 dakika blok), md. 46/3 (onaylı program uygulanır); GLH (A1 ≈ 90–100 … C2 ≈ 1.000–1.200, birikimli, yalnız rehber). Onaylı yabancı dil programlarındaki seviye başı saatler **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** kısmen — `lib/courses.ts` kurda toplam ve haftalık ders saatini (45 dk), oturum uzunluğunu (45/90 dk; 90 dakikada saatler çift) ve hesaplanan süreyi (`courseDurationWeeks`, saklanmaz) tutar; toplam saat 1.200'ü aşamaz. Başlangıç/bitiş tarihi gruptadır (`DOM-DIL-008`); onaylı programdaki seviye başı asgari saat denetimi yok.

### DOM-DIL-003 · Ders saatleri yasal çalışma aralığında

- **Kural:** Grup ve bireysel ders 07.00–23.00 arasında planlanır. Grupta zorunlu eğitim çağında bir kursiyer varsa dersler 21.00'de biter. Genel tatil günlerine ve valilik/Bakanlık tatil kararlarına denk gelen ders planlanamaz; karar sonradan gelirse ders iptal edilir ve `DOM-DIL-054` ile telafi edilir.
- **Gerekçe:** Mevzuat çalışma saatlerini ve tatile uymayı zorunlu kılar.
- **Kaynak:** ÖÖKY md. 10/6, 10/7.
- **Kurum türü:** `language_school`
- **Kodda:** kısmen — `packages/school-core/src/lib/language-groups.ts` grubun haftalık kalıbını 07.00–23.00 içinde tutar (422 `group_outside_legal_hours`); çocuk ve genç bandında oturum 21.00'de biter (grup açılışında ve 18 yaş altı kursiyer yerleştirmesinde 422 `group_minor_late`; zorunlu eğitim çağı 18 yaş altıyla yaklaşık, `TODO(zorunlu-egitim-cagi)`). Kurum tatil takvimi yok, oturumlar tatil atlamadan sayılır (`TODO(tatil-takvimi)`).

### DOM-DIL-004 · Çalışma takvimi bildirime hazır tutulur

- **Kural:** Her kurun dönemlik takvimi ve haftalık ders çizelgesi (gün, saat, derslik, eğitmen) platformdan dışa aktarılabilir. Takvim değişikliği tarih ve değiştirenle kayıt altına alınır. Platform takvimi MEB'e göndermez; "MEM'e bildirildi" durumu ayrıca işaretlenir.
- **Gerekçe:** Kurslar takvimlerini bağlı oldukları millî eğitim müdürlüğüne gönderir; denetimde MEBBİS'e girilen gün/saatlerle derslerin tutarlılığı aranır.
- **Kaynak:** ÖÖKY md. 10/4, md. 67/5.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-005 · Kur tanımı ve yaşam döngüsü

- **Kural:** Kur kurumun öğretim programıdır: ad, öğretim dili, tek CEFR seviyesi, isteğe bağlı beceri odağı (dört temel beceri), toplam ve haftalık ders saati, oturum uzunluğu, en az (açılış, `DOM-DIL-042`) ve en çok mevcut (≤ 18, `DOM-DIL-040`), belgeli/belgesiz bilgisi ve sonraki kur. Durum `taslak → etkin → arşiv`; arşiv geri alınmaz. Ad, kurumun arşivlenmemiş kurlarında tekildir (büyük/küçük harf duyarsız). Etkin kurun dili, seviyesi, saatleri, oturum uzunluğu ve belge türü değişmez; değişiklik yeni kur olarak tanımlanır. Kuru yönetici ve o seviyenin akademik koordinatörü (`DOM-YTK-027`) yönetir; ön büro, öğretmen, öğrenci ve veli okur. Öğrenci ve veli yalnız etkin kurların katalog alanlarını görür (açılış sayısı, e-Özel kaydı ve durum anları görünmez).
- **Gerekçe:** Gruplar, devam oranı, kur geçme ve paket satışı kurun saat ve seviyesine dayanır; etkin kurda bunların değişmesi açılmış grupların hesabını bozar. Kur tanımı e-Özel kurs planı alanlarını karşılamalıdır (IST-076).
- **Kaynak:** ÖÖKY md. 10/6, md. 46/3; e-Özel kurum kılavuzu (kurs programı planlama). Kurum içi karar: arşiv geri alınmaz, ad tekilliği.
- **Kurum türü:** `language_school` (okulda kur yoktur; uçlar her rol için 404)
- **Kodda:** `packages/school-core/src/lib/courses.ts` (`planCourseCreation`, `planCourseUpdate`, `planCourseActivation`, `planCourseArchive`, `courseView`), `apps/api/src/routes/courses.ts`, tablo `courses` (migration `0028_create_courses`).

### DOM-DIL-006 · Kurun e-Özel kaydı

- **Kural:** Kurun e-Özel kurs programı kodu ve onay durumu (`işlenmedi`, `onay bekliyor`, `onaylandı`, `reddedildi`) kurda tutulur; kurum e-Özel'e elle işler, platformda yönetici işaretler ve işaretleyen ile an iz olarak saklanır. Program kodu kurumun arşivlenmemiş kurlarında tekildir. Belgeli kur, programı e-Özel'de onaylanmadan etkinleştirilemez; etkin belgeli kurun e-Özel kaydı değişmez. Taslakta program alanı (dil, seviye, saatler, oturum, belge türü) değişirse onay `işlenmedi`ye döner, program kodu kalır.
- **Gerekçe:** Belgeli kursun bitirme belgesi (`DOM-DIL-080`) ancak müdür ve ilçe MEM onaylı programa bağlı kursiyere düzenlenir; onaysız programla açılan kurs belgesiz kalır. Platform e-Özel'e yazmaz, durumu izler (ister listesi, e-Özel satırı).
- **Kaynak:** e-Özel kurum kılavuzu (kurs programı müdür ve ilçe MEM onayı). Belgesiz kursun da e-Özel'de program kaydı gerektirip gerektirmediği ve alan eşlemesi (seviye, süre, sınıf) **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** `lib/courses.ts` `planCourseEOzelRecord`, `planCourseActivation`; `POST /api/v1/courses/:courseId/record-e-ozel` (yalnız yönetici).

### DOM-DIL-007 · Seviyeli kursta sonraki kur

- **Kural:** Kur, geçen kursiyerin devam ettiği sonraki kuru gösterebilir. Sonraki kur aynı kurumda, arşivlenmemiş, aynı dilde ve seviyesi bu kurunkinden düşük olmayan bir kurdur (aynı seviyede `B1.1 → B1.2` olur); zincir kendine dönemez. Başka bir arşivlenmemiş kurun sonraki kuru olan kur arşivlenmez; önce bağ kaldırılır. Öğrenci ve veli sonraki kuru yalnız etkinse görür.
- **Gerekçe:** Kur geçme kararı (`DOM-DIL-070`) ve seviyeli kurslarda üst seviyeye kayıt bu bağı kullanır; kopuk ya da döngülü zincir yanlış yerleştirmeye yol açar.
- **Kaynak:** e-Özel kurum kılavuzu (seviyeli kurslarda üst seviyeye kayıt); kurum içi karar.
- **Kurum türü:** `language_school`
- **Kodda:** `lib/courses.ts` (`assertNextCourse`, `planCourseArchive`).

### DOM-DIL-008 · Program ile grup ayrıdır

- **Kural:** Kur tarih, öğretmen, derslik ve fiyat taşımaz. Tarihli açılış (başlangıç/bitiş, takvim, eğitmen, derslik, kursiyerler) kura bağlı gruptur; grup kapasitesi kurun en çok mevcudunu aşamaz ve yalnız etkin kurdan açılır. Fiyat paket satışındadır (`DOM-DIL-050`): paket kura `courseId` ile bağlanır, satışta kurun etkin olması aranır, ders saati ve seviye satış satırına kopyalanır. Açık grubu olan kur arşivlenmez.
- **Gerekçe:** Aynı program dönem dönem ve farklı saatlerde yeniden açılır; program alanlarının tek yerde tutulması e-Özel eşlemesini ve kur geçme hesabını tutarlı kılar. Satış satırındaki kopya, kur sonradan arşivlense de satılan saati korur.
- **Kaynak:** ÖÖKY md. 10/4 (takvim), e-Özel kurum kılavuzu; kurum içi karar.
- **Kurum türü:** `language_school`
- **Kodda:** var — kurda tarih ve fiyat alanı yok (`lib/courses.ts`); grup `packages/school-core/src/lib/language-groups.ts` (`planGroupCreation`: yalnız etkin kurdan, kapasite kurun en çok mevcudunu aşamaz, bitiş kurun toplam saatinden `groupEndDate`), tablo `language_groups` (migration `0029_create_groups`), uçlar `apps/api/src/routes/language-groups.ts` (okulda 404). Kur arşivi kapanmamış grup varken 422 `course_has_open_groups` (`planCourseArchive`, `groupsBlockingCourseArchive`). Paket satışı ON-058'dedir.

## Seviye tespiti

### DOM-DIL-010 · Seviye tespit sınavı

- **Kural:** Aday veya kursiyer için seviye tespiti ücretsizdir ve iki bölümden oluşur: otomatik puanlanan okuma, dinleme ve dil kullanımı bölümü; öğretmenin rubrikle puanladığı yazma görevi ve konuşma görüşmesi. Platform beceri bazında sonuç ve seviye önerisi üretir (`DOM-BEC-030`); yerleştirme seviyesini öğretmen veya akademik koordinatör gerekçe yazarak seçer. Sonuç ve karar ayrı alanlardır. Tespit önerisi kendi eşiğiyle hesaplanır: oturumun her tamamlanmış bölüm sonucu bir kanıttır ve `DOM-BEC-032`'nin "en az 2 farklı gün" şartı aranmaz (başarı payı ve okuma/dinlemede en az 10 madde aynen geçerlidir). Otomatik puanlanan bölümlerden (dil kullanımı, okuma, dinleme) biri tamamlanmamışsa genel öneri çıkmaz. Yazma veya konuşma henüz puanlanmamışsa o becerinin önerisi çıkmaz, diğer becerilerinki çıkar; genel öneri `DOM-BEC-033` gereği dört beceriyi istediği için o durumda genel öneri de yetersiz kalır. Uzaktan tespit ön tespit olarak kalır (`DOM-DIL-011`). Öğrencinin görev kanıtları genel eşikle birlikte sayılır; tespiti yalnız destekler, aynı seviyede başarı payını 2/3'ün altına düşürürse tespit yolunu kapatır.
- **Gerekçe:** Yalnız çoktan seçmeli bölüm üretici becerileri ölçmez; makinenin önerisi karar yerine geçmez.
- **Kaynak:** İşletme kuralı. ÖÖKY md. 46/9 özel öğretim kurslarında seviye belirleme sınavlarının ücretsiz ve kurum binasında yapılmasını, dönem başı/ortası/sonunda tekrarlanmasını ister; bu hükmün kişisel gelişim kursu olan dil okuluna uygulanıp uygulanmadığı **doğrulanmalı**. Platform muhafazakâr olarak ücretsizliği her türde uygular.
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/placement.ts` `planPlacementSession`, `placementSectionResults`, `placementSummary` (tespit bağlamı, `PLACEMENT_AUTO_SECTIONS`), `planPlacementDecision` (gerekçe her zaman zorunlu, karar oturum başına bir; karar kopyası tespit önerisini taşır). Tespit eşiği `packages/school-core/src/cefr/suggestion.ts` `suggestCefrLevels({ context: { kind: 'placement' } })` ve `PLACEMENT_DEMONSTRATION_RULES`; genel bağlam değişmedi, `LevelTally.demonstratedBy` dayanağı gösterir API (OG-054): `apps/api/src/routes/cefr.ts` ve `services/cefr.ts`, `POST /api/v1/placement-sessions`, `/:sessionId/score` (bölüm girişleri `placement_sessions.section_entries`, migration 0037; rubrik becerisi bölümden farklıysa 422 `placement_rubric_skill_mismatch`), `/complete` ve `/decide` (gerekçeli karar `level_decisions`'a); yalnız dil okulunda, yönetici ve grup kapsamındaki öğretmen. Kancalar `packages/react-shared/src/use-cefr.ts`; web ekranı (OG-078; IST-058): `apps/web-react/src/pages/language/PlacementPage.tsx`, `PlacementPanels.tsx`, saf model `placement-model.ts` (`/yonetici/seviye-tespiti`, `/ogretmen/seviye-tespiti`; kişi seçilir, oturum açılır, otomatik bölümlerin cevapları personelce girilir, yazma ve konuşma rubrik bantlarıyla puanlanır, tespit bitirilir, önerilen seviye görünür, gerekçeli karar verilir); cevap girişi için `GET /api/v1/placement-sessions/:sessionId/form` otomatik bölümlerin sorularını cevap anahtarı ve açıklama olmadan döner (kapsam oturumla aynı; kursiyerin kendi girdiği sınav oynatıcısı yok, `TODO(cefr-tespit-oynatici)`), bölüm hedef seviyesi soruların ortak seviyesi (`TODO(cefr-tespit-bolum-seviyesi)`), görev kanıtı öneriye yüklenmez (`TODO(cefr-gorev-kaniti)`) (ADR 0004).
- **Not:** Tespit önerisi eşiği patron kararıdır ve kullanıcı tarafından onaylandı (30 Ekim 2026).

### DOM-DIL-011 · Uzaktan yapılan tespit ön tahmindir

- **Kural:** Kurum dışında (çevrim içi) çözülen seviye testi `ön tespit` olarak işaretlenir. Kesin yerleştirme için öğretmenle konuşma görüşmesi ve gözetimli yazma görevi gerekir. Ruhsat türü özel öğretim kursu olan kurumda seviye belirleme sınavı yalnız kurum binasında yapılır.
- **Gerekçe:** Gözetimsiz sonuç güvenilir değildir; özel öğretim kursları için yer şartı vardır.
- **Kaynak:** ÖÖKY md. 46/9; dil okuluna uygulanışı **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/placement.ts` `PLACEMENT_MODES` (`remote` ön tespit), `planPlacementDecision` uzaktan oturumu reddeder, `placementRequired`; ön tespit `packages/school-core/src/cefr/suggestion.ts` seçiminde kanıt değildir. Ruhsat türüne göre yer şartı yok (`TODO(cefr-ruhsat-turu)`) API (OG-054): `mode: 'remote'` oturumunda `POST /placement-sessions/:sessionId/decide` 422 `placement_preliminary` verir; profilde tespit "Uzaktan (ön tespit)" etiketiyle görünür; Seviye Tespiti ekranı uzaktan oturumda "Yerleştirme kararı ver" düğmesini göstermez ve nedenini yazar (OG-078; ADR 0004).

### DOM-DIL-012 · Tespit sonucunun geçerlilik süresi

- **Kural:** Seviye tespit sonucu 90 gün geçerlidir. Bu süre içinde kayıt olmayan aday veya kaydı 90 günden uzun dondurulan kursiyer (`DOM-DIL-052`) yeniden tespite girer. Aynı aday bir dönem içinde en fazla iki kez tespit sınavına girer; ikinci sınav farklı soru formuyla yapılır.
- **Gerekçe:** Dil seviyesi zamanla değişir; aynı formu tekrar çözmek sonucu şişirir.
- **Kaynak:** İşletme kuralı (90 gün ve iki sınav sınırı).
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/placement.ts` `placementValidity` (bitiş anı + 90 × 24 saat, son an hariç; `TODO(cefr-gecerlilik-siniri)`), `planPlacementSession` (dönemde iki oturum, ikincisi farklı formla; `TODO(cefr-donem)`, `TODO(cefr-farkli-form)`); dondurma sonrası yeniden tespit yok (`TODO(cefr-dondurma)`) API (OG-054): `POST /placement-sessions` iki tespitten sonra 409 `placement_limit_reached` (dönem sınırı yok, `TODO(cefr-donem)`), aynı formla ikinci tespitte 422 `placement_form_repeated`; karar 90 gün dolunca 422 `placement_expired`. Geçerlilik her okumada hesaplanır (`validity`); web Akademik Gelişim ve grup özeti tespitleri "Geçerli"/"Süresi doldu" diye gösterir; Seviye Tespiti ekranı listede geçerlilik sonunu, ayrıntıda "... tarihine kadar geçerli" metnini verir (OG-078; ADR 0004).

### DOM-DIL-013 · Kur içi ilerleme değerlendirmesi

- **Kural:** Her kurda en az üç ölçme noktası vardır: başlangıç (tanılayıcı), ara ve kur sonu. Her ölçmenin sonunda kursiyere beceri ve konu bazında yazılı geri bildirim verilir. Başlangıç ölçmesi not yerine geçmez; kur geçme kararına yalnız ara ve kur sonu ölçmeleri girer.
- **Gerekçe:** Mevzuat kurslarda dönem başı, ortası ve sonunda gelişim takibi ve konu bazında geri bildirim ister; tanı amaçlı ölçme cezalandırmamalı.
- **Kaynak:** ÖÖKY md. 46/9 (özel öğretim kursları); dil okulunda örnek alınarak uygulanır.
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/progression.ts` `ASSESSMENT_POINTS` (`baseline` hesaba ve karar kopyasına girmez), `courseAssessmentInputSchema`/`planCourseAssessment` (yalnız grubun öğretmeni, nokta başına bir kez, dört becerinin her birinde puan ve boş olmayan geri bildirim; boş geri bildirim alan yollu doğrulama hatası) ve `assessmentGaps` (eksik nokta, eksik beceri, boş geri bildirim tamamlanmamış sayılır; devam şartı sağlanmışsa kur sonu kararını engeller). Konu bazında geri bildirim için kurun konu modeli yok, beceri geri bildirimi metnine yazılır (`TODO(cefr-konu-geri-bildirimi)`); her nokta bir kez girilir, ek ara ölçme yok (`TODO(cefr-ek-olcme)`) API (OG-086): tablo `course_assessments` (değişmez satır, nokta kayıt başına bir; migration 0052), `POST /api/v1/course-assessments` (yalnız grubun öğretmeni; ikinci ölçme 409 `assessment_already_recorded`); ekran sonraki adımdır (ADR 0004).

## Deneme dersi

### DOM-DIL-030 · Deneme dersi

- **Kural:** Aday, seviyesine uygun açık bir grubun gerçek dersine program başına bir kez, ücretsiz katılabilir. Deneme katılımcısı yoklamada kursiyer olarak sayılmaz; ayrı `deneme` kaydı tutulur. Ders anındaki kursiyer sayısı + deneme katılımcısı sayısı grup kapasitesini (`DOM-DIL-040`) aşamaz ve bir derse en fazla iki deneme katılımcısı alınır. 18 yaş altı adayın deneme dersi için veli onayı ve veli iletişim bilgisi zorunludur. Deneme dersinin çakışma denetimi `DOM-KAY-006` ile aynıdır (süre dikkate alınır).
- **Gerekçe:** Deneme dersi satışın ana aracıdır ama derslikteki yasal mevcudu ve kayıtlı kursiyerin ders kalitesini bozmamalıdır. İlan edilmeyen ücret alınamayacağı için ücretli deneme dersi ancak ücret ilanında yer alırsa mümkündür; platform bunu desteklemez.
- **Kaynak:** İşletme kuralı (bir kez, en fazla iki katılımcı); ÖÖKY md. 48/2 (mevcut), md. 54/1-b ve c (ilan dışı ücret yasağı).
- **Kurum türü:** `language_school`
- **Kodda:** var — `packages/school-core/src/lib/prospects.ts` (`scheduleTrialLesson`; ayrıntı `DOM-KAY-034`): gerçek ders, aday başına bir kez, derse en fazla 2, kapasite en fazla 18, 18 yaş altında veli onayı; yoklamaya yazılmaz. Seviye/yaş bandı uygunluğu denetlenmez (`TODO(crm-trial-level)`): adayın yapısal hedef seviyesi yoktur (`interest` serbest metin), `state.classes` seviye ve yaş bandı taşımaz, kur ve yaş bandı `language_groups` modelindedir ve deneme dersinin okuduğu ders programıyla bağı yoktur; uygunluğu bugün öğretmen deneme sonrası yazar (`DOM-DIL-031`). Web aday kartı (`ProspectPanel`, deneme dersi takvimi); API `POST /api/v1/prospects/:prospectId/trial-lessons` (`apps/api/src/routes/prospects.ts`; okul kurumunda 404).

### DOM-DIL-031 · Deneme dersi sonucu adayı kaydetmez

- **Kural:** Deneme dersinden sonra öğretmen adayın kartına seviye uygunluğu (`uygun`, `alt kur önerilir`, `üst kur önerilir`) ve kısa not yazar. Bu not aday aşamasını `Teklif verildi` dışına taşımaz; kesin kayıt yalnız kayıt işlemiyle olur (`DOM-KAY-005`).
- **Gerekçe:** Satış hunisi ile akademik karar karışmamalı.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** `language_school`
- **Kodda:** kısmen — core `packages/school-core/src/lib/prospects.ts` (`recordTrialResult`, `recordTrialResultSchema`): dersin grubunun öğretmeni, ders yapıldıktan sonra uygunluğu ve isteğe bağlı kısa notu (en fazla 500 karakter) yazar; yeniden yazılabilir, son karar geçerlidir; aşama, öğrenci kaydı ve yoklama değişmez; yapılmamış ders 409 `trial_not_held`, iptal edilmiş ders 409 `trial_lesson_cancelled`, kapalı aday 409 `prospect_closed`. Yetki `prospect.trialResult` (yalnız `ogretmen`, kapsam dışı grup 404; `DOM-YTK-080`); API `POST /api/v1/prospects/:prospectId/trial-result`. Öğretmen ekranı yoktur (web ve mobil), sonuç adayın kartında ön büroya gösterilmez.

## Grup ve kayıt

### DOM-DIL-040 · Grup kapasitesi en fazla 18

- **Kural:** Bir grubun kapasitesi 1–18 arasındadır; aktif (dondurulmamış) kursiyer + bekleme listesinden yapılmış ve süresi dolmamış teklif (`DOM-DIL-043`) + o derse gelen deneme katılımcısı kapasiteyi aşamaz. Kapasite derslik kapasitesinden de büyük olamaz. Bireysel ders grubu kapasitesi 1'dir.
- **Gerekçe:** Mevzuat kurslarda mevcut tavanı koyar; dil öğretiminde konuşma pratiği küçük grup gerektirir.
- **Kaynak:** ÖÖKY md. 48/2: okul dışındaki kurumlarda tavan 30, özel öğretim kursları ile sosyal etkinlik ve gelişim merkezlerinde 18. Kişisel gelişim kursu ruhsatlı dil okulu için yasal tavan 30 görünür; platform her iki türde muhafazakâr olarak 18'i tavan alır. Tavanı 30'a çıkarmak, ruhsat türü **doğrulandıktan** sonra mevzuat profili değişikliğiyle yapılır, kurum ayarıyla yapılmaz.
- **Kurum türü:** `language_school` (`school` sınıf mevcudu için `DOM-KAY-010`)
- **Kodda:** kısmen — `packages/school-core/src/lib/language-groups.ts` kapasite 1–18 (şema ve tablo `check`), kurun en çok mevcudunu aşamaz (`group_capacity_exceeds_course`) ve aktif kursiyer + süresi dolmamış teklif sayısının altına inemez (`group_capacity_below_members`); doluluk `groupOccupancy` (dondurulan sayılmaz), yerleştirmede 422 `group_full`. Derslik kapasitesi modeli ve deneme katılımcısının ders bazlı sayımı yok; okul sınıf kapasitesi ayrı kuraldır (`DOM-KAY-010`).

### DOM-DIL-041 · Grup seviye ve yaşa göre oluşur

- **Kural:** Kursiyer yalnız yerleştirme seviyesindeki kura bağlı gruba kaydolur; bir alt veya üst kura kayıt öğretmen gerekçesiyle yapılır. Gruplar yaş bandıyla tanımlanır (`çocuk`, `genç` 12–17, `yetişkin` 18+; çocuk bandının alt sınırı programa göre); 18 yaş altı kursiyer yetişkin grubuna, yetişkin genç grubuna yalnız yönetici onayı ve gerekçeyle girer.
- **Gerekçe:** Mevzuat grupların yaş ve bilgi düzeyine göre oluşturulmasını ister; reşit olmayanla yetişkinin aynı grupta olması ayrı bir koruma değerlendirmesi gerektirir.
- **Kaynak:** ÖÖKY md. 48/2; yaş bantları işletme kuralı.
- **Kurum türü:** `language_school`
- **Kodda:** kısmen — grup yaş bandı (`GROUP_AGE_BANDS`: çocuk < 12, genç 12–17, yetişkin 18+) taşır; `planGroupPlacement` seviye farkında öğretmen ya da yönetici gerekçesi (`group_level_mismatch`) ister; bant dışı yaş reddedilir, yalnız 18 yaş altının yetişkin ve yetişkinin genç grubuna girişi yönetici gerekçesiyle açılır (`group_age_band_mismatch`). Birleştirme yaş bandı farklı grupları reddeder. Yerleştirme yazması kayıt akışındadır (ON-058); çocuk bandının programa göre alt sınırı yok.

### DOM-DIL-042 · Grup açılış sayısı ve birleştirme

- **Kural:** Her grubun asgari açılış sayısı (kurum ayarı) vardır. Başlangıç tarihinde asgari sayıya ulaşmayan grup açılmaz; kayıtlı kursiyerlere seçenek sunulur: aynı kurdaki başka gruba geçiş, bekleme veya ücretin tamamının iadesi. Kursiyerin onayı olmadan başka gün/saatteki gruba taşınmaz.
- **Gerekçe:** Kurum kaynaklı iptalde kursiyer kesintiye uğramamalı; tarih/saat sözleşmenin esasıdır.
- **Kaynak:** İşletme kuralı; tam iade, ÖÖKY md. 56/3-b'deki %10 kesintinin kursiyer kaynaklı ayrılış için olduğu yorumuna dayanır — **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** kısmen — `packages/school-core/src/lib/language-groups.ts` `planGroupOpen` açılışı asgari sayıya (kurun `minLearners`) bağlar (422 `group_below_minimum`), başlangıç geçmişse açmaz; `planGroupCancellation` gerekçeyle iptal eder; `planGroupMerge` aynı kur ve yaş bandını birleştirir, kapasiteyi, taşınan kursiyerin saat çakışmasını ve 21.00 sınırını denetler, gün/saat farklıysa kursiyer onayı beyanı ister (`group_merge_consent_required`), kaynak iptal edilir. Açılmış grupta öğretmen ve derslik boşaltılamaz. Başlangıcı geçmiş hiç açılmamış grup açılmaz; kursiyersizse ileri tarihe alınır, kursiyerliyse birleştirilir ya da iptal edilir ve iptale kadar kur arşivini engeller. Uçlar `POST /api/v1/groups/:groupId/open|cancel|merge`. Birleştirmede kaynağın kayıt satırları arşivlenir, taşınan kursiyere hedefte yeni kayıt açılır; kur sonu kararı (`DOM-DIL-070`) kayda bağlı olduğundan taşınmaz: taşınan kursiyerin onay bekleyen kararı varsa birleştirme 422 `progression_pending` ile reddedilir ve hiçbir kayıt değişmez, onaylı ya da reddedilmiş karar arşivlenen eski kayıtta geçmiş olarak kalır (`apps/api/src/db/language-groups.ts` `moveGroupMembers`). Kursiyere seçenek sunma ve iade kayıt/finans akışındadır (ON-058).

### DOM-DIL-043 · Bekleme listesi

- **Kural:** Dolu gruba kayıt isteyen aday bekleme listesine sırayla girer. Yer açılınca sıradaki adaya 48 saat geçerli teklif gider; süre dolarsa sıradakine geçilir. Bekleme listesi kapasiteye sayılmaz ve ödeme alınmaz.
- **Gerekçe:** Adil sıra ve ilan dışı ön ödeme yasağı.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 54/1-c.
- **Kurum türü:** `language_school`
- **Kodda:** kısmen — tablo `language_group_waitlist` (öğrenci ya da aday, grup ya da kur sırası, teklif alanları); `packages/school-core/src/lib/language-groups.ts` `waitlistQueue` (istek anı sırası), `suggestWaitlistOffers` (süresi dolanlar ve boş yer kadar 48 saatlik teklif önerisi, saf); süresi dolmamış teklif kapasiteye sayılır. Okuma `GET /api/v1/groups/:groupId/waitlist` (yönetici, ön büro); sıraya alma ve teklif yazması kayıt akışındadır (ON-058).

### DOM-DIL-044 · Kurumlar arası nakil yoktur

- **Kural:** Kursiyerin başka bir kurumdaki kurdan "nakil" ile devam etmesi kaydedilmez; dışarıdan gelen kursiyer seviye tespitiyle kayıt olur. İstisna olarak kurumun kapanması veya kursiyerin il/ilçe değiştirmesi hâlinde aynı programın kalan bölümüne kayıt yapılır ve önceki kurum ile tamamlanan saat kaydedilir. Bir seviyeyi tamamlayan kursiyer üst seviyeye başka kurumda devam edebilir; bu yeni kayıttır.
- **Gerekçe:** Mevzuat kurslar arası nakli yasaklar, istisnalarını sayar.
- **Kaynak:** ÖÖKY md. 51/7.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-045 · Kursiyer kaydının zorunlu alanları

- **Kural:** Kesin kayıtta kursiyerin T.C. kimlik no (yabancı için yabancı kimlik no veya pasaport), ad soyad ve doğum tarihi zorunludur. Kayıt MEBBİS'e işlenene kadar `MEBBİS'e işlenmedi` durumunda görünür (`DOM-KAY-015`). Bir kursiyer aynı program içinde aynı anda yalnız bir gruba kayıtlıdır; farklı programlarda (ör. genel İngilizce + IELTS) saatleri çakışmamak şartıyla iki kaydı olabilir.
- **Gerekçe:** Kurs kayıtları MEBBİS üzerinden yapılır ve bu bilgiler kayıtta istenir.
- **Kaynak:** ÖÖKY md. 51/7, 51/11.
- **Kurum türü:** `language_school`
- **Kodda:** kısmen — aynı kurda tek grup `planGroupPlacement` (409 `group_member_same_course`) ve farklı kur gruplarında saat çakışması (422 `learner_schedule_conflict`); tablo `language_group_members` grupta tekil kursiyer tutar. Kimlik alanları ve MEBBİS durumu kayıt akışındadır.

## Paket, saat satışı ve esnek dönem

### DOM-DIL-050 · Ücret ders saati üzerinden

- **Kural:** Dil okulunda öğrenim ücreti ders saati ücreti olarak ilan edilir. Kur veya paket fiyatı = ders saati sayısı × ilan edilen saat ücreti − ilanda yer alan indirimler. İndirim toplamı ilan edilen ücretin %50'sini aşamaz (kurucunun kurumlarında çalışan personelin çocukları hariç); ilan üstü fiyat girilemez, ilan altı fiyat girilebilir. Kitap, materyal ve sınav hazırlık setleri ayrı ilan edilen ücret kalemidir.
- **Gerekçe:** Mevzuat kurslarda ücreti ders saati üzerinden hesaplatır ve indirimi sınırlar.
- **Kaynak:** ÖÖKY md. 54/1-a ve d, md. 55/1-c, md. 53/5. Ayrıntı `DOM-FIN`.
- **Kurum türü:** `language_school`
- **Kodda:** çelişiyor — kayıt tutarı serbest toplam TL, saat bilgisi yok (`packages/school-core/src/lib/domain.ts:27-31`).

### DOM-DIL-051 · Saat bakiyesi hesaplanır ve yanmaz

- **Kural:** Paket saat bakiyesi saklanmaz; satın alınan saat − tüketilen saat − iade edilen saat olarak hesaplanır. Grup kurunda tüketim, kursiyerin kayıtlı olduğu sürede yapılmış derslerin saatidir (kursiyerin devamsızlığı saati geri vermez). Bireysel/esnek pakette tüketim, gerçekleşen ve geç iptal edilen (`DOM-DIL-054`) derslerdir. Paketin kullanım süresi olabilir; süre dolduğunda kullanılmayan saatler silinmez, kursiyerin seçimine göre süre uzatılır veya `DOM-FIN-040` ile iade hesabına girer.
- **Gerekçe:** Hesaplanabilen değer saklanmaz; mevzuat ayrılanlara alınmamış ders saatlerinin iadesini öngörür, "kullanılmayan saat yanar" koşulu bununla çelişir.
- **Kaynak:** ÖÖKY md. 56/3-b ve 4 (iade bir ay içinde); süre dolumunda yanma yasağının 6502 açısından değerlendirilmesi **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-052 · Kayıt dondurma

- **Kural:** Kursiyer (18 yaş altında veli) gerekçeyle kayıt dondurma ister; yönetici onaylar. Dondurma kur sınırında başlar (kur bitiminde veya yeni kur başlamadan). Kur ortasında dondurma yalnız sağlık, askerlik, taşınma, iş/okul takvimi gibi belgeli nedenle olur; bu durumda kursiyer o kuru `tamamlamadı` olarak kapatır ve kalan ders saatleri bakiyeye geçer. Dondurma süresinde saat tüketilmez, devamsızlık yazılmaz, kursiyer grup kapasitesinde yer tutmaz (dönüşte aynı grup garanti edilmez). Bir kayıtta toplam dondurma 6 ayı geçemez; süre dolunca kursiyer döner veya ayrılış (`DOM-KAY-024`) ve iade (`DOM-FIN-040`) işlemi açılır. Dönüşte 90 günü aşan dondurmada seviye tespiti yenilenir (`DOM-DIL-012`). Dondurma ayrılış değildir; taksit planı dondurma süresince ertelenir ve yeni plan kursiyere/veliye onaylatılır.
- **Gerekçe:** Yetişkin kursiyerlerde ara verme yaygındır; kur ortasında dondurup başka gruba dönmek devam ve kur geçme hesabını bozar.
- **Kaynak:** İşletme kuralı (ÖÖKY'de dondurma hükmü bulunamadı). MEBBİS'teki kursiyer kaydına etkisi (kayıt kapatma/yeniden açma) **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-053 · Esnek dönem

- **Kural:** Dil okulunun dönemi eğitim-öğretim yılına bağlı değildir; her kurun kendi başlangıç, bitiş, toplam saat ve haftalık planı vardır ve kurlar yıl içinde her hafta başlayabilir. Raporlar takvim aralığına göre alınır. Ruhsat türü özel öğretim kursu olan kurumda program başına haftalık ders 3–8 saat ve yıllık takvim 18–36 hafta aralığında kalır.
- **Gerekçe:** Dil okulu sürekli kayıt alır; özel öğretim kursları için mevzuat haftalık ve yıllık sınır koyar.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 10/9 (özel öğretim kursları).
- **Kurum türü:** `language_school`
- **Kodda:** yok — `academicYear` tamsayı yıl modelidir.

### DOM-DIL-054 · Ders iptali ve telafi

- **Kural:** Kurum kaynaklı iptal edilen grup dersi kurun toplam saatinden düşmez; kur bitişinden önce telafi dersi planlanır ve kursiyerlere bildirilir. Bireysel derste kursiyer 24 saat öncesine kadar ücretsiz iptal eder; daha geç iptal veya gelmeme tüketilmiş saat sayılır. Eğitmen kaynaklı iptal hiçbir zaman saat tüketmez.
- **Gerekçe:** Kursiyer satın aldığı saati almalıdır; son dakika iptali eğitmen saatini boşa harcatır.
- **Kaynak:** İşletme kuralı (24 saat).
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Devam

### DOM-DIL-060 · Devam şartı: kur süresinin en az 4/5'i

- **Kural:** Kur sonu sınavına girebilmek için kursiyerin kurun toplam ders saatinin en az 4/5'ine katılmış olması gerekir; 1/5'ten fazla devamsızlık yapan kursiyer sınava alınmaz ve kuru `devamsızlıktan tamamlamadı` olarak bitirir. Devam oranı ders saati bazında hesaplanır, saklanmaz. Mevzuat özürlü/özürsüz ayrımı yapmadığından özürlü devamsızlık da sayılır. Kurum daha sıkı oran tanımlayabilir, daha gevşek tanımlayamaz.
- **Gerekçe:** Kurslara devam zorunludur.
- **Kaynak:** ÖÖKY md. 10/8.
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/progression.ts` `attendanceSummary` (ders saati satırlarından, saklanmaz; gereken saat kur saatinin kurum oranıyla çarpımının tavanı, tamsayı hesapla; yoklaması alınmamış saat katılmış sayılmaz, sonuç `eligible`/`ineligible`/`pending`) ve `progressionSettingsSchema` (oran binde tamsayı `minAttendancePermille`, 800–1000, varsayılan `MIN_ATTENDANCE_PERMILLE` = 800; daha gevşek ya da tamsayı olmayan değer şemada reddedilir; karşılaştırma `katılım × 1000 ≥ oran × toplam` tamsayı aritmetiğiyle yapılır, kayan nokta yok). Girdi ders saati satırıdır (`lessonHourAttendanceSchema`); mevcut gün bazlı yoklama (`packages/school-core/src/lib/domain.ts`) değişmedi ve bu hesaba bağlı değildir: ders saati yoklaması F5b'de ayrı gelir API (OG-086): ders saati satırları salt okunur `lesson_hour_attendances` tablosundadır (migration 0052); yoklama alma ucu yoktur (`TODO(cefr-ders-saati-yoklamasi)`, OG-269). Satır yokken devam `pending` kalır ve kur sonu kararı 409 `attendance_pending` olur; grup tablosu (`GET /api/v1/groups/:groupId/progression`) engeli gösterir (ADR 0004).

### DOM-DIL-061 · Yoklama ders saati bazlıdır

- **Kural:** Yoklama her ders saati için alınır (`katıldı`, `geç`, `gelmedi`). Geç kalan kursiyer o ders saatine katılmış sayılır; ders saatinin yarısından fazlasını kaçıran kursiyer o saat için `gelmedi` yazılır. Gelecek ders için yoklama alınmaz; aynı ders saati için ikinci yoklama kaydı açılmaz, düzeltme kayıt geçmişine yazılır. Dondurulmuş kursiyer yoklama listesinde yer almaz.
- **Gerekçe:** Devam şartı ve saat tüketimi ders saatiyle ölçülür; denetimde MEBBİS'teki ders saatleriyle karşılaştırılır.
- **Kaynak:** ÖÖKY md. 10/8, md. 67/5; yarım saat eşiği işletme kuralı.
- **Kurum türü:** `language_school`
- **Kodda:** çelişiyor — yoklama sınıf ve gün bazlıdır, durumlar `present/absent/late/excused` (`packages/school-core/src/lib/domain.ts:111-113`). Devam hesabının girdisi olarak ders saati satırı `packages/school-core/src/cefr/progression.ts` `lessonHourAttendanceSchema`'dadır (`present`/`late`/`absent`, geç katılmış sayılır, aynı ders saatinin ikinci satırı reddedilir); yoklama kaydı, düzeltme geçmişi ve uç F5b'dedir.

### DOM-DIL-062 · Devamsızlık bildirimi

- **Kural:** Kursiyerin devamsızlığı kur saatinin %10'una ulaşınca, ve %15'e ulaşınca ikinci kez kursiyere (18 yaş altında veliye de) bildirim gider; ikinci bildirim "%20'yi aşarsa kur sonu sınavına giremez" uyarısını içerir.
- **Gerekçe:** Kursiyer sınır aşılmadan uyarılmalı.
- **Kaynak:** İşletme kuralı (eşikler).
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/progression.ts` `ABSENCE_NOTICES` ve `absenceNoticeDue` (eşiğe ulaşıldığı an; gönderilmiş bildirimler girdi, aynı eşik iki kez önerilmez; iki eşik birlikte aşılırsa yalnız ikinci; ikinci eşik gönderildiyse yoklama düzeltmesiyle oran düşse de alttaki (birinci) bir daha önerilmez; ikinci bildirim `warnsExamBar` ve `absence_notice_second_exam_bar` metin anahtarı taşır, uyarı kurumun devam sınırını yazar; devamsızlık kurumun sınırını zaten aştıysa (`examBarred`, kalan saatlerin hepsine katılsa da şart sağlanamaz) bildirim `absence_notice_exam_barred` anahtarıyla "sınırını aştı; kur sonu sınavına girilemez" der; 18 yaş altında alıcı veli de, yaş Europe/Istanbul gününe göre `isMinorOn`; doğum tarihi gerçek takvim günü olmalı, `birth_date_invalid`; geçersiz `now` `invalid_now`). Kurum oranı sıkıysa eşikler domain'de yok, sabit kalır (`TODO(cefr-bildirim-kurum-orani)`). Gönderim ve kayıt F5b'dedir.

## Kur geçme ve kur atlama

### DOM-DIL-070 · Kur geçme kararı

- **Kural:** Kur sonunda karar `geçti`, `tekrar` veya `devamsızlıktan tamamlamadı` olur. `geçti` için üç koşul birlikte gerekir: devam şartı (`DOM-DIL-060`), kur sonu değerlendirmesinde 100 üzerinden kurum eşiğine (varsayılan 60) ulaşmak, dört becerinin her birinde ayrı ayrı 100 üzerinden 50'ye ulaşmak. Karar öğretmen tarafından verilir ve akademik koordinatör onaylar; seviye önerisi (`DOM-BEC-030`) karara gerekçe olarak eklenir ama kararı kendisi vermez. Onaylanmış karar değişmez; düzeltme gerekçeli yeni karar kaydıyla yapılır. Kaydın geçerli kurum başarı belgesi varken düzeltme onaylanmaz; önce belge iptal edilir (`DOM-DIL-082`, 422 `certificate_cancel_first`).
- **Gerekçe:** Tek bir toplam puan zayıf bir beceriyi gizler; makine önerisi denetlenebilir öğretmen kararının yerini almaz.
- **Kaynak:** İşletme kuralı (eşikler). ÖÖKY md. 46/4 ve 46/A başarının tespitini Bakanlık esaslarına bağlar; MEB'in kurs başarı ölçütü **doğrulanmalı** ve kurum eşiği bu ölçütün altına inemez.
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/progression.ts` `PROGRESSION_OUTCOMES` (`passed`/`repeat`/`incomplete_attendance`), `evaluateProgression` (devam şartı yoksa yalnız `incomplete_attendance`, ölçme aranmaz; devam belirsizse veya üç ölçme tamamlanmamışsa karar yok; `passed` için kur sonu puanı kurum eşiğine ve dört becerinin her biri 50'ye ulaşmalı, koşullar sağlansa da `repeat` verilebilir; dayanak kopyası `progressionBasisSchema`), `planProgressionDecision` (grubun öğretmeni önerir, onay bekler; koşulsuz sonuç alan yollu `DomainError`; seviye önerisi `evidenceSnapshot` olarak gerekçeye girer), `planProgressionReview` (onayı yalnız akademik koordinatör verir ya da gerekçeyle reddeder; F4a2 `RubricRater.coordinator` ile aynı bayrak modeli, yönetici rolü yerine geçmez, `TODO(cefr-koordinator-kapsam)`; kararı veren onaylayamaz; onayda koşullar yeniden hesaplanır ve dayanak öneri anındakinden farklıysa `progression_basis_changed` ile reddedilir, öğretmen yeniden önerir, anahtar sırası farkı sayılmaz) ve `effectiveProgressionDecision` (düzeltme `correctsDecisionId` ile geçerli onaylı karara referans veren gerekçeli yeni karardır; onaylı karar değişmez). Eşikler kur sonu ölçmesine uygulanır, ara ölçme tamamlanmış olmalı ve kopyaya girer (`TODO(cefr-ara-olcme-agirligi)`); MEB ölçütü doğrulanmadığından kurum eşiği 60'ın altına inemez (`TODO(cefr-meb-esigi)`) API (OG-086; IST-062): `apps/api/src/services/progression.ts`, `routes/progression.ts`; modül `academic`, yalnız dil okulunda. `POST /api/v1/progression-decisions` (grubun öğretmeni önerir), `POST /api/v1/progression-decisions/:decisionId/approve|reject` (yalnız kurun seviyesinin akademik koordinatörü, `If-Match` satır sürümü; kararı veren onaylayamaz, yönetici onaylayamaz; eşzamanlı ikinci onay 409), `GET /api/v1/groups/:groupId/progression` (kursiyer başına devam, ölçme, koşul, karar ve üst kur çıktısı), `GET /api/v1/students/:studentId/progression-decisions` (öğrenci ve 18 yaş altı kursiyerin velisi yalnız onaylı kararı gerekçesiz görür). Onaylı `passed` kararında yanıt `progressionNextStep` çıktısını (`next`) taşır; yenileme teklifi bunu okur (ON-030). Yoklama yazma ucu olmadığından üretimde karar bugün 409 `attendance_pending` döner (`DOM-DIL-060`). Kurum eşiği ayarı saklanmaz, varsayılan kullanılır (`TODO(cefr-kur-ayari)`); ekran sonraki adımdır (ADR 0004).

### DOM-DIL-071 · Kur atlama ve kur tekrarı

- **Kural:** Kursiyer kur ortasında bir üst kura yalnız ara değerlendirmede beceri profilinin üst kura işaret etmesi, öğretmen önerisi ve koordinatör onayıyla geçer; kalan saat yeni kura aktarılır, fiyat farkı varsa ilan fiyatıyla hesaplanır. Tekrar kararı alan kursiyer aynı seviyedeki kuru yeniden alır; tekrar kuru yeni satıştır ve indirim uygulanacaksa ilanda yer alır.
- **Gerekçe:** Hızlı ilerleyen kursiyer tutulmamalı, ama atlama kanıta dayanmalı.
- **Kaynak:** İşletme kuralı; ÖÖKY md. 54/1-a.
- **Kurum türü:** `language_school`
- **Kodda:** yok — F5a2 kapsamı dışında bırakıldı (`cefr/progression.ts` kur atlama içermez).

### DOM-DIL-072 · Yanlış yerleştirme düzeltmesi

- **Kural:** Kurun ilk iki haftasında öğretmen yerleştirmenin yanlış olduğunu bildirirse kursiyer bir alt veya üst kura ücret farkı dışında masrafsız geçirilir; tüketilen saat yeni kurdan düşer. İki haftadan sonra geçiş `DOM-DIL-071` ile yapılır.
- **Gerekçe:** Seviye tespitinin hatası kursiyere yüklenmemeli.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** `language_school`
- **Kodda:** yok — F5a2 kapsamı dışında bırakıldı; düzeltme kararı türü `level_decisions.kind = correction` olarak ayrılmıştır.

## Belgeler

### DOM-DIL-080 · MEBBİS Kurs Bitirme Belgesi

- **Kural:** Kursu bitiren ve sınavda başarılı olan kursiyere Kurs Bitirme Belgesi MEBBİS'te düzenlenir. Platform bu belgeyi üretmez veya taklit etmez; yalnız belgeye hak kazanan kursiyer listesini çıkarır ve belgenin MEBBİS'te düzenlendiğini (belge no, tarih, işleyen) işaretler. Devam şartını sağlamayan veya sınavda başarısız olan kursiyer listeye girmez.
- **Gerekçe:** Resmî belge yalnız MEB sisteminde düzenlenir.
- **Kaynak:** ÖÖKY md. 46/4 (EK-6), md. 10/8.
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/certificates.ts` `planMebbisRecord` (yalnız kaydın geçerli onaylı `passed` kararı; karar başına bir iz, 409 `mebbis_already_recorded`; tarih Europe/Istanbul gününden ileri olamaz, 422 `mebbis_date_in_future`; yönetici ya da kurun seviyesinin akademik koordinatörü) ve `mebbisEligibleDecisionId` (devamsızlık, tekrar ve onaysız karar listeye girmez). Platform resmî belgeyi üretmez. API (OG-088): tablo `mebbis_certificate_records` (değişmez satır, migration 0053), `GET /api/v1/groups/:groupId/mebbis-certificates` (hak kazananlar ve iz; yönetici, grubu okuyan öğretmen), `POST /api/v1/progression-decisions/:decisionId/mebbis-record` (belge no ve tarih); modül `academic`, okulda 404. Web (OG-088): "Başarı Belgeleri" sayfasının "Belgeye hak kazananlar" sekmesi (`apps/web-react/src/pages/language/CertificatesPage.tsx`, grup seçimi, MEBBİS listesi ve CSV, "MEBBİS'te düzenlendi" penceresi `CertificateDialogs.tsx`); kancalar `packages/react-shared/src/use-course-certificates.ts`.

### DOM-DIL-081 · Kurum başarı belgesi

- **Kural:** Platformun ürettiği belge "kurum başarı belgesi"dir ve öyle adlandırılır. Belgede kur adı, toplam ders saati, devam oranı, kurum değerlendirmesine göre seviye ve beceri profili yer alır; seviye ifadesi "kurum değerlendirmesine göre CEFR B1 düzeyinde" biçimindedir. "CEFR sertifikası", "Avrupa Konseyi onaylı" gibi ifadeler ve MEB amblemi kullanılmaz. Belgenin doğrulama kodu vardır.
- **Gerekçe:** CEFR bir sınav veya sertifika değildir; Avrupa Konseyi kurumları onaylamaz. Resmî belge görünümü yanıltıcıdır.
- **Kaynak:** CEFR-CV; Cambridge English, "Using the CEFR: Principles of Good Practice" (CEFR bir onay mührü değildir). Belge PDF şablonu kuralları proje `CLAUDE.md`'dedir.
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/certificates.ts` `planCertificateIssue` (yalnız kaydın geçerli onaylı `passed` kararıyla; onay bekleyen 422 `certificate_decision_pending`, tekrar ve devamsızlık 422 `certificate_not_eligible`), içerik `certificateContentSchema` düzenleme anının kopyasıdır (kur adı, toplam ders saati, devam binde, `certificateLevelStatement` "kurum değerlendirmesine göre CEFR B1 düzeyinde", kur sonu beceri puanları) ve `FORBIDDEN_CERTIFICATE_PHRASES` ("CEFR sertifikası", "Avrupa Konseyi" …; Türkçe küçük harfle ve `ı` `i` sayılarak, "AVRUPA KONSEYI" de) reddedilir. Belgeyi kurum yöneticisi ya da kurun seviyesinin akademik koordinatörü düzenler (`canIssueCertificate`; Sabah kararı 85), düz öğretmen 403 `permission_denied`. API (OG-088): `apps/api/src/services/certificates.ts`, `routes/certificates.ts`; tablo `course_certificates` (migration 0053); `POST /api/v1/course-certificates` (`Idempotency-Key` zorunlu), `GET /api/v1/course-certificates` ve `/:certificateId` (öğrenci ve 18 yaş altı kursiyerin velisi yalnız geçerli belgeyi, düzenleyen ve iptal izi olmadan görür). Web (OG-088): "Başarı Belgeleri" sayfası (`apps/web-react/src/pages/language/CertificatesPage.tsx`; personelde "Belgeler" listesi ve "Belgeye hak kazananlar" sekmesinden düzenleme onayı, öğrenci ve velide "Başarı Belgelerim"), satır modeli `certificate-rows.ts`. PDF (OG-088): `apps/web-react/src/lib/pdf/templates/course-certificate.ts` düzenleme anının kopyasından üretilir, yasak ifade içeren içerik PDF olmaz; QR (`lib/pdf/qr.ts`, `qr` paketi, tembel yüklenir) ve doğrulama kodu belgededir; iptal edilmiş belge "İPTAL EDİLDİ" işaretiyle üretilir. e2e `tests/e2e-react/kurum-basari-belgesi.spec.ts`.

### DOM-DIL-082 · Belge numarası ve iptal

- **Kural:** Kurum başarı belgesinin numarası kurum içinde tekildir ve yeniden kullanılmaz. Düzenlenmiş belge değiştirilmez; hata varsa belge `iptal` edilir ve yeni numarayla yeniden düzenlenir. Doğrulama sorgusu iptal edilmiş belge için "iptal edildi" döner ve kişisel veri olarak yalnız ad-soyad baş harflerini, kur ve tarihi gösterir. Bir kur kaydının en çok bir geçerli belgesi olur (Sabah kararı 86): kur sonu kararı düzeltilecekse önce belge iptal edilir, düzeltme `geçti` ise yeni belge iptal edilenin yerine düzenlenir.
- **Gerekçe:** Belge sahteciliğine ve sessiz değişikliğe karşı iz bırakılır; doğrulama sayfası kişisel veri sızdırmamalı.
- **Kaynak:** İşletme kuralı; KVKK md. 4 (ölçülülük).
- **Kurum türü:** `language_school`
- **Kodda:** core kuralı — `packages/school-core/src/cefr/certificates.ts` `formatCertificateNumber` (`KB-<İstanbul yılı>-<6+ hane sıra>`), `formatVerificationCode` (140 bit Crockford base32, numaradan bağımsız), `normalizeVerificationCode`, `planCertificateCancellation` (gerekçeli, bir kez; 409 `certificate_already_cancelled`) ve `certificateVerificationView` (yalnız durum, baş harfler, kur, gün, kurum adı). API (OG-088): sıra kurum sayacından kilitli artırmayla alınır (`certificate_counters`, yalnız artar; tetikleyici `kampus_certificate_counter_guard`), belge yalnız geçerliden iptale bir kez değişir (`kampus_certificate_guard`); kur kaydı başına tek geçerli belge (core `planCertificateIssue` kaydın bütün belgelerine bakar, 409 `certificate_already_issued`; kısmi tekil indeks `course_certificates_valid_enrollment_key`), iptalin yerine `replacesCertificateId` ile tek belge (409 `certificate_already_replaced`); kaydın iptal edilmiş ve yerine belge düzenlenmemiş belgesi varsa `replacesCertificateId` zorunludur (422 `certificate_replacement_required`). Kaydın geçerli belgesi varken kararın düzeltmesi onaylanmaz: core `planProgressionReview` 422 `certificate_cancel_first` ("Önce düzenlenmiş belge iptal edilmeli"), servis belgeleri onayın kurum kilidi altında aynı transaction'da okur; ret engellenmez. `POST /api/v1/course-certificates/:certificateId/cancel` (`If-Match`). Kimliksiz `GET /api/v1/certificate-verifications/:code` modülden bağımsızdır (Sabah kararı 85), bozuk ve bulunamayan kod aynı 404, IP başına dakikada 30 istek (IPv6'da /64 öneki başına, `verificationRateKey`; sayaç süreç içidir); kod indeksi kurumsuz tekildir (belgelenmiş istisna, `schema/certificates.ts`) ve kod loglanmaz. Web (OG-088): kimliksiz doğrulama sayfası `/belge-dogrula/:code?` (`apps/web-react/src/pages/verification/CertificateVerificationPage.tsx`, görünüm modeli `verification-view.ts`); oturum gerekmez, kod adresten ya da formdan gelir ve `normalizeVerificationCode` ile kanonik biçime iner, biçimi bozuk kod istek atmadan reddedilir; yalnız API alanları gösterilir, iptal uyarı tonunda, 404 "Belge bulunamadı", 429 "Çok fazla deneme". Rota sabiti, QR adresi ve router `basename`'i (Vite `BASE_URL`) `lib/certificate-verification.ts`'ten gelir; QR adresinin rotaya çözülmesi `apps/web-react/tests/certificate-verification.test.ts`'te sabitlenir. Belge iptal edildiğinde web listesi iptal penceresiyle (`CertificateDialogs.tsx`, gerekçe, `If-Match`) yönetilir; iptalin yerine yeni belge "Yeniden düzenle" ile düzenlenir. Eşzamanlı düzenleme (aynı karar ve aynı kaydın iki kararı) `test:pg` takımında sınanır (`pg-certificates.test.ts`).

## Kursiyer türleri

### DOM-DIL-090 · Yetişkin kursiyerin velisi yoktur

- **Kural:** Kayıt tarihinde 18 yaşını doldurmuş kursiyer kendi hesabıyla kaydolur; veli kaydı açılmaz. Sözleşme tarafı kursiyerdir; ödeyici kursiyer veya kurumsal kayıtta işverendir. Kursiyerin verisi (devam, not, ses kaydı) üçüncü kişilere (eş, ebeveyn, işveren) gösterilmez; kursiyer isterse sınırlı yetkili kişi tanımlar (`DOM-DIL-093`). Yaş, doğum tarihinden Europe/Istanbul gününe göre hesaplanır.
- **Gerekçe:** Ergin kişi kendi adına sözleşme yapar; verisine erişim onun kararıdır.
- **Kaynak:** 4721 sayılı TMK md. 11–12 (erginlik) — **doğrulanmalı**; KVKK md. 5.
- **Kurum türü:** `language_school`
- **Kodda:** çelişiyor — kesin kayıt her öğrenci için yeni veli üretir (`packages/school-core/src/lib/domain.ts:280,314-318`).

### DOM-DIL-091 · Reşit olmayan kursiyer

- **Kural:** 18 yaş altı kursiyer en az bir veliye bağlanır; sözleşmeyi veli yapar, onayları veli verir (`DOM-KAY-012`). Veli yalnız kendi çocuğunun devam, ilerleme ve ödeme bilgisini görür. Zorunlu eğitim çağındaki kursiyerin ders saatleri `DOM-DIL-003` sınırına uyar; ruhsat türü özel öğretim kursu olan kurumda kursiyerin MEBBİS kaydı e-Okul ile ilişkilendirilir ve kursiyer yalnız sınıf düzeyine uygun programa kaydolur.
- **Gerekçe:** Reşit olmayanı yasal temsilcisi temsil eder; özel öğretim kursları için e-Okul bağı zorunludur.
- **Kaynak:** ÖÖKY md. 51/12 (özel öğretim kursları), md. 10/6; TMK — **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-092 · 18 yaşa giriş

- **Kural:** Kayıtlı kursiyer 18 yaşına girdiği gün veli erişimi askıya alınır ve kursiyere bildirilir; kursiyer onaylarsa veli `yetkili kişi` olarak kalır. Veli imzalı mevcut sözleşme ve ödeyici süre sonuna kadar değişmez; yeni sözleşmeyi kursiyer yapar.
- **Gerekçe:** Erginlikle birlikte veri üzerindeki karar kişinin kendisine geçer; devam eden borç ilişkisi kendiliğinden el değiştirmez.
- **Kaynak:** İşletme kuralı; KVKK md. 5; borç ilişkisinin devamı **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-093 · Kurumsal kursiyer ve yetkili kişi

- **Kural:** İşverenin ödediği kurumsal eğitimde işverene yalnız devam oranı ve kur sonucu raporlanır; bunun için kursiyere kayıtta aydınlatma yapılır. Yazma ürünleri, ses kayıtları ve öğretmen yorumları işverene verilmez. Yetişkin kursiyerin tanımladığı yetkili kişi de yalnız kursiyerin seçtiği alanları görür ve kursiyer yetkiyi her an geri alabilir.
- **Gerekçe:** Ödeyici olmak verinin tamamına erişim hakkı vermez; ölçülülük.
- **Kaynak:** KVKK md. 4, 10; işveren raporunun hukuki dayanağı (sözleşmenin ifası mı açık rıza mı) **doğrulanmalı**.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

### DOM-DIL-094 · Başarı durumu sıralanıp yayımlanmaz

- **Kural:** Kursiyerlerin puanları, seviyeleri ve devam durumları adla sıralanmaz, grup içinde veya herkese açık lider tablosunda gösterilmez. Grup raporları öğretmene ve yöneticiye açıktır; kursiyer yalnız kendi sonucunu ve grup ortalamasını görür.
- **Gerekçe:** Mevzuat kursiyerlerin kişisel bilgileri ile başarı durumlarının e-Özel ve denetim yetkilileri dışında paylaşılmasını yasaklar.
- **Kaynak:** ÖÖKY md. 46/9 (özel öğretim kursları); kişisel gelişim kursunda da KVKK md. 4 gereği uygulanır.
- **Kurum türü:** `language_school`
- **Kodda:** yok.

## Mevcut kodla farklar

| Kural       | Fark                                                                                                                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM-DIL-001 | Kur (`lib/courses.ts`, tablo `courses`) ve `language_school` türü var; grup kura bağlı (`language_groups`), devam ve kur geçme henüz kura bağlı değil, ders/sınıf düzeyi modeli sürüyor.                                     |
| DOM-DIL-008 | Paket satışı (ON-058) yok; ruhsat türüne göre haftalık saat/süre sınırı (`DOM-DIL-053`) uygulanmıyor.                                                                                                                        |
| DOM-DIL-040 | Dil grubu tavanı 18 uygulanıyor; derslik kapasitesi ve ders bazlı deneme katılımcısı sayımı yok. Okul sınıf kapasitesi 40'a kadar girilebiliyor (`packages/school-core/src/lib/school-management.ts`).                       |
| DOM-DIL-050 | Kayıt tutarı serbest TL toplamıdır, ders saati ve saat ücreti yok (`packages/school-core/src/lib/domain.ts:27-31`).                                                                                                          |
| DOM-DIL-053 | Dönem `academicYear` tamsayı yıldır; kur bazlı esnek dönem yok.                                                                                                                                                              |
| DOM-DIL-061 | Yoklama gün bazlıdır ve `excused` durumu vardır; ders saati bazlı yoklama yok (`packages/school-core/src/lib/domain.ts:111-113`). Devam hesabı (`cefr/progression.ts`) ders saati satırı bekler, gün bazlı yoklamayı okumaz. |
| DOM-DIL-090 | Her kesin kayıt yeni veli üretir; velisiz yetişkin kursiyer kaydı yapılamaz (`packages/school-core/src/lib/domain.ts:280,314-318`).                                                                                          |
