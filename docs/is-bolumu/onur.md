# Onur'un görev tablosu

- Bu dosyayı yalnız Onur düzenler. Oğuzhan'ın tablosu [oguzhan.md](oguzhan.md); sahiplik, sözleşmeler ve bağımlılıklar [README](README.md)'dedir.
- Her dalga (D1–D5, Sonra) bir tablodur. Sıradaki iş önce dalgaya, sonra bağımlılığa göre seçilir; dalga içinde konu sırası serbesttir. Karşı tarafı bekleyen iş durmaz, geçici veriyle sürer.
- **ID** kalıcıdır (`ON-001`…). Yeni görev ilgili dalga tablosunun sonuna, dosyadaki en büyük numaradan sonraki numarayla eklenir. Numara yeniden verilmez; vazgeçilen görev silinmez, `iptal` olur.
- **Durum** yalnız şunlardan biridir: `bekliyor`, `çalışılıyor`, `revizyon` (bitmişti; inceleme, karşı taraf ya da kullanıcı düzeltme istedi), `engelli` (Not'ta beklenen görev ID'si), `bitti`, `iptal`.
- **Dal / commit:** `çalışılıyor` ve `revizyon`da dal adı, `bitti`de entegrasyondaki birleştirme commit'inin kısa hash'i. **Not:** bağımlılık ya da engel ("OG-014 bekleniyor"), revizyon gerekçesi ya da `#issue`, migration ve ADR numarası.
- Durumu oturum yazar: başlarken `is-baslat` (`çalışılıyor`), birleştirince `entegre-et` (`bitti`). Değişiklik entegrasyon dalında küçük bir commit'tir: "Görev durumunu güncelle: ON-012 çalışılıyor". Kurallar: [.claude/rules/ortak-calisma.md](../../.claude/rules/ortak-calisma.md).
- Görev boyu bir dalda 1–3 commit'lik, kendi başına birleştirilebilir iştir. IST kimliği görev metnindedir.
- "öneri A" ve "öneri B" satırları ek küme önerisidir (README, K9 ve K10); karar ON-002 ile çıkana kadar `engelli` kalır ve iş Oğuzhan'dadır.

## D1 · Temel

| ID     | Görev                                                                                                                                                                                                                    | Durum    | Dal / commit | Not                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------ | ----------------------------------------------------- |
| ON-001 | Birleştirmeyi incele: migration 0016–0022, taşınan kesin kayıt kuralları, aday ekranları; veli kuralı: okulda her yaşta zorunlu, dil okulu ve kursta 18 yaş üstü velisiz (kullanıcı kararı, 2 Kasım) (#9) (IST-019, 091) | bekliyor |              | Birleştirme OG-002; bulgu `sahip:oguzhan` issue'suyla |
| ON-002 | Platform sahipliğine ve ek küme önerilerine (A: yayın ve işletim, B: ön büro ve okul yaşamı) yanıt ver; karar README "Karar bekleyenler"e birlikte yazılır                                                               | bekliyor |              |                                                       |
| ON-003 | `lib/domain.ts`'teki kayıt fonksiyonlarını `enrollment` dosyalarına taşı                                                                                                                                                 | bekliyor |              | Ortak dosya                                           |
| ON-004 | `lib/domain.ts`'teki taksit ve ödeme fonksiyonlarını `payments` dosyalarına taşı                                                                                                                                         | bekliyor |              | Ortak dosya                                           |
| ON-005 | Aday ve CRM'i devral, iki kez yazılmış kodu temizle (IST-091)                                                                                                                                                            | bekliyor |              |                                                       |
| ON-006 | Deneme dersini aday kartına bağla: sonuç ve seviye (`TODO(crm-trial-result)`, `crm-trial-level`) (IST-079)                                                                                                               | bekliyor |              |                                                       |
| ON-007 | CRM kalanları: aşamayı geri alma, görüşme sorumlusu, kaynak grubu ve görüşme süzgeci (`TODO(crm-stage-back)`, `crm-meeting-host`, `api-prospect-*`) (IST-091)                                                            | bekliyor |              |                                                       |
| ON-008 | Aday aydınlatması ve ticari ileti onayı (`TODO(crm-consent)`; DOM-KAY-003, 004) (IST-017)                                                                                                                                | bekliyor |              | OG-016 sözleşmesi                                     |
| ON-009 | Kesin kayıt formunda DOM-KAY-012 alanları (`TODO(web-enroll-fields)`, `enroll-required-fields`) (IST-091)                                                                                                                | bekliyor |              |                                                       |
| ON-010 | Kesin kayıtta ayrı veliler ve ödeyici (`TODO(separate-parents)`, `crm-enroll`) (IST-019, 091)                                                                                                                            | bekliyor |              | OG-031 sözleşmesi                                     |
| ON-011 | Aday formunda telefonun sahibini netleştir: okul adayında veli telefonu                                                                                                                                                  | bekliyor |              | Dosya takipleri turundan                              |
| ON-012 | `GET /finance-summary`: tahsil edilen, vadesi geçen, açık tutar, dönem kırılımı (IST-116, 121)                                                                                                                           | bekliyor |              | Oğuzhan'ı bekletir: OG-151                            |
| ON-013 | `GET /students/:id/balance`, veli kapsamlı                                                                                                                                                                               | bekliyor |              | Oğuzhan'ın veli kartları kullanır                     |
| ON-014 | Burs ve indirimin kalanı: core ve API (IST-105)                                                                                                                                                                          | bekliyor |              |                                                       |
| ON-015 | Burs ve indirim web ekranı (IST-105)                                                                                                                                                                                     | bekliyor |              |                                                       |
| ON-016 | Ücret kalemleri: kalem bazında tarihli KDV, MEBBİS ilan eşlemesi (IST-104)                                                                                                                                               | bekliyor |              |                                                       |
| ON-017 | Tarife ve fiyat listesi ekranının kalanları (IST-104)                                                                                                                                                                    | bekliyor |              |                                                       |
| ON-018 | Tahsilat yöntemleri core'da: nakit, havale, kart, senet (`PAYMENT_METHODS`) (IST-106)                                                                                                                                    | bekliyor |              |                                                       |
| ON-019 | Dekont şablonunu `lib/pdf/templates/` altına taşı (`TODO(pdf-receipt)`) (IST-106)                                                                                                                                        | bekliyor |              | OG-013 sonrası                                        |
| ON-020 | Taksit taahhütnamesi PDF'i (IST-105)                                                                                                                                                                                     | bekliyor |              |                                                       |
| ON-021 | Cari ekstre: core ve API (IST-107)                                                                                                                                                                                       | bekliyor |              |                                                       |
| ON-022 | Cari ekstre web ekranı ve PDF'i (IST-107)                                                                                                                                                                                | bekliyor |              |                                                       |
| ON-023 | İade hesaplayıcının kalanları ve iade dökümü PDF'i (IST-110)                                                                                                                                                             | bekliyor |              |                                                       |
| ON-024 | Muhasebe dışa aktarımında yaygın program sütunları (IST-111)                                                                                                                                                             | bekliyor |              |                                                       |
| ON-025 | Kayıt formuna rıza adımı (IST-016, 017)                                                                                                                                                                                  | bekliyor |              | OG-016, OG-017; gelene kadar geçici veri              |
| ON-026 | Vade ve gecikme bildirimleri, uygulama içi (IST-109)                                                                                                                                                                     | bekliyor |              | OG-018                                                |
| ON-027 | Tahsilat alındı ve iade ödendi bildirimleri (IST-106, 110)                                                                                                                                                               | bekliyor |              | OG-018                                                |
| ON-028 | Kayıt sözleşmesi onayı: core ve API (IST-092)                                                                                                                                                                            | bekliyor |              |                                                       |
| ON-029 | Kayıt sözleşmesi PDF'i ve kesin kayıttan bağlantı (`TODO(web-enroll-contract)`) (IST-092)                                                                                                                                | bekliyor |              |                                                       |
| ON-030 | Kayıt yenileme API'si, tarifeye bağlı (IST-100)                                                                                                                                                                          | bekliyor |              |                                                       |
| ON-031 | Kayıt yenileme web ekranı (IST-100)                                                                                                                                                                                      | bekliyor |              |                                                       |
| ON-032 | Finans ve kayıt pano kartları (IST-116)                                                                                                                                                                                  | bekliyor |              | OG-025                                                |
| ON-033 | Ödeme ve banka ayar sekmesini yuvaya taşı                                                                                                                                                                                | bekliyor |              | OG-026                                                |
| ON-034 | Ödeme sağlayıcı ADR taslağı (`TODO(payment-provider)`) (IST-133)                                                                                                                                                         | bekliyor |              |                                                       |
| ON-035 | Kendi alanında Vue eşitliği: CRM ve kayıt ekranları                                                                                                                                                                      | bekliyor |              | OG-072 bunu bekler                                    |
| ON-036 | Kendi alanında Vue eşitliği: finans ekranları                                                                                                                                                                            | bekliyor |              | OG-072 bunu bekler                                    |
| ON-037 | Core'daki demo ödeme yolunu kaldır (`TODO(demo-kalicilik)`)                                                                                                                                                              | bekliyor |              |                                                       |
| ON-038 | Kayıt ve finans e2e kalanları                                                                                                                                                                                            | bekliyor |              |                                                       |
| ON-039 | DOM-KAY ve DOM-FIN "doğrulanmalı" notlarını hukukçu ve mali müşavir sorularına derle (ADR 0006)                                                                                                                          | bekliyor |              |                                                       |

Ara nokta: ilk sözleşme paketi iki tarafta da kullanılabilir (rıza, bildirim, finans özeti, öğrenci bakiyesi, akademik yıl, kur ve grup).

## D2 · İlk yayın

| ID     | Görev                                                                                        | Durum    | Dal / commit | Not                                                                |
| ------ | -------------------------------------------------------------------------------------------- | -------- | ------------ | ------------------------------------------------------------------ |
| ON-040 | Sözleşme onayı web ekranı (IST-092)                                                          | bekliyor |              |                                                                    |
| ON-041 | Sözleşme onayı mobilde (IST-092)                                                             | bekliyor |              | OG-075                                                             |
| ON-042 | Yenileme sözleşmesi PDF'i (IST-100)                                                          | bekliyor |              |                                                                    |
| ON-043 | Kayıt durumu ve olayları: `enrollmentStatus` ve geçiş olayları                               | bekliyor |              | Oğuzhan'ın sınıf listeleri, yoklama ve bildirim alıcıları kullanır |
| ON-044 | Kayıt onayı ve sözleşme onay isteği bildirimleri (IST-092)                                   | bekliyor |              | OG-018                                                             |
| ON-045 | Taksit ve sözleşmenin ilişkisel tablolara taşınması için ADR                                 | bekliyor |              |                                                                    |
| ON-046 | Taksit ve sözleşme tablolarına taşıma: migration ve uçlar                                    | bekliyor |              | ON-045 sonrası                                                     |
| ON-047 | Kayıt duman testleri                                                                         | bekliyor |              |                                                                    |
| ON-048 | Finans duman testleri                                                                        | bekliyor |              |                                                                    |
| ON-049 | Öğrenci belgesi PDF'i                                                                        | bekliyor |              |                                                                    |
| ON-050 | Görüşme ve deneme dersi hatırlatması bildirimi (IST-079)                                     | bekliyor |              | OG-018                                                             |
| ON-051 | Kayıt hunisi: core ve API, kaynak ve danışman bazında (IST-117)                              | bekliyor |              |                                                                    |
| ON-052 | Kayıt hunisi rapor ekranı (IST-117)                                                          | bekliyor |              |                                                                    |
| ON-053 | (öneri A) Sunucu, PostgreSQL yedeği, TLS, alan adı, dağıtım betiği ve yayın ADR'si (IST-024) | engelli  |              | ON-002 bekleniyor; şimdilik OG-184                                 |
| ON-054 | (öneri A) İzleme ve geri dönüş provası (IST-024)                                             | engelli  |              | ON-002 bekleniyor; şimdilik OG-185                                 |

Ara nokta: API'nin ilk yayını.

## D3 · Pilot okul

| ID     | Görev                                                                                             | Durum    | Dal / commit | Not                                |
| ------ | ------------------------------------------------------------------------------------------------- | -------- | ------------ | ---------------------------------- |
| ON-055 | Yeni yıl tarifesi ve ilanı (DOM-KAY-025) (IST-104)                                                | bekliyor |              |                                    |
| ON-056 | Yenileme daveti bildirimi ve çevrim içi onay (IST-100)                                            | bekliyor |              |                                    |
| ON-057 | Borçlu öğrencide yenileme kuralı (DOM-KAY-025) (IST-100)                                          | bekliyor |              |                                    |
| ON-058 | Paket ve ders saati satışı: core ve API, son kullanma tarihi (IST-078)                            | bekliyor |              | OG-028, OG-029                     |
| ON-059 | Paket satışı web ekranı, çevrim içi satışta ön bilgilendirme (IST-078)                            | bekliyor |              |                                    |
| ON-060 | Pilot verisi aktarımı: öğrenci ve veli, CSV ve Excel (IST-007)                                    | bekliyor |              |                                    |
| ON-061 | Pilot verisi aktarımı: taksitler (IST-007)                                                        | bekliyor |              |                                    |
| ON-062 | e-Okul öğrenci listesinden içe aktarım (IST-134)                                                  | bekliyor |              |                                    |
| ON-063 | Kimlik okuma `GET /students/:id/identity`: maskeli, yetkili, denetimli                            | bekliyor |              | Oğuzhan'ın OG-135 kullanır         |
| ON-064 | Kasa ve gün sonu: core ve API (IST-113)                                                           | bekliyor |              |                                    |
| ON-065 | Gün sonu rapor ekranı ve PDF'i (IST-113)                                                          | bekliyor |              |                                    |
| ON-066 | Gecikme hatırlatması SMS'le: kurum metni ve sıklık (IST-109)                                      | bekliyor |              | OG-104                             |
| ON-067 | Kayıt dondurma (DOM-KAY-024) (IST-084)                                                            | bekliyor |              |                                    |
| ON-068 | Yetişkin kursiyer self-servis: takvim, kalan saat, ödeme, belge (`TODO(adult-learner)`) (IST-082) | bekliyor |              |                                    |
| ON-069 | Muhasebe rolünün finans yetkilerini belirle, iş isteğiyle ilet (IST-006)                          | bekliyor |              | OG-110                             |
| ON-070 | (öneri A) Güvenlik olayı ve ihlal kaydı (IST-029)                                                 | engelli  |              | ON-002 bekleniyor; şimdilik OG-186 |
| ON-071 | (öneri A) Pilot ortamı                                                                            | engelli  |              | ON-002 bekleniyor; şimdilik OG-187 |

Ara nokta: pilot okul canlı.

## D4 · Mağaza ve yıl sonu

| ID     | Görev                                                                                  | Durum    | Dal / commit | Not                                                  |
| ------ | -------------------------------------------------------------------------------------- | -------- | ------------ | ---------------------------------------------------- |
| ON-072 | Çevrim içi ödeme akışı: sonuç tahsilata ve dekonta yansır (IST-108)                    | bekliyor |              | ON-034 kararı                                        |
| ON-073 | Sanal POS sağlayıcısı, 3D Secure (IST-133)                                             | bekliyor |              |                                                      |
| ON-074 | Paket bakiyesi `GET /students/:id/package-balance` ve kullanılan saat raporu (IST-114) | bekliyor |              | OG-116; Oğuzhan'ın OG-144 kullanır                   |
| ON-075 | Öğretmen ders saati hakediş dökümü (IST-087)                                           | bekliyor |              | OG-116                                               |
| ON-076 | Aday için seviye tespiti bağlantısı (IST-059)                                          | bekliyor |              | OG-109                                               |
| ON-077 | Kayıt sezonu nöbeti: aday, tanışma, deneme dersi (IST-079, 091)                        | bekliyor |              |                                                      |
| ON-078 | Mobil veli finans ekranları (IST-107, 124)                                             | bekliyor |              | OG-075, OG-112                                       |
| ON-079 | Mobil sözleşme listesi ve belgeleri (IST-092)                                          | bekliyor |              | OG-075                                               |
| ON-080 | e-Arşiv ve e-Fatura entegratörü (IST-112)                                              | bekliyor |              |                                                      |
| ON-081 | Sınıf geçişi ve mezuniyet (DOM-KAY-020–023) (IST-100)                                  | bekliyor |              | OG-140                                               |
| ON-082 | Kur yenileme ve üst kur teklifi (IST-088)                                              | bekliyor |              | OG-115                                               |
| ON-083 | e-Özel işlem listesi ve "işlendi" işareti (IST-085)                                    | bekliyor |              |                                                      |
| ON-084 | Dil okulu pilotunda paket satışı ve saat bakiyesi (IST-078, 114)                       | bekliyor |              |                                                      |
| ON-085 | Yıl sonu mutabakatı ve muhasebe aktarımı (IST-111)                                     | bekliyor |              |                                                      |
| ON-086 | Yeni yılın taksit planları (IST-105)                                                   | bekliyor |              |                                                      |
| ON-087 | Ek hizmet aboneliği `student_services`: servis, yemek, kulüp kalemi (DOM-FIN-003)      | bekliyor |              | K9 Oğuzhan'da kalırsa okul yaşamı ekranları kullanır |
| ON-088 | (öneri A) Android derleme, imza ve Play yayını (IST-124, 128)                          | engelli  |              | ON-002 bekleniyor; şimdilik OG-188                   |
| ON-089 | (öneri B) Talep ve şikayet devri, `requests.ts` ayrımı                                 | engelli  |              | ON-002 bekleniyor; şimdilik OG-191                   |
| ON-090 | (öneri B) Okul yaşamı: takvim, servis, yemek, kulüp (IST-099)                          | engelli  |              | ON-002 bekleniyor; şimdilik OG-192                   |
| ON-091 | (öneri B) Giriş-çıkış ve teslim yetkisi (IST-103)                                      | engelli  |              | ON-002 bekleniyor; şimdilik OG-193                   |

Ara nokta: Android mağaza sürümü; dil okulu pilotu canlı; yıl sonu işlemleri çalıştı.

## D5 · Yeni öğretim yılı

| ID     | Görev                                                                         | Durum    | Dal / commit | Not                                |
| ------ | ----------------------------------------------------------------------------- | -------- | ------------ | ---------------------------------- |
| ON-092 | Yeni yıl tarifeleri, sözleşmeleri, burs dağıtımı (IST-104, 105)               | bekliyor |              |                                    |
| ON-093 | Pilot geri bildirimiyle kasa, ekstre ve iade düzeltmeleri (IST-107, 110, 113) | bekliyor |              |                                    |
| ON-094 | Muhasebe programı şablonu (IST-111)                                           | bekliyor |              |                                    |
| ON-095 | Açılış nöbeti: ilk taksitler, kayıt değişiklikleri, iade talepleri            | bekliyor |              |                                    |
| ON-096 | (öneri A) Operatör paneli ve yeni kurum kurulum aracı (IST-012)               | engelli  |              | ON-002 bekleniyor; şimdilik OG-189 |
| ON-097 | (öneri A) Yük testi, yedekten geri dönüş provası, yeni kurumların kurulumu    | engelli  |              | ON-002 bekleniyor; şimdilik OG-190 |
| ON-098 | (öneri B) Servis güzergâhları ve kulüp kayıtları (IST-099)                    | engelli  |              | ON-002 bekleniyor; şimdilik OG-194 |

Ara nokta: yeni öğretim yılı açıldı; pilot okul tam yıl, dil okulu ve yeni kurumlar canlı. Faz 2 kapandı.

## Sonra · Faz 3

| ID     | Görev                                             | Durum    | Dal / commit | Not                                |
| ------ | ------------------------------------------------- | -------- | ------------ | ---------------------------------- |
| ON-099 | Banka hareketi eşleştirme (IST-115)               | bekliyor |              |                                    |
| ON-100 | Kurumsal müşteri grupları, toplu fatura (IST-089) | bekliyor |              |                                    |
| ON-101 | (öneri B) Revir ve ilaç onayı (IST-102)           | engelli  |              | ON-002 bekleniyor; şimdilik OG-195 |
