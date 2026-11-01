# Onur'un iş listesi

- Bu dosyayı yalnız Onur düzenler.
- Biten madde `- [x]` olur. Başlanan iş için `durum:devam` etiketli issue açılır; madde sonuna `(#no)` eklenir.
- Sıra dalgalarla gösterilir: biten sonrakine geçer, karşı tarafı beklemez. Bekleme yalnız [README](README.md#bağımlılıklar) içindeki bağımlılıklarda olur; o durumda da geçici veriyle devam edilir.
- Sahip, kapsam ve sözleşmeler için [README](README.md) okunur. `(öneri A)` ve `(öneri B)` işaretli işler ek küme önerisidir; karar çıkana kadar Oğuzhan'dadır.

## D1 · Temel

- [ ] Birleştirmeyi incele: migration 0016–0022, taşınan kesin kayıt kuralları, aday ekranları (#9).
- [ ] `lib/domain.ts`'teki kayıt ve finans fonksiyonlarını kendi dosyalarına taşı.
- [ ] Aday ve CRM'in tamamını devral, iki kez yazılmış kodu temizle, deneme dersini aday kartına bağla.
- [ ] `finance-summary` ve öğrenci bakiyesi uçları.
- [ ] Cari ekstre (IST-107).
- [ ] Burs ve indirimin kalanı (IST-105).
- [ ] Kayıt formuna rıza adımı.
- [ ] Vade ve gecikme bildirimleri, uygulama içi (IST-109).
- [ ] Kayıt sözleşmesi onayı, core ve API (IST-092).
- [ ] Kayıt yenileme API ve ekranı, tarifeye bağlı (IST-100).
- [ ] Finans ve kayıt pano kartları.
- [ ] Ödeme sağlayıcı ADR taslağı.
- [ ] Kendi alanında Vue eşitliği.
- [ ] Core'daki demo ödeme yolunun kaldırılması.

Ara nokta: ilk sözleşme paketi iki tarafta da kullanılabilir (rıza, bildirim, finans özeti, öğrenci bakiyesi, akademik yıl, kur ve grup).

## D2 · İlk yayın

- [ ] Sözleşme onayı web ve mobilde.
- [ ] Yenileme sözleşmesi PDF'i.
- [ ] Kayıt durumu ve olayları sözleşmesi.
- [ ] Taksit ve sözleşmenin ilişkisel tablolara taşınması için ADR.
- [ ] Kayıt ve finans duman testleri.
- [ ] (öneri A, karar bekliyor) Sunucu, PostgreSQL yedeği, TLS, alan adı, dağıtım betiği ve yayın ADR'si.
- [ ] (öneri A, karar bekliyor) İzleme ve geri dönüş provası (IST-024).

Ara nokta: API'nin ilk yayını.

## D3 · Pilot okul

- [ ] Yenileme dönemi: yeni yıl tarifesi ve ilanı, yenileme daveti, çevrim içi onay, borçlu öğrenci kuralı (DOM-KAY-025).
- [ ] Paket ve ders saati satışı (IST-078).
- [ ] Pilot verisinin aktarımı: öğrenci, veli, taksit (IST-007, 134 içe).
- [ ] Kimlik okuma sözleşmesi.
- [ ] (öneri A, karar bekliyor) Pilot ortamı.
- [ ] Pilotta kasa ve gün sonu (IST-113).
- [ ] Pilotta gecikme hatırlatması SMS'le (IST-109).
- [ ] Pilotta kayıt dondurma (IST-084; DOM-KAY-024).
- [ ] Pilotta kayıt hunisi API'ye (IST-117).

Ara nokta: pilot okul canlı.

## D4 · Mağaza ve yıl sonu

- [ ] Çevrim içi ödeme ve sanal POS (IST-108, 133).
- [ ] Paket bakiyesi ve hakediş dökümü (IST-114, 087).
- [ ] Aday için seviye tespiti bağlantısı (IST-059).
- [ ] Kayıt sezonu: aday, tanışma, deneme dersi.
- [ ] Mobil veli finans ve sözleşme ekranları.
- [ ] (öneri A, karar bekliyor) Android derleme, imza, Play yayını.
- [ ] e-Arşiv ve e-Fatura entegratörü (IST-112).
- [ ] Sınıf geçişi ve mezuniyet, yılsonu sonuçlarıyla (IST-100; DOM-KAY-020–023).
- [ ] Kur yenileme, üst kur teklifi, e-Özel listesi (IST-088, 085).
- [ ] Dil okulu pilotunda paket satışı ve saat bakiyesi.
- [ ] Yıl sonu mutabakatı ve muhasebe aktarımı.
- [ ] Yeni yılın taksit planları.
- [ ] (öneri B, karar bekliyor) Talep ve şikayet devri, `requests.ts` ayrımı.
- [ ] (öneri B, karar bekliyor) Servis, yemek, kulüp, takvim.
- [ ] (öneri B, karar bekliyor) Teslim yetkisi (IST-099, 103).

Ara nokta: Android mağaza sürümü; dil okulu pilotu canlı; yıl sonu işlemleri çalıştı.

## D5 · Yeni öğretim yılı

- [ ] Yeni yıl tarifeleri, sözleşmeleri, burs dağıtımı.
- [ ] Pilottan gelen geri bildirimle kasa, ekstre ve iade düzeltmeleri.
- [ ] Muhasebe programı şablonu.
- [ ] (öneri A, karar bekliyor) Operatör paneli ve yeni kurum kurulum aracı (IST-012).
- [ ] (öneri A, karar bekliyor) Yük testi, yedekten geri dönüş provası, yeni kurumların kurulumu.
- [ ] (öneri B, karar bekliyor) Servis güzergâhları ve kulüp kayıtları.
- [ ] Açılış nöbeti: ilk taksitler, kayıt değişiklikleri, iade talepleri.

Ara nokta: yeni öğretim yılı açıldı; pilot okul tam yıl, dil okulu ve yeni kurumlar canlı. Faz 2 kapandı.

## Sonra · Faz 3

- [ ] Banka hareketi eşleştirme (IST-115).
- [ ] Kurumsal müşteri grupları (IST-089).
