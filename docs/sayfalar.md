# Demo sayfaları

Giriş: `/giris`. Kök adres giriş ekranına veya seçili rolün dashboard’una yönlenir.

React web (`apps/web-react`, `pnpm dev:react`) sayfaları API'den okur; taşınmayan sayfalar yer tutucudur. Taşınan sayfalar finans dışında yalnız okuma yapar: sunucu sayfalı tablo, arama/filtre/sıralama/sayfa ve sağ panel URL'dedir, CSV tüm filtrelenmiş sonucu içerir. Kapsam sunucuda uygulanır; kapsam dışı ayrıntı adresi "Kayıt bulunamadı" görünümüne düşer (API 404).

| Rol      | Yol                                         | Sayfa ve URL durumu                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yönetici | `/yonetici/subeler`, `/yonetici/personel`   | Kampüsler & Sınıflar, Eğitim Kadrosu; panel `?sinif=`, `?kampus-ozet=`, `?ogretmen=`; kayıt durumu sekmesi `?durum=arsiv` (boşsa aktif; sunucu `isActive`)                                                                                                                              |
| Yönetici | `/yonetici/finans`                          | Finans & Tahsilat: ilk API'li yazma ekranı; taksit listesi arama/durum filtresi/sıralama/sayfa URL'de, taksit detayı `?detay=`, tahsilat formu `?tahsilat=`, CSV; tahsilat `Idempotency-Key` ile tek kez yazılır, ikinci deneme 409 mesajı verir; toplam kartları ve dekont PDF'i sonra |
| Ön büro  | `/onburo/tahsilat-takip`                    | Tahsilat Takibi: yönetici finans ekranının aynısı                                                                                                                                                                                                                                       |
| Öğretmen | `/ogretmen/siniflarim`                      | Sınıflarım (yalnız ders verdiği veya danışmanı olduğu sınıflar; `?duzey=`, özet `?sinif=`) ve `?sekme=notlar` Not listesi (`?not-sinif=` sunucuda `classId`, `?not-ders=`, panel `?not=`)                                                                                               |
| Öğretmen | `/ogretmen/yoklama`                         | Yoklama geçmişi (`?sinif=`, `?durum=`, `?tarih=YYYY-AA-GG` tek gün: sunucu `dateFrom`=`dateTo`; panel `?kayit=`); yoklama alma sonraki adımdır                                                                                                                                          |
| Öğretmen | `/ogretmen/ders-programi`                   | Haftalık program (`?hafta=<pazartesi>`, panel `?ders=`); iptal edilen dersler görünmez                                                                                                                                                                                                  |
| Öğrenci  | `/ogrenci/notlarim`, `/ogrenci/devamsizlik` | Kendi notları (ders ortalamaları kayıtlardan hesaplanır; `?ders=`, panel `?not=`) ve devam geçmişi (`?durum=`, `?tarih=`, panel `?kayit=`)                                                                                                                                              |
| Öğrenci  | `/ogrenci/ders-programi`                    | Kendi sınıfının haftalık programı; iptal edilen dersler görünmez                                                                                                                                                                                                                        |
| Veli     | `/veli/cocuk-secici`                        | Çocuklarım kartları (ortalama ve devamsızlık kayıtlardan); karttan `?cocuk=` ile Akademik Takip açılır                                                                                                                                                                                  |
| Veli     | `/veli/akademik-takip`                      | Seçili çocuğun notları, devamsızlığı ve programı (`?sekme=notlar`, `devamsizlik`, `program`). Seçili çocuk her adreste `?cocuk=<öğrenci kimliği>` ile taşınır                                                                                                                           |

Aşağıdaki tablolar Vue demosunun sayfa yollarıdır.

## Yönetici

| Yol                             | Sayfa                     |
| ------------------------------- | ------------------------- |
| `/yonetici/dashboard`           | Genel Bakış               |
| `/yonetici/finans`              | Finans & Tahsilat         |
| `/yonetici/subeler`             | Kampüsler & Sınıflar      |
| `/yonetici/personel`            | Eğitim Kadrosu            |
| `/yonetici/kayit-raporlari`     | Kayıt Raporları           |
| `/yonetici/sla-raporu`          | SLA Raporu                |
| `/yonetici/risk-listesi`        | Risk Altındaki Öğrenciler |
| `/yonetici/ayarlar`             | Ayarlar                   |
| `/yonetici/optik-degerlendirme` | Optik Değerlendirme       |
| `/yonetici/otomatik-etut`       | Otomatik Etüt             |
| `/yonetici/rehberlik`           | Rehberlik & Takip         |
| `/yonetici/hedef-plani`         | Hedef & Gelişim Planı     |
| `/yonetici/deneme-sinavlari`    | Deneme Sınavları          |
| `/yonetici/kayit-yenileme`      | Kayıt Yenileme            |
| `/yonetici/program-yonetimi`    | Program Yönetimi          |
| `/yonetici/calisma-plani`       | Çalışma Planı             |
| `/yonetici/okul-takvimi`        | Okul Takvimi              |
| `/yonetici/okul-servisi`        | Okul Servisi              |
| `/yonetici/yemek-menusu`        | Yemek Menüsü              |
| `/yonetici/kulupler`            | Kulüpler & Sosyal Gelişim |
| `/yonetici/aday/:id`            | Aday detayı               |

## Ön Büro & Satış

| Yol                            | Sayfa               |
| ------------------------------ | ------------------- |
| `/onburo/dashboard`            | Genel Bakış         |
| `/onburo/adaylar`              | Aday Öğrenciler     |
| `/onburo/deneme-dersi-takvimi` | Tanışma Görüşmeleri |
| `/onburo/kayit-islemleri`      | Kayıt İşlemleri     |
| `/onburo/tahsilat-takip`       | Tahsilat Takibi     |
| `/onburo/talepler`             | Şikayet & Talepler  |
| `/onburo/kayit-yenileme`       | Kayıt Yenileme      |
| `/onburo/okul-takvimi`         | Okul Takvimi        |
| `/onburo/okul-servisi`         | Okul Servisi        |
| `/onburo/yemek-menusu`         | Yemek Menüsü        |
| `/onburo/aday/:id`             | Aday detayı         |

## Öğretmen

| Yol                             | Sayfa                     |
| ------------------------------- | ------------------------- |
| `/ogretmen/dashboard`           | Genel Bakış               |
| `/ogretmen/ders-programi`       | Ders Programım            |
| `/ogretmen/yoklama`             | Yoklama                   |
| `/ogretmen/siniflarim`          | Sınıflarım                |
| `/ogretmen/odevler`             | Ödevler & Değerlendirme   |
| `/ogretmen/materyal-yukle`      | Materyal Kütüphanesi      |
| `/ogretmen/quiz-olustur`        | Quiz Oluştur              |
| `/ogretmen/sorular`             | Soru Kuyruğu              |
| `/ogretmen/sinif-analizi`       | Sınıf Analizi             |
| `/ogretmen/randevular`          | Etüt & Görüşmeler         |
| `/ogretmen/optik-degerlendirme` | Optik Değerlendirme       |
| `/ogretmen/otomatik-etut`       | Otomatik Etüt             |
| `/ogretmen/rehberlik`           | Rehberlik & Takip         |
| `/ogretmen/hedef-plani`         | Hedef & Gelişim Planı     |
| `/ogretmen/deneme-sinavlari`    | Deneme Sınavları          |
| `/ogretmen/program-yonetimi`    | Program Yönetimi          |
| `/ogretmen/calisma-plani`       | Çalışma Planı             |
| `/ogretmen/okul-takvimi`        | Okul Takvimi              |
| `/ogretmen/kulupler`            | Kulüpler & Sosyal Gelişim |

## Öğrenci

| Yol                         | Sayfa                     |
| --------------------------- | ------------------------- |
| `/ogrenci/dashboard`        | Genel Bakış               |
| `/ogrenci/ders-programi`    | Ders Programım            |
| `/ogrenci/videolar`         | Ders Videoları            |
| `/ogrenci/soru-coz`         | Quiz & Testler            |
| `/ogrenci/soru-sor`         | Öğretmenime Sor           |
| `/ogrenci/odevler`          | Ödevlerim                 |
| `/ogrenci/materyaller`      | Materyaller               |
| `/ogrenci/notlarim`         | Notlarım                  |
| `/ogrenci/sinav-analizi`    | Sınav Analizi             |
| `/ogrenci/devamsizlik`      | Devamsızlığım             |
| `/ogrenci/seviye-takibi`    | Akademik Gelişim          |
| `/ogrenci/mesajlar`         | Mesajlar                  |
| `/ogrenci/duyurular`        | Duyurular                 |
| `/ogrenci/randevu-talep`    | Etüt Randevusu            |
| `/ogrenci/odemelerim`       | Ödemelerim                |
| `/ogrenci/ayarlar`          | Ayarlar                   |
| `/ogrenci/otomatik-etut`    | Otomatik Etüt             |
| `/ogrenci/rehberlik`        | Rehberlik & Takip         |
| `/ogrenci/hedef-plani`      | Hedef & Gelişim Planı     |
| `/ogrenci/deneme-sinavlari` | Deneme Sınavları          |
| `/ogrenci/calisma-plani`    | Çalışma Planı             |
| `/ogrenci/okul-takvimi`     | Okul Takvimi              |
| `/ogrenci/okul-servisi`     | Okul Servisi              |
| `/ogrenci/yemek-menusu`     | Yemek Menüsü              |
| `/ogrenci/kulupler`         | Kulüpler & Sosyal Gelişim |

## Veli

| Yol                                | Sayfa                     |
| ---------------------------------- | ------------------------- |
| `/veli/dashboard`                  | Genel Bakış               |
| `/veli/cocuk-secici`               | Çocuklarım                |
| `/veli/akademik-takip`             | Akademik Takip            |
| `/veli/ogretmen-degerlendirmeleri` | Öğretmen Görüşleri        |
| `/veli/sinav-analizi`              | Sınav Analizi             |
| `/veli/seviye-takibi`              | Akademik Gelişim          |
| `/veli/devamsizlik-bildirimi`      | İzin & Mazeret            |
| `/veli/finans`                     | Finans & Ödeme Planı      |
| `/veli/odeme-yap`                  | Ödeme Yap                 |
| `/veli/dekontlar`                  | Dekontlar                 |
| `/veli/sozlesmeler`                | Sözleşmeler               |
| `/veli/randevu-mesaj`              | Randevu & Mesajlar        |
| `/veli/sikayet-talep`              | Şikayet & Talep           |
| `/veli/duyurular`                  | Duyurular                 |
| `/veli/ayarlar`                    | Ayarlar                   |
| `/veli/otomatik-etut`              | Otomatik Etüt             |
| `/veli/rehberlik`                  | Rehberlik & Takip         |
| `/veli/hedef-plani`                | Hedef & Gelişim Planı     |
| `/veli/deneme-sinavlari`           | Deneme Sınavları          |
| `/veli/kayit-yenileme`             | Kayıt Yenileme            |
| `/veli/calisma-plani`              | Çalışma Planı             |
| `/veli/okul-takvimi`               | Okul Takvimi              |
| `/veli/okul-servisi`               | Okul Servisi              |
| `/veli/yemek-menusu`               | Yemek Menüsü              |
| `/veli/kulupler`                   | Kulüpler & Sosyal Gelişim |

Toplam: **99 menü sayfası + 2 kayıt detayı = 101 panel sayfası**, ayrıca giriş ve 404 ekranı. Okul iş akışları ve okul yaşamı kategorilerinde on iki bağımsız web modülü bulunur.

Kullanım rehberleri: [Okul iş akışları](okul-is-akislari.md), [Optik değerlendirme ve etüt](optik-degerlendirme-etut.md).
