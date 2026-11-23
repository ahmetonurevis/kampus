# ADR 0008 · Üçüncü kurum türü: kurs (`course_center`)

- Durum: Kabul edildi (kullanıcı kararı 2 Kasım 2026); ayrıntılar sabah gözden geçirilecek
- Genişlettiği: ADR 0001 karar 4 (kurum türleri `school`, `language_school`)
- İster: IST-001 · Görev: OG-033
- Karar veren: Oğuzhan Demirci (türü ekleme kararı kullanıcının; aşağıdaki ayrıntılar bu ADR'nin önerisidir)

## Bağlam

ADR 0001 iki kurum türü tanımlar: `school` (ortaokul ve lise; ders + kazanım) ve `language_school` (CEFR seviyesi + beceri). Üniversite hazırlık (YKS), KPSS akademisi ve LGS kursu gibi sınav hazırlık kursları ikisine de uymaz:

- Okul değildir: sınıf geçme, karne, e-Okul yoktur; kursiyer çoğu zaman başka bir okulun öğrencisidir ya da mezundur. Resmî kayıt MEB özel öğretim kursu olarak e-Özel/MEBBİS'tedir (ister listesi, "e-Özel" satırı).
- Dil okulu değildir: düzey CEFR değil, hazırlanılan sınavın oturumudur (TYT, AYT, GY-GK, ÖABT); kur/grup açılışı, seviye tespiti ve paket saati yoktur.
- İşin merkezinde deneme sınavı, optik okuma, konu eksiği ve etüttür. Bunlar bugün yalnız `school`'da açıktır (DOM-YTK-012).
- KPSS ve YKS mezun kursiyerlerinin çoğu 18 yaş üstüdür; okul kuralı (her yaşta veli) bu kitleye uymaz.

Kayıt kuralı bu türü önceden öngörmüştür: DOM-KAY-012 "kurs türleri (`language_school`; ileride üniversiteye hazırlık, KPSS akademisi gibi kurslar)" der ve `lib/enrollment.ts` `isCourse` okul dışındaki her türü kurs sayar.

## Kararlar

Her karar "Seçenekler / karar / gerekçe" biçimindedir.

### 1. Tür adı ve terminoloji

**Seçenekler (tür adı):** (a) `exam_prep`, (b) `tutoring_center`, (c) `course_center`.
**Karar:** `course_center`; görünen adı "Kurs".
**Gerekçe:** Mevzuattaki adı "özel öğretim kursu"dur; sınav hazırlık bugünkü kitlesidir ama aynı tür ileride mesleki/hobi kurslarını da taşıyabilir. `tutoring` adı zaten "Otomatik Etüt" modülünündür (`tutoring`), karışırdı.

**Kayıtlı kişi.** Seçenekler: "öğrenci" (sektörün gündelik dili) / "kursiyer" (mevzuat, e-Özel, dil okulu). **Karar:** "Kursiyer". **Gerekçe:** e-Özel listesi, kurs bitirme belgesi ve DOM-KAY-012 aynı terimi kullanır; dil okuluyla aynı kalıp olduğu için kayıt, finans ve rıza ekranları üçüncü bir metin dalı istemez. Okul öğrencisi olan kursiyer için de terim değişmez; ekran gerekirse "lise öğrencisi" bilgisini ayrı alan olarak gösterir.

**Öğretim birimi.** Seçenekler: "sınıf" / "şube" / "grup". **Karar:** "Sınıf". **Gerekçe:** Kurslarda "TYT-1 sınıfı", "12 Sayısal A" kullanımı yaygındır ve veri modeli okulun `classes` koleksiyonudur. "Grup" dil okulunda kura bağlı, takvimli açılışı olan ayrı bir kayıttır (`language_groups`); aynı adı vermek iki farklı modeli tek terimle karıştırırdı. "Şube" okulda sınıf düzeyinin alt bölümüdür; kursta sınıf düzeyi olmadığı için anlamsızdır.

**Eğitimci.** Seçenekler: "öğretmen" / "eğitmen". **Karar:** "Öğretmen". **Gerekçe:** Özel öğretim kurumlarında çalışan kadro mevzuatta öğretmendir; rol anahtarı (`ogretmen`) ve yetki kuralları zaten bu addadır.

**Düzey ve ölçme birimi:** düzey "Program", ölçme birimi "Konu" (karar 2).

Tablo: `packages/school-core/src/lib/institution-types.ts` `TERMINOLOGY`, `INSTITUTION_TYPE_LABELS`.

### 2. Seviye modeli: sınav programı + ders + konu ağacı

**Seçenekler:** (a) Okulun sınıf düzeyi + MEB kazanımını kullanmak; (b) dil okulunun kur modelini sınav adlarıyla doldurmak; (c) ayrı program modeli: sınav → oturum (ve isteğe bağlı puan türü) → ders (soru sayısıyla) → konu ağacı.
**Karar:** (c). Program `examProgramSchema` ile tanımlanır: `exam` (`yks`, `kpss`, `ales`, `dgs`, `yds`, `lgs`), `session` (TYT, AYT, GY-GK, ÖABT…), isteğe bağlı `track` (Sayısal, Eşit ağırlık, branş), `subjects[]` (`questionCount`, `topics`). Konu ağacı en çok üç düzeydir (konu → alt konu → başlık); kimlikler derste tekildir. Toplam soru sayısı derslerden hesaplanır, saklanmaz.
**Gerekçe:** (a) kursta sınıf düzeyi yoktur; aynı TYT sınıfında 11. sınıf, 12. sınıf ve mezun bir aradadır, ve KPSS'nin MEB kazanımı yoktur. (b) kur, CEFR sıralı bir basamaktır, seviye tespiti ve kur geçme kararı taşır; sınav hazırlıkta "geçilecek kur" yoktur, aynı kursiyer TYT ve AYT'ye birlikte hazırlanır. (c) optik ve etüt modülünün ihtiyacını doğrudan karşılar: okulda cevap anahtarının her sorusu ders/kazanıma bağlıdır, kursta ders/konuya bağlanır (`programTopics` düzleştirilmiş konu listesi bu bağın hedefidir).

Örnek liste (`SAMPLE_EXAM_PROGRAMS`): YKS TYT, YKS AYT Sayısal, KPSS GY-GK, LGS. Kurum ilk açılışta bunlardan seçip düzenler; program kurumundur. Soru sayıları kamuya açık sınav yapısını izler ve her yıl ÖSYM/MEB kılavuzundan doğrulanır (açık sorular).

**Deneme ve optik merkezdedir:** kursta deneme sınavı, optik değerlendirme, otomatik etüt ve hedef planı varsayılan olarak açıktır (karar 3) ve menüde ilk iş akışı kategorisidir (karar 4). Deneme türü listesi (`mockExams.type`: LGS, YKS, Okul denemesi) adım 2'de programa bağlanır; o zamana kadar kurs, okulun deneme biçimini kullanır.

### 3. Modüller: açılabilenler ve varsayılanlar

**Seçenekler:** (a) bütün modüller açılabilir; (b) okulun modül kümesi aynen; (c) türün işleyişine göre seçilmiş küme + kurum ayarıyla kapatılabilen varsayılanlar.
**Karar:** (c).

| Modül                                               | Kursta açılabilir | Yeni kurumda |
| --------------------------------------------------- | ----------------- | ------------ |
| Kayıt & CRM, finans, akademik, öğrenme, iletişim    | evet              | açık         |
| Deneme, optik, otomatik etüt, hedef & gelişim planı | evet              | açık         |
| Program yönetimi, çalışma planı, takvim             | evet              | açık         |
| Servis, yemek, kulüpler                             | evet              | kapalı       |
| Rehberlik & takip                                   | hayır             | —            |
| Kayıt yenileme (sınıf geçişi)                       | hayır             | —            |

**Gerekçe:** Deneme/optik/etüt/hedef kursun ana ürünüdür (DOM-YTK-012 genişler). Servis ve yemek bazı kurslarda vardır; kulüp nadirdir. Kapatmak yerine açılabilir bırakılıp kapalı başlatılır, yönetici açar (DOM-YTK-042). Kayıt yenileme bir üst sınıf düzeyine geçirir; kursta yeni dönem yeni program kaydıdır. Rehberlik modülünün iç not ve görevli öğretmen kuralları (DOM-YTK-026, DOM-ILT-040) okul rehberlik servisine göre yazılmıştır; kurslardaki "eğitim koçluğu" ayrı ihtiyaçtır (kapsam dışı).

Okul ve dil okulunda davranış değişmez: açılabilen her modül açık başlar. Tablo: `MODULE_INSTITUTION_TYPES` (`modules/collection-modules.ts`), varsayılanlar `defaultModuleMap`/`defaultModulesFor` (`lib/institution-types.ts`); API kurum açarken haritayı buradan alır (`services/identity.ts` `ensureInstitution`).

Ek görev: kursta zümre başkanlığı (ders kapsamlı, `subject_head`) kullanılır; akademik koordinatörün kapsamı CEFR seviyesi olduğu için kursta yoktur (DOM-YTK-027).

### 4. Menü kategorileri

**Seçenekler:** (a) türe özel ayrı menü; (b) aynı menü, aynı kategori adları; (c) aynı menü iskeleti, türe uymayan kategori adları türün diliyle.
**Karar:** (c). Beş rolün kategorili menüsü üç türde aynıdır; kursta "OKUL İŞ AKIŞLARI" → "SINAV HAZIRLIK", "OKUL YAŞAMI" → "KURS YAŞAMI". Kapalı modüller ve boş kategoriler bugünkü gibi gizlenir.
**Gerekçe:** Ayrı menü, modül kapatma, rota koruması ve mobil kategori kartlarının bütün testlerini ikiye katlar; iskelet aynı kalınca yalnız ad değişir. Dil okulunun kategori adları bu ADR'nin konusu değildir. Fonksiyon `categoryLabel(group, type)`; web ve mobil menüye bağlanması adım 2'dedir.

### 5. 18 yaş üstü velisiz kayıt

**Seçenekler:** (a) okul kuralı: her yaşta veli; (b) dil okulu kuralı: 18 yaş ve üstü velisiz, altında veli; (c) her yaşta velisiz.
**Karar:** (b). Kayıt anında (Europe/Istanbul günü) 18 yaşını doldurmuş kursiyer kendi adına kaydolur: sözleşme tarafı, ödeyici ve iletişim kişisi kendisidir, veli bağlanmaz (DOM-KAY-012, DOM-YTK-030). 18 yaş altında okuldaki veli kuralı uygulanır. Ödeyici başka biri olabilir (aile); ödeyici yalnız fatura ve ödeme bilgisini görür, devam, deneme sonucu ve mesajı kursiyerin açık onayı olmadan göremez.
**Gerekçe:** (a) yetişkin KPSS adayına veli dayatır ve velinin bir yetişkinin verisini görmesine yol açar. (c) LGS ve YKS kursiyerlerinin çoğu 18 yaş altıdır; velisiz sözleşme geçersizdir. (b) dil okulunda bugün çalışan kuraldır; `guardianRequired` zaten okul dışındaki her türe uygular.

**KVKK etkisi:**

- Yetişkin kursiyerin verisinin sahibi kendisidir; rıza, aydınlatma ve ilgili kişi başvurusu kendisine aittir (DOM-YTK-057).
- Aday aşamasında yaş grubu (`minor`) açıkça seçilir; 18 yaş altında iletişim velinindir, yetişkinde veli verisi saklanmaz (DOM-KAY-009). Bugün bu seçim yalnız `language_school`'da sorulur; kursa genişletilmesi kayıt alanındadır.
- Kursta veli ile 18 yaşını dolduran kursiyer arasındaki erişim geçişi okuldaki DOM-YTK-031 ile aynıdır.
- Deneme sonuçları ve sıralamalar kişisel veridir; kursiyerler arası sıralama listesi ad maskesi olmadan yalnız personelde görünür (adım 2 ekranlarında uygulanır).

Kayıt ve finans Onur'un alanıdır; bu ADR yalnız kuralı tanımlar. Uygulama iş isteği: "Kurs kurum türünde 18 yaş üstü velisiz kayıt (OG-033)" (`sahip:onur`). Core'da kuralın adı `adultEnrollsWithoutGuardian(type)` (`lib/institution-types.ts`); testler `guardianRequired` ile aynı sonucu verdiğini doğrular.

### 6. Veritabanı

**Seçenekler:** (a) `institutions.type` için `check` kısıtı ve migration; (b) bugünkü `text` kolon, değer kısıtı uygulamada.
**Karar:** (b); migration yok. **Gerekçe:** Kolon Better Auth CLI'ının ürettiği `text`'tir (`{ enum }` yalnız TypeScript tipidir, SQL üretmez; `db:generate` "No schema changes" verir). Kurum oluşturan HTTP ucu yoktur; tür yalnız tohumdan ve Better Auth alanından (`type: [...INSTITUTION_TYPES]`) geçer. `check` kısıtı ayrı bir sağlamlaştırma işi olarak takip edilir.

## Kapsam dışı

- **Kurum oluşturma ucu ve tür değiştirme:** Kurumu bugün yalnız tohum açar; IST-001'in "tür değişikliği kayıt kaybetmez" ölçütü ayrı iştir.
- **Rehberlik/eğitim koçluğu:** karar 3. Kurslarda talep varsa ayrı ADR.
- **Kur, grup, seviye tespiti, paket saati:** dil okulunundur; kursta yoktur.
- **Kursiyer–program kaydı ve birden çok programa eşzamanlı kayıt** (TYT + AYT): kayıt alanında, adım 2 sonrası.
- **e-Özel işlem listesi (IST-085) ve kurs bitirme belgesi:** dil okuluyla ortak, ayrı görevler.
- **Canlı ders, soru çözüm videosu platformu:** ürün kapsamı dışıdır (CLAUDE.md "Amaç ve kapsam").

## Uygulama adımları

1. **Adım 1 (bu ADR ile):** tür (`INSTITUTION_TYPES`), modül tablosu, varsayılan modüller, terminoloji, menü kategori adları, program modeli (Zod + örnek), API tür doğrulaması ve `/me` şeması, derlenmeyi bozan web yerleri. Seed'e kurs kurumu eklenmez.
2. **Adım 2:** örnek kurs kurumu (seed), terminolojinin web ve mobil ekranlara bağlanması, `categoryLabel`'ın menüde kullanımı, programın kalıcılığı ve deneme türlerinin programa bağlanması (KPSS denemesi), optik anahtarın konuya bağlanması.
3. **Kayıt alanı (Onur):** aday yaş grubu ve velisiz kayıt kuralının kursta uygulanması, ayrılış dökümünün yeni türü taşıması.

## Sonuçlar

- `InstitutionType` üç değerlidir; türü tüketen `switch`'ler `satisfies never` ile kapanır. İkili denetimler (`=== 'language_school'`) kursu okul gibi ele alır; bu, adım 2'ye kadar bilinçli varsayılandır (kursun sınıf ve deneme modeli okulunkine yakındır).
- API'de tür tek kaynaktan, core'dan gelir (`apps/api/src/auth.ts` yeniden dışa aktarır).

## Değerlendirilen alternatifler

- **Kursu `school` türünün bir ayarı yapmak** ("sınıf düzeyi yok" bayrağı): tür sayısı artmaz ama okul kuralları (sınıf geçme, karne, her yaşta veli, rehberlik) bayrakla tek tek delinir; DOM-YTK-012'nin "türe uymayan modül bulunmaz" ilkesi bayrak denetimlerine dağılır.
- **Kursu `language_school`'a katmak:** velisiz kayıt hazır gelir ama CEFR, kur, grup, seviye tespiti ve paket saati kursta anlamsız veri üretir; deneme/optik dil okulunda kapalıdır.
- **Her karar için seçenekler** ilgili kararın altında yazılıdır.

## Açık sorular

- Örnek programların soru sayıları (TYT 120, AYT 160, KPSS GY-GK 120, LGS 90) ve ders dağılımı her yıl ÖSYM/MEB kılavuzundan **doğrulanmalı**.
- MEB özel öğretim kursu mevzuatının sınav hazırlık kurslarında devam şartı ve belge kuralı (dil okulundaki DOM-DIL-080 karşılığı) **doğrulanmalı**.
- Ödeyici veli ile 18 yaşını doldurmuş kursiyer arasında deneme sonucu paylaşımı varsayılan olarak kapalı mı olmalı, yoksa kayıtta onay mı alınmalı? Ürün kararı.
