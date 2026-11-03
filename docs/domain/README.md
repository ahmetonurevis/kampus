# Alan (domain) kuralları

Bu klasör, Türkiye'de özel okul (`school`: ortaokul/lise) dil okulu (`language_school`: CEFR Pre-A1, A1–C2 ve A2+/B1+/B2+ artı seviyeleri) ve kurs (`course_center`: YKS, KPSS, LGS sınav hazırlık; program + ders + konu, [ADR 0008](../adr/0008-kurs-kurum-turu.md)) işletmenin iş kurallarını uygulanabilir hâle getirir. Ürün ister listesi (`docs/urun/`) ve mühendislik kuralları (`.claude/rules/`) ayrıdır; buradaki kurallar "ne doğru" sorusunu cevaplar, "nasıl kodlanır" sorusunu değil.

Temel mimari çerçeve [ADR 0001](../adr/0001-platform-mimarisi.md): çok kurumlu yapı, her kayıt bir kuruma (`institution_id`) aittir, kurum kimliği yalnız doğrulanmış oturumdan gelir, kapsam sunucuda school-core kurallarıyla uygulanır, çevrimdışı demo modu kaldırılır.

## Dizin

| Dosya                                      | Önek      | Konu                                                                                                       |
| ------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------- |
| [kayit-ve-crm.md](kayit-ve-crm.md)         | `DOM-KAY` | Aday, tanışma görüşmesi/deneme dersi, kesin kayıt, kontenjan, yenileme, mezuniyet, KVKK ve ticari ileti    |
| [finans.md](finans.md)                     | `DOM-FIN` | Ücret ilanı, taksit, indirim/burs/kardeş, gecikme, iade, tahsilat mükerrerliği, dekont, sözleşme           |
| [akademik-olcme.md](akademik-olcme.md)     | `DOM-AKD` | MEB not sistemi, dönem/yılsonu puanı, karne, devamsızlık, sınıf geçme, ödül belgeleri, deneme ve optik     |
| [dil-okulu.md](dil-okulu.md)               | `DOM-DIL` | Kur/seviye, seviye tespit, kur atlama, devam şartı, sertifika, paket satışı, deneme dersi, grup kapasitesi |
| [beceri-gelisimi.md](beceri-gelisimi.md)   | `DOM-BEC` | Okuma, dinleme, yazma, konuşma görevleri; puanlama, CEFR rubrikleri, seviye önerisi, teslim/deneme hakkı   |
| [kaynak-platformu.md](kaynak-platformu.md) | `DOM-KYN` | İçerik türleri, etiket taksonomisi, lisans/telif, onay akışı, sürüm, paylaşım kapsamı, arşiv               |
| [iletisim-ve-veli.md](iletisim-ve-veli.md) | `DOM-ILT` | Duyuru, mesaj, bildirim tercihi, sessiz saat, okundu bilgisi, veli onayı, acil durum, rehberlik gizliliği  |
| [yetki-ve-kapsam.md](yetki-ve-kapsam.md)   | `DOM-YTK` | Rol × kaynak × işlem matrisi; öğretmen/öğrenci/veli kapsamı; yetişkin kursiyer                             |

## Kural biçimi

Her kural şu alanları taşır:

- **ID**: `DOM-<ALAN>-NNN`. Kimlik bir kez verilir, silinen kuralın kimliği yeniden kullanılmaz.
- **Kural**: test edilebilir cümle.
- **Gerekçe**: neden.
- **Kaynak**: yasal/dış kaynak ve madde; yoksa "işletme kuralı". Emin olunmayan yerde **doğrulanmalı** yazar.
- **Kurum türü**: `school`, `language_school` veya `ikisi`.
- **Kodda**: `var` (dosya:satır), `yok` veya `çelişiyor` (neyle). Satır numaraları `docs/domain-kurallari` dalının açıldığı commit'e (7e53f64) göredir; yollar depo köküne görelidir.

Mevcut kodla çelişen kurallar her dosyanın sonundaki **Mevcut kodla farklar** bölümünde ayrıca listelenir.

## Sözlük

| Terim                         | Kod karşılığı                                            | Tanım                                                                                                                                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Kurum**                     | `institution` (ADR 0001; kodda henüz yok)                | Platformu kullanan tüzel kişi/marka: bir özel okul ya da dil okulu. Kiracı (tenant) sınırıdır; kurumlar arası veri görünmez. Türü `school` veya `language_school`.                                                                                                                   |
| **Kampüs**                    | `branches`                                               | Kurumun fiziksel yerleşkesi (MEB dilinde ayrı açılış izni olan "kurum" olabilir). Sınıf, derslik, kadro, servis, menü kampüse bağlıdır. Kod ve ekranlarda "şube" kelimesi kampüs için kullanılmaz; şube sınıf bölümüdür.                                                             |
| **Eğitim-öğretim yılı**       | `academic_years` (`startYear`; `academicYear` aynı sayı) | `school` için Eylül–Haziran; iki dönemden oluşur (birinci dönem, ikinci dönem). Yıl `2026` = 2026–2027. Kurum yılları tanımlar, tek etkin yıl bulunur (`DOM-YTK-063`, `DOM-YTK-065`).                                                                                                |
| **Dönem**                     | `academic_terms` (yıl içi dönem)                         | `school`: MEB'in ilan ettiği birinci/ikinci dönem; not ve karne dönem bazlıdır. `language_school`: kurumun tanımladığı satış ve kur dönemi (ör. 8 haftalık modül); takvim yılına bağlı değildir. Dönem yılın içindedir ve örtüşmez (`DOM-YTK-064`); dil okulu kurları ayrı modeldir. |
| **Sınıf düzeyi**              | `classes.grade` (5–12)                                   | MEB kademesi: 5–8 ortaokul, 9–12 lise. Dil okulunda yoktur; yerini CEFR seviyesi alır.                                                                                                                                                                                               |
| **Şube**                      | `classes.section`                                        | Aynı düzeydeki sınıf bölümü (7-A, 7-B). "Sınıf" kaydı = düzey + şube + kampüs + derslik + sınıf rehber öğretmeni.                                                                                                                                                                    |
| **Grup / kur**                | yok                                                      | `language_school`'un öğretim birimi: aynı CEFR seviyesinde, aynı programı izleyen, kapasiteli ve takvimli kursiyer topluluğu. Kur, bir seviyenin alt basamağıdır (ör. B1.1, B1.2).                                                                                                   |
| **Ders / branş**              | `subjects`, `teachers.subjectId`                         | MEB haftalık ders çizelgesindeki ders; öğretmenin branşı bir derse eşlenir.                                                                                                                                                                                                          |
| **Kazanım / öğrenme çıktısı** | `topics` (serbest metin)                                 | MEB öğretim programındaki ölçülebilir hedef; resmî kodlu (ör. `M.7.1.2.3`). 2024 sonrası programlarda "öğrenme çıktısı" adı da kullanılır.                                                                                                                                           |
| **Beceri**                    | yok                                                      | Okuma-anlama, dinleme, yazma, konuşma (CEFR'de alımlama, üretim, etkileşim, aracılık).                                                                                                                                                                                               |
| **Deneme sınavı**             | `mockExams`, `mockResults`                               | Kurumun LGS/YKS formatındaki çalışma sınavı; resmî puan üretmez, net üretir.                                                                                                                                                                                                         |
| **Etüt**                      | `tutorSessions`, `appointments`                          | Ders dışı destek oturumu (bireysel veya grup).                                                                                                                                                                                                                                       |

### Kişi rolleri

| Rol                                   | Kod                    | Kurum türü                         | Tanım                                                                                                                                                                                                              |
| ------------------------------------- | ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kurucu / yönetici                     | `yonetici`             | ikisi                              | Kurum genelinde tam yetkili; mali ve akademik onay makamı. MEB dilinde kurucu/kurucu temsilcisi ve okul müdürü ayrı kişiler olabilir; platform ikisini de `yonetici` altında alt yetkiyle ayırır (bkz. `DOM-YTK`). |
| Ön büro / kayıt danışmanı             | `onburo`               | ikisi                              | Aday, kayıt, tahsilat, servis/menü; akademik veriye erişmez.                                                                                                                                                       |
| Öğretmen                              | `ogretmen`             | ikisi                              | Branş öğretmeni (`school`) veya eğitmen (`language_school`). Ek görevleri: sınıf rehber öğretmeni, kulüp sorumlusu, zümre başkanı.                                                                                 |
| Rehber öğretmen (psikolojik danışman) | yok (bugün `ogretmen`) | `school`                           | Rehberlik dosyalarının sahibi; gizli notları yazar (bkz. `DOM-ILT-040`).                                                                                                                                           |
| Öğrenci                               | `ogrenci`              | `school`                           | Reşit olmayan kayıtlı öğrenci; işlemleri veli gözetimindedir.                                                                                                                                                      |
| Kursiyer                              | yok                    | `language_school`, `course_center` | Dil okuluna ya da kursa kayıtlı kişi. 18 yaş ve üstü yetişkin kursiyerin velisi yoktur; kendi adına sözleşme yapar, öder ve onay verir. 18 yaş altı kursiyer `school` öğrencisi gibi veliye bağlanır.              |
| Veli                                  | `veli`                 | ikisi                              | Öğrencinin yasal temsilcisi (anne, baba, vasi). Bir velinin birden çok çocuğu, bir çocuğun birden çok velisi olabilir.                                                                                             |
| Ödeyici                               | yok                    | ikisi                              | Sözleşmede borçlu taraf; çoğunlukla veli, yetişkin kursiyerde kendisi, kurumsal eğitimde işveren.                                                                                                                  |

## Kaynaklar

Kurallarda kısa etiketle anılır.

- **[OİKY]** MEB Okul Öncesi Eğitim ve İlköğretim Kurumları Yönetmeliği (RG 26/7/2014-29072; okunan konsolide metin RG 28/7/2026-33323 değişikliğini içerir). <https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=19942&MevzuatTur=7&MevzuatTertip=5>
- **[OKY]** MEB Ortaöğretim Kurumları Yönetmeliği (RG 7/9/2013-28758; okunan konsolide metin RG 22/2/2025-32821 değişikliğini içerir). <https://www.mevzuat.gov.tr/MevzuatMetin/yonetmelik/7.5.18812.pdf> ve MEB duyurusu <https://www.meb.gov.tr/ortaogretim-kurumlari-yonetmeliginde-yapilan-degisiklikler-resmi-gazetede-yayimlandi/haber/36422/tr>
- **[ÖDY]** MEB Ölçme ve Değerlendirme Yönetmeliği (RG 9/9/2023-32304); OİKY 22/7 yollaması.
- **[ÖÖKY]** MEB Özel Öğretim Kurumları Yönetmeliği (RG 20/3/2012-28239; okunan konsolide metin RG 16/2/2024-32462 değişikliğine kadar). <https://www.alomaliye.com/wp-content/uploads/2012/03/meb-ozel-ogretim-16-02-2024.doc>. 2024 sonrası değişiklikler **doğrulanmalı**.
- **[5580]** 5580 sayılı Özel Öğretim Kurumları Kanunu (md. 13 ücretsiz okutma). Metin yalnız ikincil kaynaklardan görüldü; **doğrulanmalı**.
- **[KVKK]** 6698 sayılı Kişisel Verilerin Korunması Kanunu; md. 6, 7499 sayılı Kanunla değişti (yürürlük 1/6/2024).
- **[6563]** 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun ve Ticari İletişim ve Ticari Elektronik İletiler Hakkında Yönetmelik (İYS). **Doğrulanmalı**.
- **[6502]** 6502 sayılı Tüketicinin Korunması Hakkında Kanun. **Doğrulanmalı**.
- **[5846]** 5846 sayılı Fikir ve Sanat Eserleri Kanunu (md. 34 eğitim amaçlı kullanım). **Doğrulanmalı**.
- **[CEFR]** Council of Europe, CEFR (2001) ve **[CEFR-CV]** Companion Volume (2020): Pre-A1, artı seviyeler (A2+, B1+, B2+), aracılık ve çevrim içi etkileşim ölçekleri, yeni sesbilgisel denetim ölçeği. <https://rm.coe.int/16809ea0d4>
- **[GLH]** Cambridge English, Guided learning hours (A1 ≈ 90–100, A2 ≈ 180–200, B1 ≈ 350–400, B2 ≈ 500–600, C1 ≈ 700–800, C2 ≈ 1.000–1.200 saat, birikimli tahmin). <https://support.cambridgeenglish.org/hc/en-gb/articles/202838506-Guided-learning-hours>

Mevzuat sık değişir. Yasal sayı içeren her kural (eşik, gün, oran) kurum ayarına değil, sürümlü bir **mevzuat profiline** bağlanmalıdır; profil değiştiğinde geçmiş kayıtlar eski profille hesaplanmış kalır (bkz. `DOM-AKD-001`).
