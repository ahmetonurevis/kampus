# ADR 0009 · Liste arama metni adreste (URL) tutulmaz

- Durum: Kabul edildi — Sabah kararı 76 ile uygulandı; kullanıcı ve Onur gözden geçirmesi bekleniyor
- Daralttığı: liste durumu kuralı (`.claude/rules/tasarim.md`: arama/filtre/sıralama/sayfa liste başına korunur)
- İster: IST-028 · Görev: OG-066
- Karar veren: Oğuzhan Demirci (öneri; KVKK açısından güvenli ve geri alınabilir seçenek)

## Bağlam

React web listeleri görünüm durumunu `useListState` ile tutar: arama, sayfa, sıralama ve seçili tekli filtreler adres çubuğuna arama parametresi olarak yazılır (`?q=`, `?sayfa=`, `?sirala=`, `?kampus=` …), kaydırma ve diğer filtreler bellekte kalır (`lib/view-memory.ts`). Bu sayede yenileme, paylaşılan bağlantı ve tarayıcının geri/ileri düğmeleri liste durumunu korur.

Arama kutusu serbest metindir; kullanıcı öğrenci ya da veli adı, telefon, e-posta, TCKN parçası yazabilir (KVKK m.3 kişisel veri, IST-028 "telefon varsayılan maskeli"). Adreste duran metin:

- tarayıcı geçmişine, otomatik tamamlamaya ve oturum geri yükleme dosyasına girer; ortak kullanılan ön büro bilgisayarında sonraki kişi görür;
- kopyalanan, e-postayla ya da mesajla paylaşılan bağlantıya ve ekran görüntüsüne taşınır;
- uygulama kendi kökeninde sunulsa da ters vekil (nginx, CDN) erişim logları istek satırını sorgu dizesiyle birlikte yazar; SPA'nın ilk yüklemesi ve yenileme isteği bu satırı oluşturur;
- `Referer` başlığıyla dış kaynağa sızabilir (bugün web `<meta name="referrer" content="same-origin">`, API `Referrer-Policy: no-referrer` bunu sınırlar, ama tek savunma olmamalıdır).

API uygulama logu sorgu dizesini zaten atar (`apps/api/src/app.ts` `req` serileştiricisi, güvenlik-kvkk §13). Aday listesi bu sorunu ekran bazında çözmüştü (`ProspectsPage` `searchInUrl: false`); diğer listeler, örneğin Öğretmenime Sor (`QuestionsPage`, `TODO(liste-arama-url)`), açıkta kalmıştı. Sorun ekrana değil liste altyapısına aittir.

## Karar

1. **Serbest arama metni hiçbir listede adrese yazılmaz.** `listStateToParams` arama parametresini (`<önek>q`) her zaman siler; ekran başına açma/kapama seçeneği yoktur (`searchInUrl` kaldırıldı; Onur'un alanındaki çağrı derlensin diye tipte `@deprecated` olarak durur ve yok sayılır).
2. **Filtre, sıralama ve sayfa adreste kalır.** Bunlar kayıt kimliği ya da sabit seçenek değeridir (kampüs kimliği, durum, sütun adı), serbest kişisel metin taşımaz; paylaşılan bağlantı ve yenileme onları korumaya devam eder (arama sürerken sayfa hariç, karar 4).
3. **Arama metni liste ve çocuk/sekme kapsamı başına yalnız bellekte tutulur** (`view-memory`, anahtar `list:<yol>:<kapsam>:<liste>`). Sayfa içi gezinme, detay sayfasına gidip dönme ve geri/ileri aramayı bellekten geri getirir; sidebar bağlantısı gibi `q`'suz bir bağlantıyla aynı sayfaya gidildiğinde de bellekteki arama korunur. Tam yenilemede ve yeni sekmede arama kaybolur; bu kabul edilen bedeldir.
4. **Arama sürerken sayfa da adrese yazılmaz.** Arama boş değilken `sayfa` (ve önekli karşılığı) yalnız bellektedir; yenilemede arama kaybolunca kullanıcı aramasız listenin N. sayfasına düşmez, ilk sayfadan başlar. Arama silinince sayfa yeniden adrese yazılır.
5. **Eski bağlantı uyumu:** adreste `q` gelirse (eski yer imi, paylaşılmış bağlantı) liste onu bir kez okur ve arama kutusuna koyar; ardından ilk adres yazımı `replace` ile parametreyi siler. Geçmişe yeni girdi eklenmez, geri düğmesi `q`'lu adrese dönmez (dönerse yine okunup silinir).
6. **Depo:** arama metni `localStorage`, `sessionStorage` ve `history.state`'e yazılmaz.

## Sonuçlar

- Liste altyapısı sadeleşir: arama için tek davranış vardır, ekranlar KVKK kararını tek tek vermez; yeni liste varsayılan olarak güvenlidir.
- Kişisel veri tarayıcı geçmişine, paylaşılan bağlantıya ve web sunucusu erişim loguna liste aramasından girmez.
- Kullanıcı yenilemede aramasını yeniden yazar; arama sonucu bağlantıyla paylaşılamaz (filtrelerle paylaşılabilir).
- E2E senaryoları adreste `q=` beklemez; arama sonucunu satır ve sonuç sayısıyla doğrular. Yenilemede aramanın korunduğunu bekleyen senaryolar "yenilemede arama silinir, filtre/sayfa kalır" olarak değişir.
- Bu ADR yalnız web sayfa adresini kapsar. Sunucu sayfalı listeler arama metnini API'ye sorgu parametresiyle gönderir (`GET /api/v1/…?q=`); API uygulama logu sorgu dizesini yazmaz. **API yayını ADR'si** ters vekil ve CDN erişim loglarının da sorgu dizesini yazmamasını (ör. nginx `log_format`'ta `$request` yerine `$uri`) karar olarak içermelidir.
- Geçiş istisnası: finans listesi (`/yonetici/finans`) Onur'un finans e2e beklentileri bu karara uyana kadar aramayı eskisi gibi adreste tutar (`list-url.ts` `keepsSearchInUrl`, `TODO(liste-arama-url-finans)`); istisna #24 kapanınca kaldırılır. Bu yolda arama ve arama içi sayfa eskisi gibi adrese yazılır. Ön büro tahsilat takibi (`/onburo/tahsilat-takip`) bilinçli olarak istisnada değildir: e2e onun aramasını adreste beklemez, daha güvenli davranış orada da geçerlidir.
- Geri alınabilir: karar `list-url.ts` içinde tek noktadadır; ürün kararı değişirse arama yeniden adrese yazılabilir.

## Değerlendirilen alternatifler

- **Ekran bazında `searchInUrl: false`** (mevcut durum): kişisel veri aranan her listenin işaretlenmesini gerektirir; unutulan ekran sızdırır, varsayılan güvensizdir. Hangi listenin kişisel veri arandığı da açık değildir (ders adıyla aranan listede öğrenci adı da yazılabilir).
- **`history.state`'te tutmak:** geri/ileri ve yenilemede aramayı korur ama tarayıcı oturum geçmişini diske yazar (oturum geri yükleme); kişisel veri kalıcı depoya girer. Ayrıca react-router'ın `state`'i başka amaçlarla (dönüş adresi, `keptHistoryState`) taşıdığı için birleştirme kuralı gerekir. Bellek aynı gezinme deneyimini yenileme dışında zaten verir.
- **`sessionStorage`:** yenilemede korur ama kişisel veriyi depoya yazar; web kuralı ve güvenlik-kvkk §3 ile çelişir.
- **Metni adrese şifreli ya da özetle yazmak:** özet geri çevrilemez (arama kurulamaz), şifreleme istemci anahtarı ister ve paylaşılan bağlantıda yine kişisel veriyi taşır.
- **Adres parçasına (`#q=`) yazmak:** sunucuya ve erişim loguna gitmez ama tarayıcı geçmişine, paylaşılan bağlantıya ve ekran görüntüsüne yine girer.
