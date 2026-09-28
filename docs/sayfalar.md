# Demo sayfaları

Giriş: `/giris`. Kök adres giriş ekranına veya seçili rolün dashboard’una yönlenir.

## Yönetici

| Yol                         | Sayfa                     |
| --------------------------- | ------------------------- |
| `/yonetici/dashboard`       | Genel Bakış               |
| `/yonetici/finans`          | Finans & Tahsilat         |
| `/yonetici/subeler`         | Kampüsler & Sınıflar      |
| `/yonetici/personel`        | Eğitim Kadrosu            |
| `/yonetici/kayit-raporlari` | Kayıt Raporları           |
| `/yonetici/sla-raporu`      | SLA Raporu                |
| `/yonetici/risk-listesi`    | Risk Altındaki Öğrenciler |
| `/yonetici/ayarlar`         | Ayarlar                   |

## Ön Büro & Satış

| Yol                            | Sayfa                                 |
| ------------------------------ | ------------------------------------- |
| `/onburo/dashboard`            | Genel Bakış                           |
| `/onburo/adaylar`              | Aday Öğrenciler                       |
| `/onburo/deneme-dersi-takvimi` | Tanışma Görüşmeleri                   |
| `/onburo/kayit-islemleri`      | Kayıt İşlemleri                       |
| `/onburo/tahsilat-takip`       | Tahsilat Takibi                       |
| `/onburo/talepler`             | Şikayet & Talepler                    |
| `/onburo/aday/:id`             | Aday detayı; örnek `/onburo/aday/pr1` |

## Öğretmen

| Yol                        | Sayfa                                         |
| -------------------------- | --------------------------------------------- |
| `/ogretmen/dashboard`      | Genel Bakış                                   |
| `/ogretmen/ders-programi`  | Ders Programım                                |
| `/ogretmen/yoklama`        | Yoklama                                       |
| `/ogretmen/siniflarim`     | Sınıflarım                                    |
| `/ogretmen/odevler`        | Ödevler & Değerlendirme                       |
| `/ogretmen/materyal-yukle` | Materyal Kütüphanesi                          |
| `/ogretmen/quiz-olustur`   | Quiz Oluştur                                  |
| `/ogretmen/sorular`        | Soru Kuyruğu                                  |
| `/ogretmen/sinif-analizi`  | Sınıf Analizi                                 |
| `/ogretmen/randevular`     | Etüt & Görüşmeler                             |
| `/ogretmen/ogrenci/:id`    | Öğrenci profili; örnek `/ogretmen/ogrenci/s1` |

## Öğrenci

| Yol                      | Sayfa            |
| ------------------------ | ---------------- |
| `/ogrenci/dashboard`     | Genel Bakış      |
| `/ogrenci/ders-programi` | Ders Programım   |
| `/ogrenci/videolar`      | Ders Videoları   |
| `/ogrenci/soru-coz`      | Quiz & Testler   |
| `/ogrenci/soru-sor`      | Öğretmenime Sor  |
| `/ogrenci/odevler`       | Ödevlerim        |
| `/ogrenci/materyaller`   | Materyaller      |
| `/ogrenci/notlarim`      | Notlarım         |
| `/ogrenci/sinav-analizi` | Sınav Analizi    |
| `/ogrenci/devamsizlik`   | Devamsızlığım    |
| `/ogrenci/seviye-takibi` | Akademik Gelişim |
| `/ogrenci/mesajlar`      | Mesajlar         |
| `/ogrenci/duyurular`     | Duyurular        |
| `/ogrenci/randevu-talep` | Etüt Randevusu   |
| `/ogrenci/odemelerim`    | Ödemelerim       |
| `/ogrenci/ayarlar`       | Ayarlar          |

## Veli

| Yol                                | Sayfa                |
| ---------------------------------- | -------------------- |
| `/veli/dashboard`                  | Genel Bakış          |
| `/veli/cocuk-secici`               | Çocuklarım           |
| `/veli/akademik-takip`             | Akademik Takip       |
| `/veli/ogretmen-degerlendirmeleri` | Öğretmen Görüşleri   |
| `/veli/sinav-analizi`              | Sınav Analizi        |
| `/veli/seviye-takibi`              | Akademik Gelişim     |
| `/veli/devamsizlik-bildirimi`      | İzin & Mazeret       |
| `/veli/finans`                     | Finans & Ödeme Planı |
| `/veli/odeme-yap`                  | Ödeme Yap            |
| `/veli/dekontlar`                  | Dekontlar            |
| `/veli/sozlesmeler`                | Sözleşmeler          |
| `/veli/randevu-mesaj`              | Randevu & Mesajlar   |
| `/veli/sikayet-talep`              | Şikayet & Talep      |
| `/veli/duyurular`                  | Duyurular            |
| `/veli/ayarlar`                    | Ayarlar              |

Toplam: **57 panel sayfası + giriş ekranı**. Bilinmeyen yollar için 404 ekranı bulunur.
