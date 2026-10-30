# Yetki ve kapsam

Kimin hangi kaynakta hangi işlemi yapabileceği. Yetki iki parçadır: **rol** işlem türünü belirler (ör. "not girebilir"), **kapsam** hangi kayıtlarda geçerli olduğunu belirler (ör. "yalnız atandığı sınıf ve dersin öğrencileri"). İkisi birlikte ve sunucuda school-core kuralıyla uygulanır (ADR 0001 karar 7). İletişim ve rehberliğe özgü görünürlük [iletisim-ve-veli.md](iletisim-ve-veli.md), kaynak paylaşım kapsamı [kaynak-platformu.md](kaynak-platformu.md) içindedir.

Bugünkü kod tek kurumlu demodur: rol URL'den seçilir, kapsam sabit kimliklerle (`t1`, `s1`, `p1`) hesaplanır, kimlik doğrulama yoktur. Aşağıdaki kurallar API geçişinin hedefidir.

## Rol × kaynak × işlem matrisi

Kısaltmalar: **Y** oluşturur/değiştirir, **O** okur, **—** erişim yok. Parantez kapsamı verir. Matris varsayılandır; kurum alt yetkilerle daraltabilir, genişletemez. Yetişkin kursiyer (`DOM-YTK-030`) `ogrenci` sütununu kullanır ve ayrıca `veli` sütunundaki kendine ait işlemleri yapar.

| Kaynak                     | yonetici                 | onburo                          | ogretmen                                                   | ogrenci                                  | veli                             |
| -------------------------- | ------------------------ | ------------------------------- | ---------------------------------------------------------- | ---------------------------------------- | -------------------------------- |
| Aday, tanışma görüşmesi    | Y (kurum)                | Y (kurum)                       | —                                                          | —                                        | —                                |
| Kesin kayıt, sözleşme      | Y                        | Y                               | —                                                          | — (yetişkin: O kendi)                    | O (çocuk; taraf olduğu sözleşme) |
| Fatura, tahsilat, dekont   | Y; iade onayı            | Y (tahsilat; iade onayı yok)    | —                                                          | O kendi (mobilde yok)                    | O + öder (ödeyici olduğu çocuk)  |
| Kampüs, sınıf, kadro       | Y                        | O (sınıf, kontenjan)            | O (kendi sınıfları)                                        | —                                        | —                                |
| Ders programı              | Y                        | O                               | O (kendi)                                                  | O (kendi sınıfı)                         | O (çocuğun sınıfı)               |
| Yoklama                    | O; düzeltme gerekçeli    | —                               | Y (girdiği ders saati)                                     | O kendi                                  | O (çocuk)                        |
| Not, değerlendirme         | O; düzeltme gerekçeli    | —                               | Y (atandığı sınıf + ders); sınıf rehber öğretmeni O (şube) | O kendi                                  | O (çocuk)                        |
| Deneme sınavı, optik       | Y                        | —                               | Y (kendi branşı, kendi sınıfları)                          | O kendi                                  | O (çocuk)                        |
| Etüt                       | Y                        | —                               | Y (kendi uygunluğu, kendi öğrencileri)                     | Y talep (kendi)                          | O (çocuk)                        |
| Hedef ve gelişim planı     | Y                        | —                               | Y (kendi dersi, kendi sınıfları)                           | Y öneri (kendi)                          | O + yorum (çocuk)                |
| Rehberlik: paylaşılan plan | O                        | —                               | rehber öğretmen Y; sınıf rehber/atanmış O                  | O kendi                                  | O (çocuk)                        |
| Rehberlik: iç not          | — (soruşturma istisnası) | —                               | yalnız rehber öğretmen Y                                   | —                                        | —                                |
| Sağlık ve acil bilgi       | O                        | O (yalnız acil müdahale satırı) | O (sınıf rehber, etkinlik sorumlusu)                       | —                                        | Y (çocuk)                        |
| Kaynak platformu içeriği   | Y; onay                  | —                               | Y (kendi), O (kapsamdaki); zümre başkanı onay              | O (kapsamındaki yayında)                 | O (çocuğun gördüğü)              |
| Ödev, quiz                 | O                        | —                               | Y (kendi sınıfları)                                        | teslim/çözer (kendi)                     | O (çocuk)                        |
| Duyuru                     | Y (her kapsam)           | Y (idari, kurum/kampüs)         | Y (kendi sınıfları)                                        | O                                        | O                                |
| Birebir mesaj              | Y (kendi konuşmaları)    | Y (kayıt/ödeme konulu, veliyle) | Y (ders verdiği öğrenci ve velisi)                         | Y (ders veren öğretmen, rehber öğretmen) | Y (çocuğun öğretmenleri, idare)  |
| Etkinlik, veli izni        | Y                        | Y                               | Y (kendi sınıfı); izin veremez                             | O                                        | izin verir (çocuk)               |
| Servis, yemek menüsü       | Y                        | Y                               | —                                                          | O kendi                                  | O (çocuk)                        |
| Kulüp                      | Y                        | —                               | Y (sorumlusu olduğu kulüp)                                 | kayıt/ayrılma (kendi)                    | kayıt/ayrılma (çocuk)            |
| Fotoğraf/video rızası      | O                        | O                               | O (yalnız sonuç: var/yok)                                  | itiraz (kendi)                           | Y (çocuk)                        |
| Modül ayarları             | Y                        | —                               | —                                                          | —                                        | —                                |
| Denetim kaydı              | O (kurum)                | —                               | —                                                          | —                                        | —                                |
| Kendi bildirim tercihi     | Y                        | Y                               | Y                                                          | Y                                        | Y                                |

## İlkeler

### DOM-YTK-001 · Varsayılan ret, sunucuda karar

- **Kural:** Matriste açıkça izin verilmeyen her işlem reddedilir. Yetki kararı her istekte sunucuda, school-core kural fonksiyonuyla verilir; menünün, düğmenin veya route'un gizlenmesi güvenlik sınırı değildir. Yetki reddi kullanıcıya Türkçe ve teknik ayrıntısız gösterilir ("Bu işlem için yetkiniz bulunmuyor").
- **Gerekçe:** İstemci değiştirilebilir; her uç kendi yetkisini denetlemezse tek unutulan uç veri sızdırır.
- **Kaynak:** ADR 0001 karar 7; CLAUDE.md "kurum ve rol kapsamı sunucuda uygulanır; istemciye güvenilmez".
- **Kurum türü:** ikisi
- **Kodda:** kısmen — iş akışı komutlarında rol listesi var (`packages/school-core/src/lib/school-workflows.js:251-286`), ama temel işlemler (`payInvoice`, `recordAttendance`, `gradeQuiz`, `enrollProspect`) rol denetimi yapmaz (`packages/school-core/src/lib/domain.js`); web'de URL'deki rol oturum rolünü değiştirir (`apps/web/src/router.js:83`).

### DOM-YTK-002 · Kapsam kullanıcının üyeliğinden türetilir

- **Kural:** Kapsam istek gövdesinden veya istemci durumundan değil, oturumdaki kullanıcının üyeliğinden (membership) ve ilişkilerinden hesaplanır: öğretmen için ders atamaları, öğrenci için kendi kaydı, veli için doğrulanmış veli–öğrenci bağları. İstemcinin gönderdiği `studentId`, `childId`, `teacherId` yalnız seçim bildirir; sunucu bu kimliğin kapsamda olduğunu doğrular, değilse kaydın varlığını sızdırmadan reddeder.
- **Gerekçe:** Veli çocuk seçicisindeki kimliği değiştirerek başka çocuğu görememelidir.
- **Kaynak:** ADR 0001 karar 6-7.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — kapsam `Actor = { role, links }` bağlantılarından hesaplanır (`packages/school-core/src/lib/scope.ts`, `scopeFor`); seçili çocuk bağlı çocuklardan biri değilse kapsam boştur. Çevrimdışı demo bağlantısız oturumu sabit `t1`/`s1`/`p1` kimliklerine eşler (`sessionActor`); API henüz koleksiyon okumalarında kullanmıyor.

### DOM-YTK-003 · Birden çok üyelik, tek etkin rol

- **Kural:** Bir kişinin aynı kurumda birden çok üyeliği olabilir (ör. öğretmen aynı zamanda veli). Oturum her an tek etkin kurum ve tek etkin rol taşır; rol değiştirmek yeni belirteç üretir ve denetim kaydına yazılır. Veli rolündeyken öğretmen yetkisi kullanılamaz; öğretmen kendi çocuğunun notunu girmez, bu ders için yönetici başka öğretmen atar.
- **Gerekçe:** Rol karışması çıkar çatışması ve kapsam sızıntısı üretir.
- **Kaynak:** ADR 0001 karar 6 (`memberships`); çıkar çatışması kuralı işletme kuralıdır — MEB'de öğretmenin kendi çocuğunu değerlendirmesine ilişkin düzenleme **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok — kullanıcı ve üyelik kavramı yok; rol giriş ekranında seçilir (`apps/web/src/views/Login.vue:26-36`).

## Kurum sınırı

### DOM-YTK-010 · Kurum kimliği yalnız oturumdan

- **Kural:** Her okuma ve yazma oturumdaki etkin kurumla sınırlıdır. İstek gövdesinde, URL'de veya başlıkta gelen `institution_id` yok sayılmaz, reddedilir. Kurum değiştirme yeni oturum belirteci gerektirir; istemci önbelleği kurum değişince temizlenir.
- **Gerekçe:** Kiracı sınırı tek bir parametreye bırakılırsa bir kurumun verisi diğerine açılır.
- **Kaynak:** ADR 0001 karar 4.
- **Kurum türü:** ikisi
- **Kodda:** yok — kurum kavramı yok.

### DOM-YTK-011 · Kurumlar arası erişim yok

- **Kural:** Hiçbir rol başka kurumun kaydını okuyamaz, aratamaz, kopyalayamaz. Başka kurumun kayıt kimliği istenirse yanıt "bulunamadı"dır; kaydın var olduğu sızdırılmaz. Kampüs platformunun kendi personeli için kurum verisine destek erişimi v1'de yoktur; ileride ancak ayrı ADR, kurum yöneticisinin süreli izni ve denetim kaydıyla açılır.
- **Gerekçe:** Platform sağlayıcısı veri işleyendir; kurum verisine kendiliğinden erişmesi veri sorumlusunun talimatı dışında işlemedir.
- **Kaynak:** ADR 0001 karar 4; KVKK md. 12/2 (veri işleyenin sorumluluğu) — **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-YTK-012 · Kurum türü modülleri daraltır

- **Kural:** Kurum türüne uymayan modül açılamaz: sınıf düzeyi, karne, LGS/YKS denemesi, sınıf geçme yalnız `school`; CEFR seviye tespiti, kur/paket, esnek dönem yalnız `language_school`. İngilizce beceri modülleri iki türde de açılır. Uymayan modülün API uçları o kurumda bulunmaz gibi davranır.
- **Gerekçe:** Dil okulunda "7-A şubesi" veya "LGS netleri" anlamsız veri ve yanlış yetki alanı üretir.
- **Kaynak:** ADR 0001 karar 4.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — modül → kurum türü tablosu `MODULE_INSTITUTION_TYPES` ve koleksiyon → modül eşlemesi `COLLECTION_MODULES` (`packages/school-core/src/modules/collection-modules.ts`); `scopeFor(..., { institutionType })` uymayan modülün koleksiyonunu bulunmaz sayar. Kurum kaydı ve API kullanımı yok.

## Roller ve kapsamlar

### DOM-YTK-020 · Yönetici ve alt yetkiler

- **Kural:** `yonetici` kurum genelinde yetkilidir; alt yetkilerle daraltılabilir: `kurucu temsilcisi` (finans, iade, indirim onayı), `müdür` (akademik onay), `kampüs müdür yardımcısı` (yalnız atandığı kampüs). Kampüs kapsamlı yönetici başka kampüsün öğrencisini, sınıfını ve tahsilatını görmez. Hiçbir yönetici alt yetkisi rehberlik iç notunu varsayılan olarak görmez (`DOM-ILT-040`).
- **Gerekçe:** MEB dilinde kurucu, kurucu temsilcisi ve müdür ayrı kişiler olabilir; çok kampüslü kurumda müdür yardımcısı kampüse bağlıdır.
- **Kaynak:** ÖÖKY (kurucu, kurucu temsilcisi, müdür görevleri) — madde numaraları **doğrulanmalı**; alt yetki ayrımı işletme kuralıdır.
- **Kurum türü:** ikisi
- **Kodda:** yok — tek `yonetici` rolü (`packages/school-core/src/modules/navigation.js:2-8`).

### DOM-YTK-021 · Ön büro akademik veriye erişmez

- **Kural:** `onburo` aday, kayıt, sözleşme, tahsilat, servis, yemek ve idari duyuru işlemlerini yapar; öğrenci listesinde kimlik, iletişim, sınıf ve finans bilgisini görür. Not, yoklama ayrıntısı, deneme sonucu, rehberlik (paylaşılan plan dahil), hedef, etüt ve değerlendirme verisini görmez. Sağlık bilgisinden yalnız acil müdahale satırını görür.
- **Gerekçe:** Ön büronun işi akademik veri gerektirmez; veri en aza indirilir.
- **Kaynak:** KVKK md. 4/2-ç (amaçla bağlantılı, sınırlı ve ölçülü işleme).
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — kapsam hesabı `onburo`'yu yöneticiyle aynı "kurum" kapsamına alır (`packages/school-core/src/lib/school-workflows.js:293`); sunum katmanı bu kapsamla rehberlik iç notunu ve deneme sonuçlarını gösterir (`packages/school-core/src/lib/workflow-presentation.js:88-92,102-110`).

### DOM-YTK-022 · Öğretmen: kendi sınıfları ve branşı

- **Kural:** Öğretmenin kapsamı ders atamalarıdır (sınıf + ders). Not ve değerlendirmeyi yalnız atandığı sınıf ve dersin öğrencilerine girer; yoklamayı yalnız girdiği ders saatinde alır; deneme sonucunu yalnız kendi branşında girer. Sınıf rehber öğretmeni kendi şubesindeki öğrencilerin tüm derslerdeki not ve devamsızlığını okur, başka dersin notunu yazamaz. Atama sona erince yazma yetkisi biter; geçmiş kayıtları okuma, yalnız girdiği kayıtlarla sınırlı sürer.
- **Gerekçe:** Not verme yetkisi dersi okutma görevine bağlıdır.
- **Kaynak:** OKY ve OİKY ölçme-değerlendirme hükümleri (dersin öğretmeni puan verir) — **doğrulanmalı**; ADR 0001 karar 7.
- **Kurum türü:** ikisi (dil okulunda sınıf yerine grup)
- **Kodda:** kısmen — sınıf kapsamı atamalardan gelir ama öğretmen sabit `t1` (`packages/school-core/src/lib/school-workflows.js:289-291`); deneme sonucunda branş denetimi var (`packages/school-core/src/lib/school-workflows.js:505`); sınıf rehber öğretmeni ayrımı yok.

### DOM-YTK-023 · Vekil öğretmen

- **Kural:** Geçici görevlendirilen (vekil) öğretmen yalnız görevli olduğu ders saatinde o sınıfın yoklamasını alır ve ders içeriğini görür; not, deneme sonucu ve rehberlik yetkisi kazanmaz. Görev bitince yetki kendiliğinden düşer.
- **Gerekçe:** Tek derslik görev, öğrencinin akademik dosyasına kalıcı erişim gerekçesi değildir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — geçici görev planlanır (`substitute`, `packages/school-core/src/lib/school-workflows.js:264`); yoklama yetkisine bağlanmaz.

### DOM-YTK-024 · Öğrenci: yalnız kendisi

- **Kural:** Öğrenci yalnız kendi kayıtlarını görür. Sınıf arkadaşlarının notu, devamsızlığı, iletişim bilgisi, ödeme durumu ve rehberlik bilgisi görünmez. Karşılaştırma yalnız anonim toplu değerle (sınıf ortalaması gibi) ve en az 5 öğrencilik grupta gösterilir. Kulüp ve etkinlik katılımcı listesinde yalnız ad görünür.
- **Gerekçe:** Küçük grupta "ortalama" bile bireyi tanımlar.
- **Kaynak:** KVKK md. 4/2; 5 öğrenci eşiği işletme kuralıdır.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — öğrenci kapsamı tek öğrencidir ama sabit `s1` (`packages/school-core/src/lib/school-workflows.js:288`); toplu değer eşiği yok.

### DOM-YTK-025 · Veli: yalnız kendi çocukları

- **Kural:** Veli yalnız doğrulanmış bağı ve erişim yetkisi bulunan çocuklarını görür; çocuk seçici yalnız bunları listeler. Yetki çocuk başına ayrı tutulur: aynı veli bir çocukta velayet sahibi, diğerinde velayeti olmayan ebeveyn (`DOM-ILT-070`); bir çocukta ödeyici, diğerinde değil olabilir. Fatura ve ödeme yalnız ödeyici veliye; izin ve rıza yalnız velayet sahibi veliye açıktır. Pasif (ayrılmış/mezun) çocuk için veli yalnız belgelere ve geçmiş kayıtlara salt okur erişir.
- **Gerekçe:** Veli–çocuk ilişkisi tek tip değildir; kardeşler aynı haklarla bağlı olmayabilir.
- **Kaynak:** TMK md. 335-337, 342; ADR 0001 karar 7.
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — veli bağı sabit `p1` ile denetlenir (`packages/school-core/src/lib/school-workflows.js:300-301`), çocuk listesi ilk velinin listesidir (`apps/web/src/App.vue:100`); çocuk başına yetki türü yok.

### DOM-YTK-026 · Rehber öğretmen ayrı yetkidir

- **Kural:** Rehber öğretmen (psikolojik danışman) `ogretmen` rolünde ek yetkiyle tanımlanır: rehberlik dosyalarını kurum veya atandığı kampüs genelinde okur ve yazar, iç notların tek yazarıdır. Bu yetki not girme veya yoklama yetkisi vermez; ders öğretmenliği ayrıca atanır.
- **Gerekçe:** Rehberlik gizliliği (`DOM-ILT-040`) ancak rehberlik yetkisi branş öğretmenliğinden ayrılırsa uygulanabilir.
- **Kaynak:** MEB Rehberlik ve Psikolojik Danışma Hizmetleri Yönetmeliği (RG 14/8/2020-31213) md. 3/1-ç.
- **Kurum türü:** `school`
- **Kodda:** kısmen — rehberlik görevi öğretmen kaydındadır (`guidanceCounselor`; demoda `t1`). Görevli öğretmen kurumun bütün dosyalarını iç notlarıyla okur, görüşme notunu yalnız o yazar (`packages/school-core/src/lib/scope.ts`); dosya açmak hâlâ her `ogretmen` ve yöneticiye açık, kampüs sınırı yok.

### DOM-YTK-027 · Zümre başkanı ve akademik koordinatör

- **Kural:** Zümre başkanı (`school`) ve akademik koordinatör (`language_school`) öğretmene verilen ek yetkidir: kendi branşında/seviyesinde kaynak onayı (`DOM-KYN-031`), branş öğretmenlerinin kaynaklarını ve sınıf düzeyi toplu sonuçlarını okuma. Öğrenci bazında not yazma yetkisi vermez.
- **Gerekçe:** İçerik kalitesi ve ortak sınav hazırlığı zümre düzeyinde yürür.
- **Kaynak:** İşletme kuralı; zümre öğretmenler kurulu hükümleri **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok.

## Yaş ve veli erişimi

### DOM-YTK-030 · Yetişkin kursiyerin velisi yoktur

- **Kural:** Kayıt anında 18 yaşını doldurmuş kursiyere veli bağlanamaz. Sözleşme, ödeme, rıza, izin ve mesaj kursiyerin kendisine aittir. Ödeyici başka biri olabilir (aile, işveren); ödeyici yalnız fatura ve ödeme bilgisini görür, devam, not, seviye ve mesaj bilgisini kursiyerin açık onayı olmadan göremez. İşverenin kurumsal eğitim raporu (devam oranı, seviye) sözleşmede yazılı ve kursiyere bildirilmiş olmalıdır.
- **Gerekçe:** Ergin kişinin fiil ehliyeti vardır; başkasının onun verisine erişmesi üçüncü kişiye aktarımdır.
- **Kaynak:** TMK md. 10-11 ("Erginlik onsekiz yaşın doldurulmasıyla başlar"); KVKK md. 5, 8. Kurumsal eğitimde işverene raporlama dayanağı **doğrulanmalı**.
- **Kurum türü:** `language_school` (lisede 18 yaşını dolduran öğrenci için `DOM-YTK-031`)
- **Kodda:** yok — yaş ve kursiyer kavramı yok; her öğrenciye veli üretilir (`packages/school-core/src/lib/domain.js:153-157`).

### DOM-YTK-031 · 18 yaşını dolduran öğrenci

- **Kural:** Öğrenci 18 yaşını doldurduğu gün (Europe/Istanbul) hesabı "ergin öğrenci" moduna geçer: rıza, izin ve mesajlaşma öğrencinin kendisine geçer; velinin not, devamsızlık, rehberlik paylaşılan planı ve mesaj erişimi öğrencinin onayına bağlanır. Geçişten 30 gün önce öğrenciye ve veliye bildirim gider; öğrenci onay verirse (kapsam seçerek, istediği an geri alabilir) veli erişimi kesintisiz sürer. Velinin taraf olduğu sözleşme ve ödemelere ilişkin erişimi devam eder. Evlenme veya mahkeme kararıyla ergin kılınma yönetici tarafından belgeyle işlenir. Geçmiş veli işlemleri kayıtlı kalır.
- **Gerekçe:** Velayet ergin olmayan çocuk içindir; ergin öğrencinin verisi için veli üçüncü kişidir. Muhafazakâr yol, erişimi kesmek yerine onaya bağlamak ve önceden bildirmektir.
- **Kaynak:** TMK md. 11 (erginlik; evlenme kişiyi ergin kılar), md. 12 (ergin kılınma), md. 335/1 (ergin olmayan çocuk velayet altındadır); KVKK md. 5. Lise öğrencisi ergin olduğunda velinin e-Okul VBS erişimi ve OKY'deki veli bildirimi yükümlülüklerinin (devamsızlık tebligatı) ergin öğrenciye uygulanışı **doğrulanmalı**; yasal bildirim yükümlülüğü varsa o bildirim onaydan bağımsız gider.
- **Kurum türü:** ikisi
- **Kodda:** yok — doğum tarihi tutulmaz.

### DOM-YTK-032 · Kısıtlı ergin

- **Kural:** Hakkında kısıtlama kararı bulunan ergin öğrenci/kursiyer için veli veya vasi erişimi belgeyle sürer; kısıtlılık belgesi yalnız yöneticide tutulur.
- **Gerekçe:** Kısıtlanan ergin çocuk, vasi atanmadıkça ana-baba velayeti altında kalır.
- **Kaynak:** TMK md. 335/2.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-YTK-033 · Yaş sunucuda hesaplanır

- **Kural:** Doğum tarihi kayıtta zorunludur (`DOM-KAY-012`); yaş ve ergin modu sunucuda Europe/Istanbul tarihine göre hesaplanır, istemciden gelmez. Doğum tarihi değişikliği yalnız yönetici tarafından, belgeye dayanarak yapılır ve denetim kaydına yazılır.
- **Gerekçe:** Doğum tarihini değiştirmek veli erişimini değiştirir; bu yüzden yetki değişikliği gibi korunur.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** yok.

## Modül açma ve kapatma

### DOM-YTK-040 · Kapalı modül menüde, route'ta ve API'de kapanır

- **Kural:** Modül kurum başına açılır/kapanır. Kapalı modül için menü öğesi ve boş kategori gizlenir, doğrudan route rol panosuna yönlendirir ve Türkçe uyarı gösterir, ilgili tüm API uçları reddeder (okuma dahil). Kapatma veri silmez; modül yeniden açılınca kayıtlar aynen döner.
- **Gerekçe:** Yalnız menüyü gizlemek, kapatılan işlevi URL veya API ile kullanılabilir bırakır.
- **Kaynak:** CLAUDE.md "Modül kapatıldığında menü, doğrudan route erişimi ve ilgili API uçları kapanır".
- **Kurum türü:** ikisi
- **Kodda:** kısmen — menü (`apps/web/src/App.vue:43`), route (`apps/web/src/router.js:80-82`) ve iş akışı komutları (`packages/school-core/src/lib/school-workflows.js:579-580`) kapanır; temel modüllerin (`crm`, `finance`, `academic`, `learning`, `communication`) işlemleri (`packages/school-core/src/lib/domain.js`) modül denetimi yapmaz; modül durumu kurum başına değil (`packages/school-core/src/data/seed.js:779`).

### DOM-YTK-041 · Kapalı modül yan kanallarda görünmez

- **Kural:** Kapalı modülün verisi dashboard kartlarında, haftalık bültende, aramada, CSV dışa aktarımında ve bildirimlerde görünmez; modüle bağlı zamanlanmış işler (hatırlatma, bülten bölümü) durur. İstisna: ileri tarihli etüt rezervasyonu kaybolmaz ve çakışma denetimine katılmaya devam eder.
- **Gerekçe:** Modül kapatma kurum kararıdır; veri başka kapıdan görünmeye devam ederse karar uygulanmamış olur. Etüt istisnası, kapatma sırasında öğrencinin ayrılmış saatinin başka işe verilmesini önler.
- **Kaynak:** İşletme kuralı; CLAUDE.md "Gelecek etüt rezervasyonu modül kapanınca kaybolmaz".
- **Kurum türü:** ikisi
- **Kodda:** kısmen — etüt istisnası var; dashboard ve diğer yan kanallar için toplu denetim yok.

### DOM-YTK-042 · Modülü yalnız yönetici değiştirir

- **Kural:** Modül açma/kapatma yalnız `yonetici` (alt yetki: müdür veya kurucu temsilcisi) tarafından yapılır, onay penceresiyle istenir ve denetim kaydına yazılır.
- **Gerekçe:** Modül kapatmak tüm rollerin iş akışını bir anda değiştirir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — yalnız yönetici ekranında (`apps/web/src/views/Settings.vue:73,85`); denetim kaydı yalnız rol ve mesaj tutar (`apps/web/src/stores/demo.js:138-147`).

## Denetim kaydı

### DOM-YTK-050 · Her yazma işlemi kaydedilir

- **Kural:** Her yazma işlemi tek veritabanı işleminin parçası olarak denetim kaydı üretir: kurum, kullanıcı kimliği (rol değil kişi), etkin rol, işlem adı, koleksiyon ve kayıt kimliği, zaman (UTC), istek kimliği, eski ve yeni değer. İşlem geri alınırsa denetim kaydı da yazılmaz; denetim kaydı yazılamazsa işlem başarısız olur.
- **Gerekçe:** "Kim, neyi, ne zaman" sorusu kişi düzeyinde cevaplanmalı; denetim kaydı işlemle atomik olmalıdır.
- **Kaynak:** KVKK md. 12/1 (teknik ve idari tedbirler); ADR 0001 karar 6.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — iş akışı komutları eski/yeni değerli kayıt yazar ama kullanıcı kimliği rolden sabit türetilir (`t1`, `s1`, `p1`, `demo-<rol>`; `packages/school-core/src/lib/school-workflows.js:1315-1333`); diğer işlemler yalnız rol ve mesaj yazar (`apps/web/src/stores/demo.js:138-147,160-170`).

### DOM-YTK-051 · Denetim kaydı değişmez ve kesilmez

- **Kural:** Denetim kaydı yalnız eklenir; güncellenemez, silinemez, adet sınırıyla kesilmez. Saklama süresi mevzuat profilinde tanımlıdır; süre dolan kayıtlar periyodik imhada anonimleştirilir (kişi kimliği çıkarılır, işlem ve zaman kalır).
- **Gerekçe:** Son 200 işlemle sınırlı kayıt, uyuşmazlıkta delil olamaz.
- **Kaynak:** KVKK md. 7 ve md. 12/1; saklama süresi **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — kayıt 200 işlemle kesilir (`packages/school-core/src/lib/school-workflows.js:1334`, `apps/web/src/stores/demo.js:147,170`).

### DOM-YTK-052 · Hassas okumalar da kaydedilir

- **Kural:** Şu okumalar da denetim kaydı üretir: rehberlik iç notu, sağlık ve acil bilgi, velayet/vasilik belgesi, yöneticinin gerekçeli olarak açtığı öğrenci–öğretmen yazışması, toplu dışa aktarım (CSV, PDF toplu). Diğer okumalar kaydedilmez.
- **Gerekçe:** Özel nitelikli veriye kimin baktığı ihlal incelemesinin ilk sorusudur; her okumayı kaydetmek ise gereksiz kişisel veri üretir.
- **Kaynak:** KVKK md. 6/4 (Kurul'un yeterli önlemleri: erişim kayıtları) — **doğrulanmalı**; md. 4/2.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-YTK-053 · Denetim kaydının görünürlüğü ve maskesi

- **Kural:** Denetim kaydını yalnız `yonetici` ve yalnız kendi kurumu için görür. Eski/yeni değer alanında rehberlik iç notu, sağlık bilgisi, parola özeti, belirteç ve kimlik numarası maskelenir; yerine "değişti" yazılır (`DOM-ILT-041`).
- **Gerekçe:** Denetim kaydı, gizli alanlara arka kapı olmamalıdır.
- **Kaynak:** KVKK md. 12/1.
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — denetim ekranı yöneticiye açık (`apps/web/src/views/Settings.vue:85,175`) ama iş akışı kayıtları maskesiz tam kayıt saklar (`packages/school-core/src/lib/school-workflows.js:1312-1313,1330`).

### DOM-YTK-054 · Kimlik ve yetki olayları güvenlik logundadır

- **Kural:** Giriş, başarısız giriş, parola değişikliği, oturum yenileme iptali, rol/kurum değiştirme ve yetki reddi (403) yapılandırılmış güvenlik loguna yazılır; aynı kullanıcı veya adres için kısa sürede tekrarlanan başarısız giriş ve yetki reddi uyarı üretir. Kullanıcıya teknik ayrıntı gösterilmez.
- **Gerekçe:** Kapsam sızıntısı denemeleri ancak reddedilen istekler görünürse fark edilir.
- **Kaynak:** CLAUDE.md "teknik hatalar yapılandırılmış logda tutulur"; KVKK md. 12/1.
- **Kurum türü:** ikisi
- **Kodda:** yok — kimlik doğrulama yok.

## Mevcut kodla farklar

| Kural                 | Fark                                                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM-YTK-001           | Temel işlemlerde (`packages/school-core/src/lib/domain.js`) rol denetimi yok; URL'deki rol oturum rolünü değiştiriyor (`apps/web/src/router.js:83`).                                                                  |
| DOM-YTK-002           | Core kapsamı bağlantılardan hesaplıyor (`lib/scope.ts`); demo sabit `s1`/`t1`/`p1` bağlantısı kullanıyor, API koleksiyon okumaları henüz kullanmıyor.                                                                 |
| DOM-YTK-010, 011, 012 | Kurum ve kurum türü kavramı yok; tüm modüller tek kurumda.                                                                                                                                                            |
| DOM-YTK-021           | Ön büro yöneticiyle aynı "kurum" kapsamında; rehberlik iç notu ve deneme sonuçları görünüyor (`packages/school-core/src/lib/school-workflows.js:293`, `packages/school-core/src/lib/workflow-presentation.js:88-92`). |
| DOM-YTK-025           | Çocuk listesi her zaman ilk velinin listesi (`apps/web/src/App.vue:100`); çocuk başına velayet/ödeyici ayrımı yok.                                                                                                    |
| DOM-YTK-026           | Rehber öğretmen yetkisi yok; her öğretmen rehberlik dosyası açabiliyor (`packages/school-core/src/lib/school-workflows.js:256-257`).                                                                                  |
| DOM-YTK-030, 031      | Doğum tarihi ve yaş yok; yetişkin kursiyere de veli üretiliyor (`packages/school-core/src/lib/domain.js:153-157`).                                                                                                    |
| DOM-YTK-040           | Temel modül işlemleri modül kapalıyken school-core'da reddedilmiyor; modül durumu kurum başına değil (`packages/school-core/src/data/seed.js:779`).                                                                   |
| DOM-YTK-050, 051, 053 | Denetim kaydında kişi kimliği sabit, 200 kayıtla kesiliyor, eski/yeni değer maskesiz (`packages/school-core/src/lib/school-workflows.js:1315-1334`, `apps/web/src/stores/demo.js:138-170`).                           |
