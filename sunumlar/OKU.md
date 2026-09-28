# Kampüs yatırımcı sunumu · V2

Web ürününe ağırlık veren **22 slaytlık** güncel sürüm. Sunumda **12 gerçek web ekranı** ve **5 mobil ekranı** bulunur. Mobil öğrenci, veli ve öğretmen deneyimleri **üç ayrı slaytta** korunur.

- **kampus-yatirimci-sunumu-v2.pptx:** Düzenlenebilir PowerPoint; her slaytta Türkçe konuşmacı notu.
- **kampus-yatirimci-sunumu-v2.pdf:** Aynı sunumun paylaşılabilir PDF sürümü.
- **ekran-goruntuleri/web/:** Yeni alınan Vue web ekranlarının tam çözünürlüklü kaynakları.
- **ekran-goruntuleri/:** Sunumda kullanılan 5 Android / Expo mobil görüntüsü.

## Bu sürümde değişenler

Kapak web yönetici paneline taşındı. Modül anlatımı genişletildi; her modül özellikleri ve okul açısından kullanım değeriyle birlikte sunuluyor. Yatırımcı anlatısı okulun satın alma kararı, kurum içindeki kullanım, yıllık lisans, kampüs/modül genişlemesi ve ücretli pilot hedefi etrafında yeniden yazıldı.

Sunumda kullanılan 12 web görüntüsü: yönetici genel bakış, CRM adaylar, kayıt/taksit oluşturma, sözleşme PDF önizleme, finans/tahsilat, kampüsler/sınıflar, eğitim kadrosu, ders programı, quiz oluşturma, ders videoları, sınıf analizi ve veli akademik takip.

Sunumda kullanılan 5 mobil görüntüsü: öğrenci ana ekranı, ödev detayı, veli çocuk seçimi, koyu tema ödeme planı ve öğretmen soru yanıtlama.

## Sunum akışı

1. Kampüs — özel okulun ortak çalışma alanı
2. Yatırım tezi: kurum kararı, günlük kullanım ve genişleme
3. Altı iş alanından oluşan modül haritası
4. Pazar ve ilk müşteri profili
5. Web CRM ve adaydan kayda dönüşüm
6. Web kesin kayıt, sözleşme ve taksit planı
7. Web finans ve tahsilat
8. Web kampüs, sınıf ve eğitim kadrosu
9. Web akademik operasyon
10. Web LMS, quiz ve video/materyal
11. Web analiz, risk ve yanıt süresi takibi
12. Web veli ve iletişim portalı
13. Mobil öğrenci deneyimi — iki ekran
14. Mobil veli deneyimi — iki ekran
15. Mobil öğretmen deneyimi — bir ekran
16. Önerilen gelir modeli
17. Giriş ihtiyacından kurum içi genişlemeye konumlandırma
18. Önerilen üç okul pilotu ve ölçülecek kriterler
19. Bugünkü ürün ve önerilen yol haritası
20. Yatırım görüşmesinin odağı ve kaynak kullanım alanları
21. Ek: ayrıntılı modül kapsamı
22. Ek: kaynaklar ve veri notu

İlk 20 slayt ana anlatımdır. Son iki slayt soru-cevap ve ayrıntı desteği içindir. Ayrıntılı ekran incelemesinde kaynak PNG dosyaları açılabilir; sunumdaki görseller gömülüdür, harici görüntü bağlantısına ihtiyaç duymaz.

## Ürün kanıtı ve ticari plan ayrımı

Tüm ekranlar çalışan yerel uygulamalardan alındı. Web görüntüleri Vue panelidir; mobil görüntüler gerçek Android 1.3.0 APK ve React Native / Expo önizlemesidir. Referans tasarımlar veya yapay üretilmiş ürün görselleri kullanılmadı.

Ekranlardaki okul, kişiler, öğrenci sayıları, ciro, bakiye ve adaylar **örnek veridir**; Kampüs şirketinin müşteri veya gelir göstergeleri değildir. Web/mobil ayrı yerel kayıtlarla çalışır; mevcut sürümde cihazlar arası canlı eşzamanlılık yoktur. Gerçek backend, üretim yetkilendirmesi, kurum izolasyonu, banka ve dış bildirim bağlantıları geliştirme yol haritasındadır.

Gelir modeli, üç okul pilot hedefi, satış stratejisi ve takvim **öneridir**. Gerçekleşmiş müşteri, ücretli pilot veya satış olarak sunulmaz. Yatırım tutarı, değerleme, ortaklık payı ve ekip özgeçmişi sağlanmadığından uydurulmamıştır. Sunum, ürünün gösterilmesi ve pilot/ürünleştirme görüşmesi için hazırlanmıştır.

## Pazar kaynağı

[MEB — 2024–2025 Örgün Eğitim İstatistikleri Açıklandı](https://www.meb.gov.tr/2024-2025-orgun-egitim-istatistikleri-aciklandi//haber/38473/tr), yayımlanma **30.09.2025**; erişim **28.09.2026**. [Resmî istatistik portalı](https://istatistik.meb.gov.tr/).

- **14.700** özel okul
- **1.539.579** özel kurum öğrencisi
- **177.738** özel okul öğretmeni

Veriler 2024–2025 dönemine aittir. Okul sayısı tekil kampüs veya müşteri sayısı değildir; fiyatla çarpılarak parasal pazar büyüklüğü olarak sunulmamıştır. Ortaokul/lise içeren özel okullar ilk hedef segment önerisidir; bu segment için ayrı büyüklük iddiası yoktur.

## Üretim ve doğrulama

İstenen [Office-PowerPoint-MCP-Server](https://github.com/GongRzhe/Office-PowerPoint-MCP-Server) (MIT), `3631ba2ec0c24504476f78bf74d329c9be11caaa` sürümünden kullanıldı. Claude projesindeki `powerpoint` stdio kaydı korunur. Ayrı Python ortamında repo ile uyumlu MCP 1.30.0 kuruludur.

Yeni sürüm **424 MCP çağrısıyla** oluşturuldu: 22 slayt, **289 düzenlenebilir metin kutusu**, **17 gömülü ekran görüntüsü** ve 22 konuşmacı notu. Son biçimlendirme yerel python-pptx ile; PDF LibreOffice ile üretildi. Bütün slaytlar görsel olarak incelendi. Slayt/PDF sayfa sayıları, PDF metin bütünlüğü, sayfa dışı öğeler, görsel en-boy oranları, notlar ve 12 web / 5 mobil dağılımı kontrol edildi.

Üretim ve kontrol betikleri `scripts/sunum/` içindedir; Python ortamının sabit sürümleri `requirements.lock` dosyasında kayıtlıdır. Yeniden üretim sırasında geçici dosyalar, araç çağrıları ve kontrol çıktıları `artifacts/investor-presentation/` altında oluşturulur. Eski sunumlar, yinelenen teslimler ve kullanılmayan ekran görüntüleri temizlenmiştir.

Proje kökünden yeniden üretim:

```sh
/Users/onurevis/.local/share/kampus-tools/powerpoint-venv/bin/python scripts/sunum/build-deck.py
/Applications/LibreOffice.app/Contents/MacOS/soffice -env:UserInstallation=file:///tmp/kampus-investor-libreoffice --headless --convert-to pdf --outdir sunumlar sunumlar/kampus-yatirimci-sunumu-v2.pptx
/Users/onurevis/.local/share/kampus-tools/powerpoint-venv/bin/python scripts/sunum/validate-deck.py
```
