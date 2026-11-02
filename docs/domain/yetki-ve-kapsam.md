# Yetki ve kapsam

Kimin hangi kaynakta hangi işlemi yapabileceği. Yetki iki parçadır: **rol** işlem türünü belirler (ör. "not girebilir"), **kapsam** hangi kayıtlarda geçerli olduğunu belirler (ör. "yalnız atandığı sınıf ve dersin öğrencileri"). İkisi birlikte ve sunucuda school-core kuralıyla uygulanır (ADR 0001 karar 7). İletişim ve rehberliğe özgü görünürlük [iletisim-ve-veli.md](iletisim-ve-veli.md), kaynak paylaşım kapsamı [kaynak-platformu.md](kaynak-platformu.md) içindedir.

Bugünkü kod tek kurumlu demodur: rol URL'den seçilir, kapsam sabit kimliklerle (`t1`, `s1`, `p1`) hesaplanır, kimlik doğrulama yoktur. Aşağıdaki kurallar API geçişinin hedefidir.

## Rol × kaynak × işlem matrisi

Kısaltmalar: **Y** oluşturur/değiştirir, **O** okur, **—** erişim yok. Parantez kapsamı verir. Matris varsayılandır; kurum alt yetkilerle daraltabilir, genişletemez. Yetişkin kursiyer (`DOM-YTK-030`) `ogrenci` sütununu kullanır ve ayrıca `veli` sütunundaki kendine ait işlemleri yapar.

| Kaynak                     | yonetici                 | onburo                          | ogretmen                                                                                     | ogrenci                                      | veli                                              |
| -------------------------- | ------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Aday, tanışma görüşmesi    | Y (kurum)                | Y (kurum)                       | —                                                                                            | —                                            | —                                                 |
| Kesin kayıt, sözleşme      | Y                        | Y                               | —                                                                                            | — (yetişkin: O kendi)                        | O (çocuk; taraf olduğu sözleşme)                  |
| Fatura, tahsilat, dekont   | Y; iade onayı            | Y (tahsilat; iade onayı yok)    | —                                                                                            | O kendi (mobilde yok)                        | O + öder (ödeyici olduğu çocuk)                   |
| Kampüs, sınıf, kadro       | Y                        | O (sınıf, kontenjan)            | O (kendi sınıfları)                                                                          | —                                            | —                                                 |
| Ders programı              | Y                        | O                               | O (kendi)                                                                                    | O (kendi sınıfı)                             | O (çocuğun sınıfı)                                |
| Yoklama                    | O; düzeltme gerekçeli    | —                               | Y (girdiği ders saati; aynı gün)                                                             | O kendi (güncel değer)                       | O (çocuk; güncel değer)                           |
| Not, değerlendirme         | O; düzeltme gerekçeli    | —                               | Y (atandığı sınıf + ders; düzeltme notun verildiği sınıfta); sınıf rehber öğretmeni O (şube) | O kendi (güncel değer)                       | O (çocuk; güncel değer)                           |
| Deneme sınavı, optik       | Y                        | —                               | Y (kendi branşı, kendi sınıfları)                                                            | O kendi                                      | O (çocuk)                                         |
| Etüt                       | Y                        | —                               | Y (kendi uygunluğu, kendi öğrencileri)                                                       | Y talep (kendi)                              | O (çocuk)                                         |
| Randevu (görüşme)          | O                        | —                               | Y (kendi randevuları: onay, red, iptal)                                                      | Y talep, geri çekme (kendi)                  | Y talep, geri çekme (çocuk; kendi açtığı görüşme) |
| Hedef ve gelişim planı     | Y                        | —                               | Y (kendi dersi, kendi sınıfları)                                                             | Y öneri (kendi)                              | O + yorum (çocuk)                                 |
| Rehberlik: paylaşılan plan | O                        | —                               | rehber öğretmen Y; sınıf rehber/atanmış O                                                    | O kendi                                      | O (çocuk)                                         |
| Rehberlik: iç not          | — (soruşturma istisnası) | —                               | yalnız rehber öğretmen Y                                                                     | —                                            | —                                                 |
| Veli iletişim bilgisi      | O                        | O                               | O maskeli; tam değer "Göster" ile, denetimli (ders verdiği öğrencinin velisi; `DOM-YTK-055`) | —                                            | —                                                 |
| Sağlık ve acil bilgi       | O                        | O (yalnız acil müdahale satırı) | O (sınıf rehber, etkinlik sorumlusu)                                                         | —                                            | Y (çocuk)                                         |
| Kaynak platformu içeriği   | Y; onay                  | —                               | Y (kendi), O (kapsamdaki); zümre başkanı onay                                                | O (kapsamındaki yayında)                     | O (çocuğun gördüğü)                               |
| Ödev, quiz                 | O                        | —                               | Y (kendi sınıfları)                                                                          | teslim/çözer (kendi)                         | O (çocuk)                                         |
| Görev ataması              | Y (kurum)                | —                               | Y (kendi ataması); O (kendi sınıflarına hedeflenen; `DOM-YTK-028`)                           | O kendi                                      | O (çocuk)                                         |
| Öğretmenime Sor            | O                        | —                               | Y yanıt (kendisine atanan soru; ek yanıt derse atanmışken)                                   | Y soru, geri çekme (kendi; ders öğretmenine) | O (çocuk)                                         |
| Duyuru                     | Y (her kapsam)           | Y (idari, kurum/kampüs)         | Y (kendi sınıfları)                                                                          | O                                            | O                                                 |
| Birebir mesaj              | Y (kendi konuşmaları)    | Y (kayıt/ödeme konulu, veliyle) | Y (ders verdiği öğrenci ve velisi)                                                           | Y (ders veren öğretmen, rehber öğretmen)     | Y (çocuğun öğretmenleri, idare)                   |
| Etkinlik, veli izni        | Y                        | Y                               | Y (kendi sınıfı); izin veremez                                                               | O                                            | izin verir (çocuk)                                |
| Servis, yemek menüsü       | Y                        | Y                               | —                                                                                            | O kendi                                      | O (çocuk)                                         |
| Kulüp                      | Y                        | —                               | Y (sorumlusu olduğu kulüp)                                                                   | kayıt/ayrılma (kendi)                        | kayıt/ayrılma (çocuk)                             |
| Fotoğraf/video rızası      | O                        | O                               | O (yalnız sonuç: var/yok)                                                                    | itiraz (kendi)                               | Y (çocuk)                                         |
| Modül ayarları             | Y                        | —                               | —                                                                                            | —                                            | —                                                 |
| Denetim kaydı              | O (kurum)                | —                               | —                                                                                            | —                                            | —                                                 |
| Kendi bildirim tercihi     | Y                        | Y                               | Y                                                                                            | Y                                            | Y                                                 |

## İlkeler

### DOM-YTK-001 · Varsayılan ret, sunucuda karar

- **Kural:** Matriste açıkça izin verilmeyen her işlem reddedilir. Yetki kararı her istekte sunucuda, school-core kural fonksiyonuyla verilir; menünün, düğmenin veya route'un gizlenmesi güvenlik sınırı değildir. Yetki reddi kullanıcıya Türkçe ve teknik ayrıntısız gösterilir ("Bu işlem için yetkiniz bulunmuyor").
- **Gerekçe:** İstemci değiştirilebilir; her uç kendi yetkisini denetlemezse tek unutulan uç veri sızdırır.
- **Kaynak:** ADR 0001 karar 7; CLAUDE.md "kurum ve rol kapsamı sunucuda uygulanır; istemciye güvenilmez".
- **Kurum türü:** ikisi
- **Kodda:** kısmen — iş akışı komutlarında rol listesi var (`packages/school-core/src/lib/school-workflows.ts`, `mayRun`). Tahsilat, yoklama, not girişi/düzeltmesi, kampüs/sınıf/kadro arşivi ve kaydı (oluşturma/düzenleme: `branch.save`, `teacher.save`, `class.save`, yalnız `yonetici`) için yazma yetkisi `packages/school-core/src/lib/authorize.ts` (`authorize`, `requireAuthorized`) tek tablodadır; işlemler (`payInvoice`, `recordAttendance`, `archiveRecord`) yetkiyi kendileri denetlemez, çağıran önce `requireAuthorized` çalıştırır (not işlemleri kendi içinde çağırır). API ödeme, yoklama, arşiv, kampüs/öğretmen/sınıf kaydı ve not uçlarında aynı kararı kullanır (`apps/api/src/services/commands.ts`). Matristeki veli "öder" izni tahsilat kaydı değil, ayrı `invoice.payOnline` eylemidir; ödeme sağlayıcısı onayı bekler ve henüz işlem çağırmaz (`DOM-FIN-052`). Aday işlemleri (`prospect.create`, `prospect.stage`, `prospect.note`, `prospect.meeting`, `prospect.trial`; `packages/school-core/src/lib/prospects.ts`) yalnız yönetici ve ön büroya açıktır ve işlem içinde `requireAuthorized` çağırır; API ucu D16b'dedir. Kesin kayıt yetkisi `prospect.enroll` (yönetici ve ön büro, modül `crm`; `DOM-KAY-035`); `enrollProspect` `payInvoice` gibi yetkiyi kendisi denetlemez, API ucu (`POST /api/v1/prospects/:prospectId/enroll`) işlemden önce `requireAuthorized` çalıştırır ve `crm` yanında `finance` modülünü de ister (taksit ve sözleşme yazar), demo çağıranları denetlemez; web'de URL'deki rol oturum rolünü değiştirir (`apps/web/src/router.js:83`).

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
- **Kodda:** kısmen — modül → kurum türü tablosu `MODULE_INSTITUTION_TYPES` ve koleksiyon → modül eşlemesi `COLLECTION_MODULES` (`packages/school-core/src/modules/collection-modules.ts`); `scopeFor(..., { institutionType })` uymayan modülün koleksiyonunu bulunmaz sayar. API kurum kaydındaki türü kullanır: `requireModule` ve koleksiyon okuma uçları uymayan modülde 404 döner (`apps/api/src/plugins/modules.ts`, `apps/api/src/services/read-scope.ts`); kurum türüne göre modül açma engeli (ayar ekranı) yok.

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
- **Kodda:** kısmen — sınıf kapsamı atamalardan gelir ama öğretmen sabit `t1` (`packages/school-core/src/lib/school-workflows.js:289-291`); deneme sonucunda branş denetimi var (`packages/school-core/src/lib/school-workflows.js:505`); sınıf rehber öğretmeni ayrımı yok. Sınıfın ders öğretmeni değişince (`updateClass`/`saveClass`, `packages/school-core/src/lib/school-management.ts`) yalnız açık kayıtlar yeni öğretmene geçer: teslim süresi geçmemiş ya da notu girilmemiş teslimi olan ödev, yanıt bekleyen (geri çekilmemiş, `DOM-ILT-091`) öğrenci sorusu ve hiç deneme kaydı olmayan quiz (quizin tarihi yoktur; çözülmüş quiz notlarını üreten öğretmende kalır), ayrıca gelecek dersler ve tamamlanmamış çalışma görevleri. Notlanmış ödev, cevaplanmış veya geri çekilmiş soru ve çözülmüş quiz eski öğretmende kalır. Mevcut ders öğretmeni pasifleşmişse yalnız derslik değişen düzenleme de `subject_teacher_required` ile reddedilir; mesaj dersi ve öğretmenin pasifliğini söyler.

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
- **Kodda:** kısmen — core `packages/school-core/src/lib/coordinator-duties.ts` (`planCoordinatorDuty`: yalnız öğretmene, `school`'da öğretmenin kendi branşında, dil okulunda CEFR seviyesinde; `coordinatesArea`); API (F4b3b2b) `coordinator_duties` tablosu (migration `0016`), `GET/POST /api/v1/coordinator-duties`, `DELETE /api/v1/coordinator-duties/:dutyId` (yalnız yönetici atar ve kaldırır). Görev atama görünürlüğü vermez; koordinatör alanındaki uyuşmazlıklı teslimi okur ve son puanı verir (`POST /api/v1/task-submissions/:id/final-scores`, DOM-BEC-024). Kaynak onayı (DOM-KYN-031) ve sınıf düzeyi toplu sonuç okuması henüz bağlı değil (`TODO(content-reviewer)`); bir kapsamın tek görevlisi olup olmadığı `TODO(zumre-tekil)`, artı seviyenin kapsamı `TODO(koordinator-arti-seviye)`.

### DOM-YTK-028 · Görev atamasını sınıfın öğretmeni de görür, yalnız atayan değiştirir

- **Kural:** Görev atamasını (ödev, quiz, beceri görevi) yönetici kurumda; öğretmen kendi yaptığı atamaları, kapsamındaki sınıfı/grubu hedefleyen atamaları ve o sınıfların güncel öğrencilerine hedeflenmiş atamaları görür. Öğretmen kapsamı `DOM-YTK-022`'dir (ders verdiği ve sınıf rehber öğretmeni olduğu sınıflar). Atayan olmayan öğretmen atamanın hedef listesinde yalnız kendi kapsamındaki sınıf ve öğrencileri görür. Deneme ve teslimlerde görünürlük atamayı izler: atamayı görebilen personel o atamaya yapılmış bütün deneme ve teslimleri görür; öğrencinin güncel sınıfı önemli değildir. Örnek: Deniz 9-A'dan 9-B'ye geçerse 9-A atamasındaki teslimini 9-A'yı gören öğretmen görmeye devam eder; 9-B öğretmeni, 9-B'yi hedeflemeyen atamayı (ve teslimini) görmez. Öğrenci kendi, veli çocuklarının deneme ve teslimini sınıf değişse de görür; deneme ve teslimi yalnız öğrenci yazar, veli okur. Atamayı yalnız atayan kişi ve yönetici değiştirir; atamayı gören ama atayan olmayan öğretmenin değişikliği reddedilir. Öğrenci kendisine, veli çocuklarına hedeflenen atamayı görür.
- **Gerekçe:** Teslimi sınıfın ders öğretmeni puanlar; başka öğretmenin veya yöneticinin o sınıfa verdiği görevi göremeyen öğretmen puanlayamaz. Ayarları değiştirmek ise görevi verenin sorumluluğudur.
- **Kaynak:** İşletme kuralı; ADR 0004 karar 4.
- **Kurum türü:** ikisi (dil okulunda sınıf yerine grup)
- **Kodda:** var — API `apps/api/src/services/task-assignments.ts` (`visible`, `listFilter`; öğretmen kapsamı `read-scope.ts` `readScope`: `scope.classIds`, `scope.studentIds`); `PATCH /api/v1/task-assignments/:assignmentId` kapsam dışına 404, görünür ama atayan olmayan öğretmene 403 `forbidden`, ardından sürüm 409. Deneme ve teslim okuması `apps/api/src/services/task-work.ts` `readableLearners` (personelde atamayı görmek yeterli; öğrenci/veli sahiplik), yazma yalnız `ogrenci` (rota ve servis); testler `apps/api/test/task-attempts.test.ts`, `apps/api/test/task-submissions.test.ts`. Puanlama ve yeniden teslim isteği atamayı gören öğretmene (atayan olmasa da) ve yöneticiye açıktır, görmeyen öğretmene 404, öğrenci/veli/ön büroya 403 (`apps/api/src/services/task-grading.ts`; test `apps/api/test/task-grading.test.ts`). Kural henüz core'da değil (`TODO(core-atama-yetki)`). Web: öğretmenin Görevler sekmesi (`apps/web-react/src/pages/tasks/`, `/ogretmen/odevler?sekme=gorevler`) atadıklarını ve sınıfını hedefleyen atamaları listeler; son teslimi uzatma düğmesi yalnız atayana (ve yöneticiye) görünür, atayan olmayan öğretmen ayrıntıyı salt okur görür ve API değişikliği 403 verir (e2e `tests/e2e-react/ogretmen-gorevler.spec.ts`, birim `apps/web-react/tests/task-model.test.ts`).

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
- **Kodda:** kısmen — menü (`apps/web/src/App.vue:43`) ve route (`apps/web/src/router.js:80-82`) kapanır. Komut → modül ve komut → koleksiyon tablosu `packages/school-core/src/modules/commands.ts` (`WORKFLOW_COMMANDS`, `ASSESSMENT_COMMANDS`, `OPERATION_COMMANDS`, `commandSpec`) tek yerdedir; iş akışı komutları (`runWorkflow`) ve temel yazma eylemleri (`authorize`) modülü buradan okur. Modül kurum başına saklanır (`institutions.enabled_modules`); API koleksiyon okuma/yazma ve komut uçlarında `requireModule` ile 403 `module_disabled` döner, `PATCH /api/v1/modules/:moduleKey` ile açılıp kapanır (`DOM-YTK-042`). Temel işlemlerin kendisi (`packages/school-core/src/lib/domain.ts`) modül denetimi yapmaz, çağıran `requireAuthorized` çalıştırır. Kapatma kayıtlara dokunmaz; modüller arası ön koşul/bağımlılık tanımı yoktur.

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
- **Kodda:** var — core `setModuleEnabled` (`packages/school-core/src/lib/institution-modules.ts`): yalnız yönetici (`permission_denied`), kurum türünde olmayan modül 422 `module_unavailable_for_type`, durum değişmiyorsa 409 `module_unchanged`; saf işlemdir, kayıtlara dokunmaz. API `PATCH /api/v1/modules/:moduleKey` (`{ enabled }`, `If-Match` = `institution_settings.version`, `Idempotency-Key` zorunlu) tek transaction'da `institutions.enabled_modules`'ı ve sürümü günceller, `audit_log`'a `module.set` + `changes.fields: ['enabledModules']` yazar. Web: Ayarlar → Kurum & Modüller, kapatmadan önce onay penceresi. Eski demo ekranı `apps/web/src/views/Settings.vue:73,85`; denetim kaydı yalnız rol ve mesaj tutar (`apps/web/src/stores/demo.js:138-147`).

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

- **Kural:** Şu okumalar da denetim kaydı üretir: rehberlik iç notu, sağlık ve acil bilgi, velayet/vasilik belgesi, yöneticinin gerekçeli olarak açtığı öğrenci–öğretmen yazışması, öğretmenin açtığı veli iletişim bilgisi (`DOM-YTK-055`), toplu dışa aktarım (CSV, PDF toplu). Diğer okumalar kaydedilmez.
- **Gerekçe:** Özel nitelikli veriye kimin baktığı ihlal incelemesinin ilk sorusudur; her okumayı kaydetmek ise gereksiz kişisel veri üretir.
- **Kaynak:** KVKK md. 6/4 (Kurul'un yeterli önlemleri: erişim kayıtları) — **doğrulanmalı**; md. 4/2.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — yöneticinin gerekçeli yazışma erişimi var: `POST /conversations/:id/access` gerekçeyi (≥ 10 karakter) `audit_log.reason` kolonuna, `changes` boş bırakarak yazar (`conversation.access`, 30 dk geçerli). Rehberlik iç notu, sağlık ve acil bilgi, velayet belgesi okumaları ve toplu dışa aktarım denetim kaydı üretmez.

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

### DOM-YTK-055 · Veli iletişim bilgisi öğretmene maskeli, açılışı denetimli

- **Kural:** Öğrenciye ders veren öğretmen (öğrencinin sınıfında branş dersi ya da sınıf rehberliği olan; `DOM-YTK-022`) o öğrenciye bağlı velinin telefonunu ve e-postasını yalnız maskeli görür: telefonun ilk dört ve son iki hanesi (`0532 *** ** 12`), e-postanın ilk harfi ve alan adı (`a***@gmail.com`). Tam değer ayrı "Göster" işlemiyle, alan başına açılır; her açılış denetim kaydına yazılır: kim, hangi öğrencinin hangi velisinin hangi alanını, ne zaman açtı. Değer denetim kaydına, loga ve adrese yazılmaz; istemci açılan değeri yalnız bellekte tutar, kalıcı depoya yazmaz, yanıt önbelleğe alınmaz. Açılışlar kullanıcı başına dakikada 10 ile sınırlıdır; aşılırsa "Çok fazla istek gönderildi" yanıtı döner. Ders vermeyen öğretmen veliyi göremez ve açamaz; kapsam dışı öğrenci, öğrenciye bağlı olmayan veli ve olmayan veli aynı "bulunamadı" yanıtını alır. Öğrenci ve veli hiçbir velinin (aynı çocuğun diğer velisi dahil, `DOM-ILT-073`) telefonunu ve e-postasını görmez. Yönetici ve ön büro tam değeri görmeye devam eder.
- **Gerekçe:** Öğretmen veliye ulaşmak için iletişim bilgisine ihtiyaç duyabilir, ama her listeleme tam değeri açarsa bilgi gereksiz yayılır (veri en aza indirme). Maskeli gösterim veliyi tanıtır; bilinçli açılış ve kaydı, kötüye kullanımı geriye dönük incelenebilir kılar.
- **Kaynak:** KVKK md. 4/2-ç (amaçla bağlantılı, sınırlı ve ölçülü işleme), md. 12/1 (teknik ve idari tedbirler) — **doğrulanmalı**; maske biçimi ve dakika sınırı işletme kuralıdır. Kullanıcı kararı (KV1).
- **Kurum türü:** ikisi (yetişkin kursiyerde veli yoktur, `DOM-YTK-030`)
- **Kodda:** var — maske ve karar `packages/school-core/src/lib/parent-contact.ts` (`maskPhone`, `maskEmail`, `parentContactDecision`, `revealParentContact`); alan ayıklaması `lib/scope.ts` (`parents`: öğretmende maskeli ve aranmaz, öğrencide ayıklanır; velide ayıklama kayıt testinin beklentisi değişene kadar açık, TODO #10). API `POST /api/v1/parents/:parentId/reveal-contact` (`{ studentId, field }`, modül `communication`, yalnız `ogretmen`, `Cache-Control: no-store`, kullanıcı ve kurum başına dakikada 10, aşılırsa 429 `rate_limited`) `audit_log`'a `parent_contact.reveal` yazar (`entityType` `parents`, `entityId` veli, `changes` `{ fields: [alan], studentId }`). React web: öğretmenin sınıf özetindeki "Veli iletişimi" bölümü.
- **Açık:** TODO(F2): veli aydınlatma metnine "velinin iletişim bilgisi, çocuğuna ders veren öğretmene maskeli gösterilir; öğretmen tam değeri kayıt altında açabilir" kullanımı eklenecek. Denetim kaydı ekranı `changes.studentId`'yi henüz göstermez.

## Aydınlatma ve açık rıza

Model ve kurallar core'dadır (`packages/school-core/src/lib/consent-purposes.ts`, `lib/privacy-notices.ts`, `lib/consents.ts`); tablolar `privacy_notices`, `notice_acknowledgements`, `consents` (migration `0024`). Uçlar ve ekranlar henüz yok (OG-016, OG-017). Mühendislik çerçevesi `docs/muhendislik/guvenlik-kvkk.md` §9.

### DOM-YTK-056 · Aydınlatma metni sürümlü ve rol bazlıdır

- **Kural:** Aydınlatma metni veli, öğrenci ve personel (yönetici, ön büro, öğretmen) kitlesine ayrı, sürümlü yayımlanır; yayımlanmış metin değişmez, düzeltme yeni sürümdür. Kullanıcıya kitlesinin son sürümü, görmediyse ilk girişte gösterilir; yeni sürüm yayımlanınca yeniden gösterilir. Gösterim kaydı kullanıcı, metin sürümü, kanal ve zamanı taşır; aynı sürüm ikinci kez kaydedilmez, eski sürüm kaydedilmez. Gösterim rıza değildir.
- **Gerekçe:** Aydınlatma veri toplanırken yapılır ve ispatı veri sorumlusundadır; metin değişince eski gösterim yeni metni ispatlamaz.
- **Kaynak:** KVKK md. 10; Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ. IST-016.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — core `lib/privacy-notices.ts` (`planNoticePublication`, `needsNoticeAcknowledgement`, `planNoticeAcknowledgement`); tablolar `privacy_notices` (yayımlanmış içerik tetikleyiciyle değişmez) ve `notice_acknowledgements` (değişmez satır). Uç ve ekran yok (OG-016/017). Çocuğun algı düzeyine uygun ayrı öğrenci metni kitle içinde tek sürümdür (`TODO(cocuk-aydinlatma)`).

### DOM-YTK-057 · Rızayı kim verir

- **Kural:** Öğrenciye ait amaçlarda (fotoğraf/video, konuşma kaydı) rızayı öğrenci 18 yaşını doldurana kadar yalnız doğrulanmış bağı ve velayeti bulunan veli, 18 yaşını doldurduğu günden itibaren (Europe/Istanbul günü) yalnız öğrencinin kendisi verir. Doğum tarihi bilinmeyen öğrenci 18 yaş altı sayılır. Hesaba ait amaçta (tanıtım iletisi) rızayı yalnız hesap sahibi (veli ya da 18 yaşını doldurmuş öğrenci) verir; 18 yaş altı öğrenciden alınmaz. Personel rıza vermez. Kapsam dışı öğrenci "bulunamadı" alır.
- **Gerekçe:** Reşit olmayanın yasal temsilcisi velayet sahibidir; ergin kişinin rızasını başkası veremez (`DOM-YTK-025`, `DOM-YTK-031`).
- **Kaynak:** TMK md. 11, 335, 342; KVKK md. 3/1-a, 5. Velayeti olmayan ebeveynin rıza veremeyeceği yorumu **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `lib/consents.ts` `requireConsentAuthority`, `canGiveConsent`, `isAdultStudent`. Velayet ve doğrulama bilgisi çağırandan (`GuardianBond`) gelir; üyelik bağlantısı bugün velayet taşımaz (`TODO(velayet-kapsam)`). Ergin kılınma ve kısıtlılık (`DOM-YTK-031`, `DOM-YTK-032`) yok.

### DOM-YTK-058 · Rıza amaca ve metin sürümüne bağlıdır, tek etkin rıza

- **Kural:** Rıza belirli bir amaç kodu için, o amacın gösterilen son rıza metni sürümüne ve kanalına (web, mobil) bağlı yeni satır olarak yazılır; satır veri sahibini, vereni ve ilişkisini (kendisi/veli) taşır, metni taşımaz. Eski sürümlü metinle rıza alınmaz. Aynı veri sahibi + amaç için tek etkin rıza bulunur; yürürlükteki rıza varken ikinci rıza mükerrerdir. Süresi dolmuş ya da yeniden rıza gerektiren sürümden eski rıza, yenisi verilirken aynı işlemde "yenilendi" nedeniyle kapatılır. Fotoğraf/video rızası en geç eğitim yılı sonunda biter (`DOM-ILT-033`); velinin verdiği rıza öğrencinin 18. yaş gününde biter.
- **Gerekçe:** Açık rıza belirli konuya ilişkin olmalı ve ispatlanabilmelidir (`DOM-ILT-034`).
- **Kaynak:** KVKK md. 3/1-a, 5/1. Velinin rızasının erginlikte düşmesi muhafazakâr yorumdur, **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `lib/consents.ts` `planConsent`; `consents` tablosunda kısmi benzersiz indeks `consents_subject_purpose_decision_key` (geri çekilmemiş, arşivlenmemiş satır). Islak imza taramasıyla kayıt yok.

### DOM-YTK-059 · Geri çekme tek işlem ve anında etkili

- **Kural:** Rıza verildiği kadar kolay, tek işlemle geri çekilir: aynı satıra geri çekme anı, geri çeken ve neden yazılır; başka alan değişmez. Geri çekilmiş satır hiçbir anda rıza saymaz. Geri çekmeyi rızayı veren, veri sahibi için şu an rıza verebilecek kişi (diğer velayetli veli; 18 yaşını dolduran öğrenci velinin rızasını) yapar; hesap rızasını ve itirazı yalnız veren. İkinci geri çekme mükerrerdir.
- **Gerekçe:** Rızaya dayalı işleme geri çekmeyle durur; kayıt ispat için silinmez.
- **Kaynak:** KVKK md. 5, 11; guvenlik-kvkk §9.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `lib/consents.ts` `planConsentWithdrawal`; `consents` tetikleyicisi yalnız bir kez geri çekme kolonlarının yazılmasına izin verir. Geri çekmenin ardından rızaya dayalı kayıtların imhası (konuşma kaydı, ADR 0003 karar 9) yok.

### DOM-YTK-060 · Yeni rıza metni sürümü eski rızayı yeni amaca taşımaz

- **Kural:** Rıza metni değişince yeni sürüm yayımlanır. Amacı genişleten sürüm "yeniden rıza gerekir" işaretiyle yayımlanır; bu sürümden eski metne verilmiş rıza geçersizdir ve kullanıcıdan yeniden istenir. Yalnız düzeltme içeren sürüm eski rızayı geçersiz kılmaz.
- **Gerekçe:** Rıza bilgilendirilmiş olmalıdır; kişi görmediği amaca rıza vermiş sayılmaz.
- **Kaynak:** KVKK md. 3/1-a; guvenlik-kvkk §9. Düzeltme sürümünün yeniden rıza istemeyeceği yorumu **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `lib/privacy-notices.ts` `minimumConsentTextVersion`; `hasValidConsent` `minimumTextVersion`.

### DOM-YTK-061 · Rızaya bağlı işlem geçerli rıza ister

- **Kural:** Rızaya bağlı işlem (bülten fotoğrafı IST-068, konuşma kaydı yükleme ADR 0003 karar 9, tanıtım iletisi) yalnız işlem anında geçerli rıza varsa yapılır: aynı veri sahibi ve amaç için geri çekilmemiş, süresi dolmamış, en düşük geçerli metin sürümüne verilmiş rıza ve etkin itiraz yok. Rıza yokken temel eğitim hizmeti engellenmez (konuşma görevi yüz yüze değerlendirilir, `DOM-BEC-050`).
- **Gerekçe:** Geri çekme ve süre dolması anında etkili olmalıdır.
- **Kaynak:** KVKK md. 5; IST-017.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `lib/consents.ts` `hasValidConsent`; dosya yüklemesi henüz bağlı değil (`apps/api/src/services/files.ts` `TODO(F3c2-consents)`, OG-016).

### DOM-YTK-062 · Öğrencinin fotoğraf itirazı

- **Kural:** 18 yaş altı öğrenci fotoğraf/video amaçlarında kendisi için itiraz kaydeder; itiraz etkinken velinin rızası geçersizdir, itiraz geri çekilince rıza yeniden geçerlidir. İtirazı yalnız öğrenci geri çeker; itiraz edilemeyen amaçta ve 18 yaşını doldurmuş öğrencide itiraz kaydı alınmaz.
- **Gerekçe:** Ayırt etme gücüne sahip küçüğün görüntüsü kişiliğine sıkı sıkıya bağlıdır (`DOM-ILT-033`).
- **Kaynak:** TMK md. 16/1; işletme kuralı (`DOM-ILT-033`).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `lib/consents.ts` `planConsent` (`decision: 'objected'`), `hasValidConsent`.

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
