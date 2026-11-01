# Oğuzhan'ın iş listesi

- Bu dosyayı yalnız Oğuzhan düzenler.
- Biten madde `- [x]` olur. Başlanan iş için `durum:devam` etiketli issue açılır; madde sonuna `(#no)` eklenir.
- Sıra dalgalarla gösterilir: biten sonrakine geçer, karşı tarafı beklemez. Bekleme yalnız [README](README.md#bağımlılıklar) içindeki bağımlılıklarda olur; o durumda da geçici veriyle devam edilir.
- Sahip, kapsam ve sözleşmeler için [README](README.md) okunur.

## D1 · Temel

- [ ] Ortak sıcak dosyaları alan dosyalarına böl: `page-registry`, `page-coverage`, `modules/commands`, `full-navigation`, `app.ts` rota kaydı, `authorize` ve `scope` eylem tabloları, `data/seed`, `commands.test` envanteri, `docs/sayfalar.md`. Amaç iki tarafın aynı dosyaya hiç yazmaması.
- [ ] CI'yı yeşile çek ve hızlandır: `.github/workflows/checks.yml` işleri 15 dakika zaman aşımına takılıyor. İşleri paralel böl, aynı dalda eski koşuyu iptal et (`concurrency`).
- [ ] `lib/pdf/templates.ts`'i alan dosyalarına böl (`lib/pdf/templates/<alan>.ts`).
- [ ] Onur birleştirmesi, tam doğrulama.
- [ ] Ortak çalışma kuralları ve kancalar.
- [ ] Açık dalları yeni tabana taşı: bildirim merkezi, görev görünüm uçları, dosya takipleri, koordinatör ve son puan, maskeli veli iletişimi.
- [ ] `ReauthModal` platforma.
- [ ] Rıza ve aydınlatma uçları, `<ConsentStep>` (IST-016, 017).
- [ ] `notify()` ve uygulama içi bildirim.
- [ ] Akademik yıl uçları.
- [ ] Pano ve ayar yuvaları, yetki eylem blokları.
- [ ] Kur ve grup uçları (IST-076, 077).
- [ ] Veli–öğrenci bağı servisi.
- [ ] Dosyalı teslim, konuşma kaydı ve dinleme hakkı (IST-051).
- [ ] CEFR tabloları ve uçları (IST-058, 060).
- [ ] Dijital veli onayı (IST-067).
- [ ] Anlık devamsızlık bildirimi (IST-072).
- [ ] Koordinatör rolü (IST-005).
- [ ] Personel aktarımı ve davet (IST-007).
- [ ] Mobil: öğrenci, öğretmen ve veli akışları API'ye; bildirim ve ses kaydı.

Ara nokta: ilk sözleşme paketi iki tarafta da kullanılabilir (rıza, bildirim, finans özeti, öğrenci bakiyesi, akademik yıl, kur ve grup).

## D2 · İlk yayın

- [ ] Vue kaldırılır, `apps/web-react` → `apps/web`.
- [ ] Mobil yalnız API'ye geçer, demo kalıcılığı silinir.
- [ ] Mobil kabuk rota sözleşmesi.
- [ ] Akademik, beceri ve iletişim duman testleri.
- [ ] Seviye tespit sınavı ve CEFR profili (IST-058, 060).
- [ ] Okuma ve dinleme etkinlikleri, beceri panosu (IST-042, 045, 057).
- [ ] Özel nitelikli veri, dosya erişim güvenliği, S3 ve tarama (IST-020, 027).
- [ ] E-posta kanalı (IST-132).

Ara nokta: API'nin ilk yayını.

## D3 · Pilot okul

- [ ] SMS ve push, kanal yükseltme (IST-131, 125, 073).
- [ ] Yazma döngüsü, rubrik kütüphanesi, konuşma değerlendirmesi, alıştırma seti (IST-047, 048, 052, 056).
- [ ] Seviye tespiti oturumu sözleşmesi (`placement-sessions`).
- [ ] Muhasebe ve ek roller (IST-006).
- [ ] PDF motoru paylaşılan pakete.
- [ ] Aydınlatma metinleri ve VİS (IST-016, 023).
- [ ] Pilotta yoklama, görevler, veli bildirimi.
- [ ] Kur geçiş kararı, devam şartı, kur bitirme belgesi (IST-062, 080, 081).
- [ ] `lesson-hours`, `level-decisions`, öğretim günleri.
- [ ] Hedefli duyuru ve kurallı mesajın kalanı (IST-066, 070).

Ara nokta: pilot okul canlı.

## D4 · Mağaza ve yıl sonu

- [ ] Mağaza sürümünün içeriği: beş rol API'li, push açık.
- [ ] Okuma kitaplığı, kelime listeleri (IST-043, 055).
- [ ] İçerik onay akışı, müfredat ve CEFR kataloğu (IST-037, 032).
- [ ] Saklama ve imha, ilgili kişi başvurusu (IST-021, 022).
- [ ] İki adımlı doğrulama, dışa aktarım maskesi (IST-026, 028).
- [ ] Dönem gelişim raporu, karne, sınıf geçme kararı (IST-074; DOM-AKD-040, 050).
- [ ] Deneme, rehberlik, hedef, çalışma planı, kazanım raporu (IST-096–098, 119).
- [ ] `year-end-results`.
- [ ] Karne PDF'i, teşekkür ve takdir belgesi, sonuç itirazı (DOM-AKD-053).
- [ ] e-Okul not ve devamsızlık şablonu (IST-134 dışa).
- [ ] Bekleme listesi, birebir ders, telafi ve grup değişikliği (IST-086, 083, 084).
- [ ] Dil okulu pilotunda kur, grup, devam, seviye tespiti, kur sonu kararı.
- [ ] Beceri ve CEFR raporları, kaynak kullanım göstergesi (IST-118, 123).

Ara nokta: Android mağaza sürümü; dil okulu pilotu canlı; yıl sonu işlemleri çalıştı.

## D5 · Yeni öğretim yılı

- [ ] Akademik açılış: sınıf, şube, kadro ataması, ders programı.
- [ ] Çoklu rol ve kurum, İngilizce arayüz, kurum markası (IST-008, 015, 013).
- [ ] Veli bülteni, anket, veli günü (IST-068, 069, 071).
- [ ] Öğretmen hızlı işlemleri mobilde (IST-129).
- [ ] iOS uygulaması (IST-128).
- [ ] Faz 2 kalanları (IST-044, 049, 053, 061, 063).
- [ ] Erişilebilirlik ve performans geçişi.
- [ ] Açılış nöbeti: ders programı, yoklama, görev atama.

Ara nokta: yeni öğretim yılı açıldı; pilot okul tam yıl, dil okulu ve yeni kurumlar canlı. Faz 2 kapandı.

## Sonra · Faz 3

- [ ] Otomatik geri bildirim ADR'si (IST-054).
- [ ] LTI (IST-139).
- [ ] Açık API (IST-140).

## Karar çıkana kadar bende

- K9 (öneri B: talep, takvim, servis, yemek, kulüp) ve K10 (öneri A: yayın, işletim, operatör paneli, mağaza) kararı çıkana kadar bende; kabul edilirse işaretli maddeler [onur.md](onur.md) listesine geçer.
