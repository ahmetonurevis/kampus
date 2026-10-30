# İletişim ve veli

Kurum ile veli, öğrenci ve öğretmen arasındaki duyuru, birebir mesaj, bildirim, veli onayı, acil durum, devamsızlık bildirimi, haftalık bülten ve rehberlik gizliliği. Kim kime erişir sorusunun genel çerçevesi [yetki-ve-kapsam.md](yetki-ve-kapsam.md), devamsızlık eşikleri [akademik-olcme.md](akademik-olcme.md), pazarlama iletisi onayı `DOM-KAY-004` içindedir.

Bugünkü kodda duyurular yalnız okunur örnek veridir, mesajlar öğrenci + öğretmen + hedef kitle (`student`/`parent`) üçlüsüyle tutulur, bildirim tercihleri kaydedilir ama hiçbir bildirim gönderilmez, öğrenci başına tek veli (`parentId`) vardır.

## Duyuru

### DOM-ILT-001 · Hedef kitle

- **Kural:** Duyuru hedef kitlesi şu kapsamların birleşimidir: kurum, kampüs, sınıf düzeyi veya CEFR seviyesi, sınıf/grup, rol (veli, öğrenci, öğretmen). Hedef kitle dışındaki kullanıcı duyuruyu göremez; liste sunucuda süzülür. Hedef kitle yayın anında çözülür ve alıcı listesi kaydedilir; sonradan sınıfa katılan öğrenci eski sınıf duyurusunu görmez.
- **Gerekçe:** "Sınıfa özel / genel" ayrımı kampüs ve rol bazlı idari duyurulara yetmez; okundu oranı sabit bir alıcı listesine göre hesaplanır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — core `publishAnnouncement` hedef kitleyi (kampüs, düzey, CEFR seviyesi, sınıf × rol) yayında alıcı listesine çözer, görünürlük core kapsamındadır (`packages/school-core/src/lib/communication.ts`, `lib/communication-access.ts`); API `apps/api/src/routes/communication.ts` `POST /announcements`, okuma `GET /collections/announcements`. Vue demosu eski `classId`/genel kuralıyla çalışır. React web: `apps/web-react/src/pages/communication/` `AnnouncementsPage`, `AnnouncementFormModal`, `AnnouncementPanel`.

### DOM-ILT-002 · Kim duyuru yayınlar

- **Kural:** `yonetici` her kapsamda; `onburo` yalnız idari konularda (kayıt, servis, yemek, ödeme takvimi) kurum veya kampüs kapsamında; `ogretmen` yalnız atandığı sınıf/grupların öğrenci ve velilerine duyuru yayınlar. Öğrenci ve veli duyuru yayınlayamaz.
- **Gerekçe:** Duyuru kurum adına konuşur; kapsamı yayınlayanın yetkisiyle sınırlıdır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — core `authorize('announcement.publish')` (`publishDecision`); API `apps/api/src/routes/communication.ts`.

### DOM-ILT-003 · Okundu bilgisi

- **Kural:** Her alıcı için duyurunun ilk açılış zamanı tutulur. Yayınlayan ve yönetici okundu oranını ve okumayanları görür; diğer alıcılar kimin okuduğunu görmez. "Onay gerektirir" işaretli duyuruda alıcı "Okudum" işlemini yapar; okundu bilgisi bir izin veya onay yerine geçmez (`DOM-ILT-030`).
- **Gerekçe:** Kritik idari duyurunun ulaşıp ulaşmadığı ölçülmeli; okuma kaydı ise rıza değildir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — core `markAnnouncementRead` (veli anahtarı çocuk başına), alıcıya `myReadAt`, yayınlayan ve yöneticiye `readCount`/`recipientCount`; API `apps/api/src/routes/communication.ts` `POST /announcements/:id/read`. Okumayanlar listesi ve hatırlatma yok.

### DOM-ILT-004 · Duyuru düzeltme ve geri çekme

- **Kural:** Yayınlanmış duyuru silinmez. Düzeltme yeni sürüm üretir ve alıcı "Güncellendi" işaretini görür; esaslı değişiklikte (tarih, yer, ücret) alıcılara yeniden bildirim gider. Geri çekilen duyuru alıcılara "Geri çekildi" olarak görünür; içeriği yalnız yayınlayan ve yönetici görür.
- **Gerekçe:** Velinin gördüğü bilgi sonradan iz bırakmadan değişmemelidir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — düzeltme `revisions` geçmişi ve `revisedAt`, geri çekme silmeden `withdrawnAt`; geri çekilen duyuru alıcıya işaretle görünür, metni (`text`) ve gerekçesi yalnız yayınlayan ve yöneticiye döner (`narrowAnnouncement`); API `apps/api/src/routes/communication.ts` `PATCH /announcements/:id`, `POST …/withdraw`. Ön büro yayıncısı rolle değil kişiyle (`publishedBy.userId`) eşlenir: başka ön büro kullanıcısı düzeltemez, geri çekemez, okundu sayısını, geçmişi ve gerekçeyi görmez; yönetici her zaman yetkilidir. Duyuruyu görmeye yetkisi olmayan düzeltme/geri çekmede olmayan kayıtla aynı 404'ü alır, görüp yayınlayan olmayan 403 alır. Geri çekilen metin `GET /collections/announcements?q=` aramasında ve `counts`'ta alıcı için eşleşmez (alıcı başlık, kategori ve "Geri çekildi" görür). Yeniden bildirim yok (`TODO(notifications)`).

## Birebir mesaj

### DOM-ILT-010 · Öğretmen–veli yazışması

- **Kural:** Veli, çocuğunun sınıfına ders veren öğretmenlerle, sınıf rehber öğretmeniyle, rehber öğretmenle ve idareyle (yönetici, ön büro) yazışabilir. Her konuşma bir öğrenciye ve bir veliye bağlıdır; aynı çocuğun iki velisi varsa her velinin konuşması ayrıdır, biri diğerinin yazışmasını görmez. Öğretmen yalnız ders verdiği öğrencinin velisiyle konuşma başlatır.
- **Gerekçe:** Ayrı yaşayan velilerde ortak konuşma kişisel bilgi sızdırır (`DOM-ILT-073`); konuşmanın öğrenciye bağlı olması kardeşler arasında karışıklığı önler.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi (yetişkin kursiyerde veli yoktur, `DOM-YTK-030`)
- **Kodda:** kısmen — core `startConversation` yazışmayı öğrenci + öğretmen + hedef kitle + veli hesabı (`parentUserId`) başına tekil açar, öğretmen yalnız ders verdiği/rehberi olduğu öğrencinin velisiyle başlatır; API `apps/api/src/routes/communication.ts` `POST /conversations`, veli seçimi `GET /students/:id/parent-accounts`. Veli kimliği (`parentUserId`) olmayan eski veli yazışması hiçbir veliye görünmez ve yeni yazışmayla eşleşmez (kapalı başarısız; migration `0007` öğrencinin tek veli hesabı varsa doldurur); öğretmen ve yönetici kuralları değişmez. Veli hesapları `GET /students/:id/parent-accounts` yalnız veli yazışması başlatabilen öğretmene, `startConversation` ile aynı kapsamda (`parentAccountsDecision`) açılır; yönetici ve ön büro 403, kapsam dışı 404. Mesaj kotası (kullanıcı ve kurum başına dakikada 30) başlatmadaki ilk mesajla paylaşılır. Mesajlar yazışmadan ayrı, mesaj başına bir kayıttır (`conversationMessages`, ADR 0005). Yazışma listesi son mesaja göre sıralanır (`lastMessageAt`); okunmamış sayısı, son mesaj ve yanıt bekleme yalnız sayfadaki yazışmalar için SQL'de hesaplanır. Başlatma yalnız aynı öğrencinin yazışmalarını yükler. İdare (yönetici, ön büro) ile veli yazışması yok. React web: `MessagesPage`, `NewConversationPanel` (öğretmen öğrenci/veli seçer; öğrenci ve veli öğretmen seçer).

### DOM-ILT-011 · Öğrenci–öğretmen sınırları

- **Kural:** Öğrenci yalnız kendi sınıfına/grubuna ders veren öğretmenle ve rehber öğretmenle platform içinden yazışır; öğrenci–öğrenci birebir mesaj yoktur. Öğretmen, reşit olmayan öğrenciyle kişisel kanal (kişisel telefon, sosyal medya, anlık mesaj uygulaması) yerine platformu kullanır. Öğrenci–öğretmen yazışması silinemez ve kurumda saklanır; veli bu yazışmayı varsayılan olarak görmez, yönetici yalnız şikâyet veya soruşturma gerekçesini yazarak açar ve açış denetim kaydına düşer.
- **Gerekçe:** Çocukla yetişkin arasında kayıtsız, birebir özel kanal çocuk koruma açısından risklidir; kayıtlı kanal hem öğrenciyi hem öğretmeni korur. Öğrencinin öğretmenine sorduğu soruların veliye açık olması ise öğrencinin soru sormasını engeller.
- **Kaynak:** İşletme kuralı. Velinin reşit olmayanın yazışmalarını görme hakkının sınırı **doğrulanmalı** (TMK md. 339-340 ve çocuğun özel hayatı dengesi).
- **Kurum türü:** ikisi
- **Kodda:** var — öğrenci yalnız ders veren, sınıf rehberi veya rehberlik görevli öğretmenle yazışır; veli öğrenci yazışmasını görmez; yönetici gerekçeyle (≥ 10 karakter) 30 dakikalık erişim açar, erişim `audit_log`'a gerekçesiyle (`reason` kolonu) yazılır (`POST /conversations/:id/access`). Gerekçeli erişim yalnız öğrenci–öğretmen yazışmasındadır; veli tarafı yazışmada 403 `conversation_access_student_only` (veli yazışmasına da gerekçeli erişim istenip istenmediği açık karardır). React web: yönetici `MessagesPage` içinde öğrenci seçer, `AccessGate` gerekçeyi (≥ 10 karakter) ister; veli yazışmasında düğme gösterilmez.

### DOM-ILT-012 · Gönderilen mesaj değişmez

- **Kural:** Gönderilen mesaj düzenlenemez ve silinemez. Gönderen ilk 5 dakika içinde "geri çek" diyebilir; karşı taraf "Mesaj geri çekildi" görür, içerik denetim kaydında kalır. Ek dosya türleri kaynak platformu dosya kurallarına (`DOM-KYN-004`) tabidir.
- **Gerekçe:** Veli–kurum yazışması uyuşmazlıkta delildir.
- **Kaynak:** İşletme kuralı; 5 dakika işletme kuralıdır.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — core `sendMessage` yalnız ekler (`addConversationMessage`, ayrı `conversationMessages` kaydı); API'de düzenleme/silme ucu yoktur (API `apps/api/src/routes/communication.ts`). Gönderim yalnız hedef yazışmayı yükler, var olan mesajları yüklemez; yazışmadaki mesaj sayısının üst sınırı yoktur. `GET /conversations/:id/messages` imleçli sayfayı SQL'de verir (`apps/api/src/db/conversation-messages.ts`). Mesaj koleksiyonu genel koleksiyon okumasına kapalıdır; taraf olmayana 404. 5 dakikalık geri çekme ve ek dosya yok.

### DOM-ILT-013 · Yanıt süresi iş saatiyle ölçülür

- **Kural:** Öğrenci sorusu ve veli mesajı için hedef yanıt süresi kurum ayarıdır (varsayılan 1 iş günü). Süre hesabı kurumun çalışma saatlerine göre yapılır; sessiz saatler (`DOM-ILT-021`), hafta sonu ve resmî tatiller sayılmaz.
- **Gerekçe:** Cuma 22:00'de gelen soru için cumartesi 22:00'de "süre aşıldı" uyarısı öğretmene mesai dışı baskı kurar ve raporu bozar.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — veli talebinde (`DOM-ILT-080`) core `requestResponse` (`packages/school-core/src/lib/requests.ts`) talep anından iş saatiyle bir iş günü hedefini, ilk yanıtı ve gecikmeyi hesaplar, saklamaz; hedef kurum ayarı değil sabit bir iş günüdür (kurum takvimi: hafta günleri ve tatiller). Öğrenci sorusunda core `questionResponse` (`lib/questions.ts`, `DOM-ILT-093`) aynı hedefi hesaplar; yönetici SLA Raporu ve veli mesajında SLA hâlâ duvar saatiyle 24 saattir (`apps/web-react/src/pages/management/sla-rows.ts`, `packages/school-core/src/lib/format.js:51-60`).

### DOM-ILT-014 · Özel nitelikli bilgi mesajla taşınmaz

- **Kural:** Mesaj yazma alanı, sağlık durumu, ilaç, engellilik veya aile içi hassas bilgi paylaşılacaksa veliyi yapılandırılmış kanala (sağlık bilgisi formu, rehberlik randevusu) yönlendiren uyarı gösterir. Mesaj içeriğinde bu tür bilgi bulunsa bile mesaj, yalnız konuşmanın tarafları ve gerekçeli yönetici erişimiyle görünür; bültene, CSV'ye ve aramaya girmez.
- **Gerekçe:** Sağlık verisi özel nitelikli kişisel veridir; işlenmesi yasaktır, istisnalarda Kurul'un belirlediği yeterli önlemler zorunludur.
- **Kaynak:** KVKK md. 6/1, 6/3 ve 6/4 (7499 sayılı Kanunla değişik, kabul 2/3/2024).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — Öğretmenime Sor formunun uyarı metni core `QUESTION_SENSITIVE_NOTICE`'tadır (`lib/questions.ts`, `DOM-ILT-093`); React ekranı W19'da geldi (`AskQuestionPanel.tsx`). Mesaj yazma alanında uyarı yoktur. Soru ve yanıt metni loglanmaz, denetim kaydına yalnız alan adları yazılır.

## Bildirim tercihi ve sessiz saatler

### DOM-ILT-020 · Kanal ve konu tercihi

- **Kural:** Kanallar: uygulama içi (her zaman açık, kapatılamaz), anlık bildirim, e-posta, SMS. Konular: ödev ve sınav, not, devamsızlık, ödeme, duyuru, mesaj, randevu, etkinlik onayı, bülten. Kullanıcı konu başına kanal seçer. Zorunlu bildirimler (acil durum, devamsızlık, onay son tarihi yaklaşan etkinlik izni) kapatılamaz; yalnız ek kanal seçilebilir. Tercih kullanıcıya ve (veli için) çocuğa göre tutulur.
- **Gerekçe:** Veli konu bazında seçebilmeli; ama güvenlik ve devam bilgisi kaçırılamamalıdır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — e-posta/SMS/uygulama ve dört konu tercihi rol + öğrenci anahtarıyla saklanır (`apps/web/src/views/Settings.vue:16-26,193-254`); gerçek gönderim yok (`apps/web/src/views/Settings.vue:212`), zorunlu bildirim ayrımı yok.

### DOM-ILT-021 · Sessiz saatler

- **Kural:** Varsayılan sessiz saat 21:00–08:00 (Europe/Istanbul); kullanıcı değiştirebilir, kurum en geniş aralığı sınırlayabilir. Sessiz saatte anlık bildirim ve SMS ertelenir, sessiz saat bitince tek özet olarak gider; uygulama içi kayıt anında düşer. Acil durum duyurusu (`DOM-ILT-050`) sessiz saati deler. Öğretmenin gönderdiği mesaj alıcının sessiz saatine, velinin gönderdiği mesaj öğretmenin sessiz saatine uyar.
- **Gerekçe:** Gece bildirimi hem veli hem öğretmen için iletişimi aşındırır; acil durum ise beklemez.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-ILT-022 · Hizmet bildirimi ve ticari ileti ayrımı

- **Kural:** Bildirim türü `hizmet` (ödev, devamsızlık, ödeme vadesi, randevu, duyuru) veya `ticari` (yeni kur, kampanya, yaz okulu satışı, indirim) olarak işaretlenir. `ticari` bildirim yalnız kanal bazında ticari ileti onayı varsa gönderilir (`DOM-KAY-004`); onay yoksa uygulama içinde bile kampanya bildirimi oluşmaz.
- **Gerekçe:** Mevcut müşteriye satış iletisi de ticari ileti onayına tabi olabilir.
- **Kaynak:** 6563 sayılı Kanun md. 6 ve Ticari İletişim ve Ticari Elektronik İletiler Hakkında Yönetmelik — **doğrulanmalı** (mevcut müşteri istisnası ve uygulama içi bildirimin kapsamı).
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-ILT-023 · Bildirim gövdesinde kişisel ayrıntı yok

- **Kural:** Anlık bildirim ve SMS gövdesi not, puan, devamsızlık nedeni, sağlık bilgisi, borç tutarı veya rehberlik bilgisi içermez; yalnız konu ve "ayrıntı için uygulamaya girin" yazar (ör. "Deniz için yeni bir devamsızlık kaydı var"). E-posta gövdesi aynı kuralla yazılır, ayrıntı oturum açılmış ekranda gösterilir.
- **Gerekçe:** Kilit ekranı, paylaşılan cihaz ve SMS sağlayıcısı veri sorumlusunun denetimi dışındadır.
- **Kaynak:** KVKK md. 12/1 (veri güvenliği için uygun güvenlik düzeyi); içerik sınırı işletme kuralıdır.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-ILT-024 · Mesajda okundu bilgisi

- **Kural:** Birebir mesajda her mesajın karşı tarafça ilk görülme zamanı tutulur ve gönderene "Okundu" olarak gösterilir. Okundu bilgisi kapatılamaz ama hiçbir işlemin (onay, itiraz, tebliğ) yerine geçmez.
- **Gerekçe:** Öğretmen "mesaj ulaştı mı" sorusunu tekrar mesajla sormamalı; okunmuş mesaj ise rıza veya tebligat değildir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — mesaj okundu bilgisi core `markMessagesRead` (mesaj kaydında `readAt`, karşı tarafın mesajları) ve API `apps/api/src/routes/communication.ts` `POST /conversations/:id/read`; API yalnız o yazışmanın karşı taraf okunmamışlarını yükler. Yöneticinin okuması okundu üretmez.

## Veli onayı ve izinler

### DOM-ILT-030 · Etkinlik izni

- **Kural:** İzin gerektiren etkinlikte izin öğrenci başına istenir ve öğrencinin velayet sahibi velilerinden biri verir. Yanıt yoksa veya ret varsa öğrenci katılamaz; sessizlik onay değildir. Son tarih Europe/Istanbul'a göre o günün 23:59:59'una kadardır ve etkinlik başladıktan sonra karar verilemez. Veli kararını son tarihe kadar değiştirebilir; her değişiklik geçmişiyle tutulur.
- **Gerekçe:** Okul dışı etkinlikte çocuğun sorumluluğu velinin açık iradesine dayanır.
- **Kaynak:** TMK md. 342/1 (ana ve baba üçüncü kişilere karşı çocuğun yasal temsilcisidir) ve md. 342/2 (iyiniyetli üçüncü kişiler eşlerden birinin diğerinin rızasıyla işlem yaptığını varsayabilir); RG 8/12/2001, mevzuat.gov.tr konsolide metin. Okul gezilerine ilişkin MEB düzenlemesi (Sosyal Etkinlikler Yönetmeliği) **doğrulanmalı**.
- **Kurum türü:** ikisi (yetişkin kursiyerde izin kendisinden alınır)
- **Kodda:** var — `packages/school-core/src/lib/school-workflows.js:1048-1076` (yalnız `veli`, kapsamdaki çocuk, iptalde ve süre sonunda karar yok; son gün 09:00Z + 43199999 ms = İstanbul 23:59:59). Öğrenci başına tek `parentId`, karar geçmişi yok (`Object.assign` üzerine yazar).

### DOM-ILT-031 · İki velinin çelişen kararı

- **Kural:** Ortak velayet altında bir veli onay, diğeri ret verirse ret geçerlidir; etkinlik sorumlusu ve yönetici bilgilendirilir. Velayeti olmayan ebeveyn (`DOM-ILT-070`) izin veremez.
- **Gerekçe:** Muhafazakâr yön: çocuğun katılımı için tek velinin onayı yeterli sayılsa da açık ret karşısında katılım kurumu sorumluluğa açar.
- **Kaynak:** TMK md. 336/1 (evlilik devam ettikçe ana ve baba velayeti birlikte kullanır); retin üstün tutulması işletme kuralıdır — **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok — öğrenci başına tek veli.

### DOM-ILT-032 · Etkinlik değişikliği izni düşürür

- **Kural:** İzin gerektiren etkinliğin tarihi, saati, yeri, ulaşım biçimi veya ücreti değişirse alınmış izinler düşer, velilerden yeniden izin istenir. Etkinlik iptal edilince izin vermiş ve bekleyen tüm velilere bildirim gider.
- **Gerekçe:** Veli belirli bir etkinliğe izin verir; değişen etkinlik başka bir etkinliktir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** çelişiyor — iptal yalnız durumu değiştirir, bildirim yok (`packages/school-core/src/lib/school-workflows.js:1077-1083`).

### DOM-ILT-033 · Fotoğraf ve video için açık rıza

- **Kural:** Öğrencinin tanınabilir fotoğraf/videosunun kullanımı amaç ve kanal bazında ayrı açık rızaya bağlıdır: (a) kurum içi platform ve sınıf panosu, (b) kurum web sitesi, (c) sosyal medya, (d) basılı tanıtım ve reklam. Rıza metni aydınlatma metninden ayrıdır; kayıt, hizmet veya etkinliğe katılım rızaya bağlanmaz. Reşit olmayan öğrenci için rızayı velayet sahibi veli verir; öğrenci itiraz ederse velinin rızası olsa bile görüntü yayınlanmaz. Rıza her zaman geri alınabilir; geri alındığında yeni yayın durur ve kurumun denetimindeki kanallardan görüntü kaldırılır. Rıza süresi en fazla bir eğitim yılıdır ve her yıl yenilenir.
- **Gerekçe:** Görüntü kişisel veridir; tanıtım amaçlı kullanım sözleşmenin ifası için zorunlu olmadığından açık rızaya dayanır. Rıza "özgür irade" ile verilmelidir; hizmete bağlanan rıza özgür değildir.
- **Kaynak:** KVKK md. 3/1-a ("belirli bir konuya ilişkin, bilgilendirilmeye dayanan ve özgür iradeyle açıklanan rıza"), md. 5/1-2; TMK md. 342 (yasal temsil) ve md. 16/1 (ayırt etme gücüne sahip küçüğün kişiye sıkı sıkıya bağlı hakları). Rızanın hizmet şartına bağlanamayacağı (Kurul kararı 2018/19) ve aydınlatma ile açık rıza metninin ayrı olması (Kurul ilke kararı 2026/347) ikincil kaynaklardan görüldü — **doğrulanmalı**. Öğrencinin itirazının velinin rızasına üstün tutulması ve bir yıllık süre işletme kuralıdır.
- **Kurum türü:** ikisi (yetişkin kursiyer rızayı kendisi verir)
- **Kodda:** yok.

### DOM-ILT-034 · Rıza kaydı ispat taşır

- **Kural:** Her rıza ve izin kaydı şunları taşır: rızayı veren kişi (kullanıcı kimliği, yakınlık, velayet durumu), öğrenci, rıza metninin sürümü, amaç/kanal, karar, zaman (UTC), kanal (web, mobil, ıslak imza taraması), geri alma zamanı. Kayıt değiştirilmez; yeni karar yeni satır açar.
- **Gerekçe:** Açık rızanın alındığını ispat yükü veri sorumlusundadır.
- **Kaynak:** KVKK md. 5/1, md. 12/1; ispat yükü yorumu **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — `eventConsents` öğrenci, veli, karar, not ve zaman damgası taşır (`packages/school-core/src/lib/school-workflows.js:1062-1074`); metin sürümü ve geçmiş yok.

### DOM-ILT-035 · Sağlık ve özel nitelikli veri

- **Kural:** Öğrencinin alerjisi, kronik hastalığı, düzenli ilacı, engellilik durumu gibi bilgiler yalnız yapılandırılmış "sağlık ve acil bilgi" alanında, açık rıza veya kanuni dayanakla tutulur; serbest not, duyuru, mesaj ve bültende tutulmaz. Erişim ihtiyaç bazlıdır: yönetici, sınıf rehber öğretmeni, ilgili etkinlik/servis sorumlusu ve yalnız acil müdahale bilgisi (ör. "fıstık alerjisi, adrenalin oto-enjektörü çantada"). Her okuma denetim kaydına yazılır (`DOM-YTK-052`). Yemek menüsündeki alerjen bilgisi genel bilgidir, öğrenci verisi değildir.
- **Gerekçe:** Sağlık verisi özel nitelikli veridir; işlenmesi yasaktır, istisnalar sınırlıdır ve Kurul önlemleri zorunludur.
- **Kaynak:** KVKK md. 6/1, 6/3-a, 6/3-c (hayat ve beden bütünlüğü), 6/4. Kurul'un "yeterli önlemler" kararının güncel metni **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok — öğrenci sağlık alanı yok.

## Rehberlik gizliliği

### DOM-ILT-040 · Rehberlik iç notları veli ve öğrenciye görünmez

- **Kural:** Rehberlik dosyası iki katmandır: **paylaşılan destek planı** (hedef, plan, veliye/öğrenciye açık not, takip tarihi) ve **iç notlar** (görüşme notu, gözlem, değerlendirme). İç notları yalnız dosyanın sorumlu rehber öğretmeni/psikolojik danışmanı ve kurumun rehberlik servisi okur ve yazar. Veli, öğrenci, ön büro ve dosyada görevli olmayan öğretmen iç notu hiçbir yerde görmez. Yönetici iç notu varsayılan olarak görmez; yalnız adli veya idari soruşturma gerekçesiyle, gerekçesi yazılarak ve her açılış denetim kaydına düşerek erişir. Branş veya sınıf rehber öğretmeni yalnız paylaşılan planı görür.
- **Gerekçe:** Danışan dosyası özel ve gizli bilgi içerir; bireyin (reşit değilse velisinin) izni olmadan adli ve idari soruşturma dışında paylaşılmaz. Öğrenci iç notun veliye veya sınıf öğretmenine gideceğini bilirse rehberlik görüşmesinin değeri kalmaz.
- **Kaynak:** MEB Rehberlik ve Psikolojik Danışma Hizmetleri Yönetmeliği (RG 14/8/2020-31213) md. 3/1-ç ("Danışan dosyası" tanımı; Resmî Gazete metninden okundu). Diğer görevlilerin rehber öğretmenden gizli bilgi "talep etmez" hükmü ve Rehberlik Etik Yönergesi gizlilik ilkesi ikincil kaynaklardan görüldü; madde numarası ve güncel hâli **doğrulanmalı**. Sağlık içeren notlar için KVKK md. 6.
- **Kurum türü:** `school` (dil okulunda rehberlik modülü yoksa uygulanmaz; 18 yaş altı kursiyere danışmanlık verilirse aynı kural)
- **Kodda:** kısmen — iç not alanları (`internalNote`, `notes`) yalnız öğretmen kaydında `guidanceCounselor` görevi olan aktöre döner; yönetici, ön büro, görevsiz öğretmen, öğrenci ve veli için core kapsamında ayıklanır (`packages/school-core/src/lib/scope.ts`, `HIDDEN_FIELDS`); ön büro rehberlik dosyasını hiç okumaz. Görüşme notunu ve açılış iç notunu yalnız görevli öğretmen yazar (`guidance_counselor_only`). Yöneticinin gerekçeli soruşturma erişimi yok (TODO(IST-020)); API koleksiyon okumaları kapsam fonksiyonunu henüz kullanmıyor.

### DOM-ILT-041 · İç not hiçbir yan kanala çıkmaz

- **Kural:** Rehberlik iç notu API yanıtında, yetkisi olmayan kullanıcıya alan olarak hiç dönmez (istemcide gizlemek yetmez). Bildirim, duyuru, haftalık bülten, PDF, CSV dışa aktarım, genel arama, dashboard, risk listesi ve denetim kaydının eski/yeni değer alanı iç not metnini içermez; denetim kaydında yalnız "rehberlik iç notu eklendi/okundu" ve kayıt kimliği bulunur.
- **Gerekçe:** Gizlilik ihlalleri çoğunlukla ana ekrandan değil yan çıktılardan olur.
- **Kaynak:** `DOM-ILT-040` ile aynı; KVKK md. 12/1.
- **Kurum türü:** `school`
- **Kodda:** kısmen — core denetim kaydı rehberlik kaydının eski/yeni değerinden iç not alanlarını çıkarır, yalnız değişen alan adını `masked_fields` olarak yazar (`packages/school-core/src/lib/school-workflows.ts`, `maskAuditValues`). Bildirim, PDF ve CSV yan kanalları ayrıca denetlenmedi.

### DOM-ILT-042 · Paylaşılan plan bilerek yazılır

- **Kural:** Rehberlik formunda paylaşılan not ve iç not ayrı alanlardır ve görünürlüğü alan etiketinde yazar ("Veli ve öğrenci görür" / "Yalnız rehberlik servisi görür"). İç nottan paylaşılan alana kopyalama ayrı bir işlemdir ve onay ister.
- **Gerekçe:** Yanlış alana yazılan bir cümle geri alınamaz bir ifşadır.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** `school`
- **Kodda:** kısmen — alanlar ayrı (`packages/school-core/src/lib/workflow-presentation.js:775,788`); görünürlük etiketi "Kurum içi not" olarak yazar.

### DOM-ILT-043 · İhmal ve istismar şüphesi platform dışında bildirilir

- **Kural:** İhmal veya istismar şüphesi rehberlik servisi ve yönetimce yasal yollarla, platform dışında bildirilir. Platform yalnız "yasal bildirim yapıldı" işaretini ve tarihini tutar; ayrıntı, ifade veya kanıt platforma yüklenmez. Bu işaret veliye ve öğrenciye görünmez.
- **Gerekçe:** Bu bilgi en hassas veridir; platformda tutulması sızıntı riskini artırır, bildirimi geciktirmemeli.
- **Kaynak:** 5395 sayılı Çocuk Koruma Kanunu md. 6 ve TCK md. 278-279 (bildirim yükümlülüğü) — **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok.

## Acil durum ve devamsızlık

### DOM-ILT-050 · Acil durum duyurusu

- **Kural:** Acil durum duyurusunu (deprem, yangın, tahliye, erken kapanış, güvenlik olayı) yalnız `yonetici` ve yöneticinin önceden yetkilendirdiği nöbetçi personel yayınlar. Duyuru tüm kanallardan gider, sessiz saati ve konu tercihini deler, kısa ve kişisel veri içermez. Okundu takibi zorunludur; 15 dakika içinde okumayan velilere SMS ile tekrar gönderilir. Durum normale dönünce aynı kitleye "olay sona erdi" duyurusu gider.
- **Gerekçe:** Acil durumda tek bir ulaşamayan veli bile risktir; yanlış alarm ise güveni bozar, bu yüzden yayınlayan sınırlıdır.
- **Kaynak:** İşletme kuralı; 15 dakika işletme kuralıdır.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-ILT-051 · Acil iletişim ve teslim yetkisi

- **Kural:** Her öğrenci için en az bir acil durumda aranacak kişi tutulur. Öğrenciyi okuldan teslim alabilecek kişiler ayrı listedir ve veli tarafından yönetilir; listede olmayan kişiye teslim için velinin aynı gün yazılı (platform içi) izni gerekir. Mahkeme kararıyla teslim kısıtı varsa ön büro ve öğretmen ekranında yalnız "teslim kısıtı var, idareye danışın" uyarısı görünür, kararın ayrıntısı görünmez.
- **Gerekçe:** Çocuğun yanlış kişiye teslimi en ağır işletme riskidir; koruma kararı ayrıntısı ise hassas veridir.
- **Kaynak:** İşletme kuralı; KVKK md. 5/2-b, 5/2-e — **doğrulanmalı**.
- **Kurum türü:** `school` (18 yaş altı kursiyerde de uygulanır)
- **Kodda:** yok.

### DOM-ILT-052 · Devamsızlık bildirimi yoklamaya bağlıdır

- **Kural:** Yoklamada "gelmedi" işaretlenen öğrencinin velilerine aynı gün uygulama içi (zorunlu) ve tercih edilen kanaldan bildirim gider; bildirim ilk ders yoklaması kaydedildikten sonra oluşur, gün içinde aynı öğrenci için tek bildirim olarak güncellenir. Yasal eşiklerde (özürsüz gün sayısı) ayrıca eşik bildirimi gider; eşikler mevzuat profilindedir (`DOM-AKD-001`): ortaokulda özürsüz 5/10/15 gün, lisede ardışık 2 gün özürsüz devamsızlık ve 5/15/25. gün tebligatı. Yoklama düzeltilirse veliye düzeltme bildirimi gider.
- **Gerekçe:** Velinin çocuğunun okulda olmadığını aynı gün öğrenmesi güvenlik meselesidir; eşik bildirimleri yasal yükümlülüktür.
- **Kaynak:** OİKY md. 18 (özürsüz 5, 10, 15 gün veliye bildirim); OKY md. 36 (ardışık 2 gün özürsüzde veliye bildirim, 5/15/25. günde tebligat). Eşik ayrıntıları `DOM-AKD`'de.
- **Kurum türü:** ikisi (yetişkin kursiyerde bildirim kursiyerin kendisine gider)
- **Kodda:** yok — yoklama veliye bildirim üretmez.

### DOM-ILT-053 · Veli mazeret bildirimi yoklamaya bağlanır

- **Kural:** Veli, ileri tarihli izin ve geçmiş tarihli mazeret bildirebilir. Geçmiş tarihli mazeret, özür belgesi süresi içinde kabul edilir (ortaokulda devamsızlığın bitiminden itibaren 3 iş günü, lisede 5 iş günü; profil değeri). Bildirim ilgili günlerin yoklama kaydına bağlanır: yoklamada "mazeret bildirildi" görünür; özürlü sayılması belge ve idare onayıyla kesinleşir. Gerekçe kategori olarak alınır (sağlık nedeniyle, ailevi neden, resmi işlem, diğer); sağlık ayrıntısı alınmaz (KVKK m.6, en az veri). Bildirimi yalnız yönetici, sınıf rehber öğretmeni ve devam işlerinden sorumlu personel görür.
- **Gerekçe:** Mazeret bildirimi yoklamadan kopuk kalırsa öğretmen öğrenciyi "gelmedi" işaretler ve veliye yersiz devamsızlık bildirimi gider.
- **Kaynak:** OİKY md. 18 (özür belgesi 3 iş günü); OKY md. 36 (özür belgesi 5 iş günü); KVKK md. 6.
- **Kurum türü:** `school` (dil okulunda kurum kuralı, `DOM-DIL`)
- **Kodda:** kısmen — core `notifyAbsence` (`packages/school-core/src/lib/requests.ts`), API `POST /absences` (`apps/api/src/routes/requests.ts`), react-shared `useNotifyAbsence`. İleri tarihli izin her zaman, geçmiş tarihli mazeret ortaokulda 3, lisede 5 iş günü içinde kabul edilir (dil okulunda 3; `TODO(regulation-profile)`); örtüşen bildirim 409. Gerekçe zorunlu `reasonCategory` (`health`, `family`, `official`, `other`); serbest açıklama ve bilinmeyen alan 400, ayrıntılı not F2'de şifreli ayrı tabloyla gelir (`TODO(kvkk-mazeret-notu)`). Kategorisi olmayan eski kayıtlar (örnek veri, demo snapshot) tür ve açıklamalarıyla okunur. Yoklama bağlantısı saklanmaz, `absenceNotices` ile hesaplanır; yoklama kaydı değişmez ve talep kaydı açılmaz. Okuma kapsamı yönetici, öğrencinin sınıf rehber öğretmeni, veli ve öğrencidir; ön büro ve branş öğretmeni okumaz, ayrı devam görevlisi rolü yoktur. Özür belgesi eki (422 `absence_files_unsupported`) ve idare onayı yok. React web `AbsenceNoticesPage` salt okurdur. Vue demosu ve telefon eski yerel akışla serbest açıklama alır; Vue geçmiş tarihi engeller ve `requests` kaydı da açar (`apps/web/src/views/Communication.vue:312-345`).

## Haftalık veli bülteni

### DOM-ILT-060 · Bülten içeriği gerçek kayıtlardan

- **Kural:** Haftalık bülten her çocuk için ayrı üretilir ve yalnız o çocuğun kapsamındaki gerçek kayıtlardan oluşur: haftanın devamsızlığı, yeni notlar ve geri bildirimler, teslim edilmemiş/geciken ödevler, yaklaşan sınav, etkinlik ve izin son tarihleri, etüt randevuları, ödeme vadesi (yalnız finans modülü açıksa ve veli ödeyiciyse). Kapalı modülün bölümü bültende yer almaz. Kaydı olmayan bölüm "Bu hafta kayıt yok" yazar; uydurma özet, sınıf sıralaması ve başka öğrenciyle karşılaştırma yoktur. Rehberlik iç notu ve sağlık bilgisi bültene girmez.
- **Gerekçe:** Bülten güven aracıdır; veriye dayanmayan cümle ve sıralama hem yanıltır hem kişisel veri sızdırır.
- **Kaynak:** İşletme kuralı; CLAUDE.md "mini grafikler yalnız gerçek kayıtlardan türetilir".
- **Kurum türü:** ikisi (yetişkin kursiyer bülteni kendisine gider)
- **Kodda:** yok.

### DOM-ILT-061 · Bülten zamanı ve anlık görüntü

- **Kural:** Bülten kurumun seçtiği gün ve saatte (varsayılan cuma 17:00 Europe/Istanbul) o anın verisiyle üretilir ve sabitlenir; sonradan düzeltilen not bülteni değiştirmez, düzeltme sonraki bültende "düzeltildi" olarak görünür. Bülten kapatılabilir bir bildirim konusudur. Velayeti olmayan ebeveyn bülteni yalnız erişim kapsamı izin veriyorsa alır (`DOM-ILT-070`).
- **Gerekçe:** Veli ile kurumun aynı belgeye bakabilmesi için gönderilen bülten değişmemelidir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** yok.

## Ayrı veliler ve yasal temsilci

### DOM-ILT-070 · Velayet durumu ve varsayılan erişim

- **Kural:** Öğrenci–veli bağı yakınlık derecesinin yanında velayet durumunu taşır: `ortak velayet`, `velayet sahibi`, `velayeti yok`, `vasi`. Ortak velayet ve velayet sahibi veli tam veli erişimine sahiptir. Velayeti olmayan ebeveyn varsayılan olarak erişimsizdir; velayet sahibi velinin platform içi yazılı onayıyla veya mahkeme kararıyla, onayda belirtilen kapsamda (ör. not ve devamsızlık; finans, rehberlik paylaşılan planı ve mesaj hariç) salt okur erişir. Velayet sahibi onayını geri alabilir. Bağ kurulurken ve değişirken belge (boşanma/velayet kararı, vasilik kararı) istenir.
- **Gerekçe:** Ergin olmayan çocuk velayet altındadır; velayet boşanmada çocuğun bırakıldığı tarafa aittir. Velayeti olmayan ebeveynin kişisel ilişki hakkı okulun ona kendiliğinden bilgi açmasını gerektirmez; MEB e-Okul uygulaması da erişimi velayet sahibine ve onun onayına bağlar.
- **Kaynak:** TMK md. 335/1, 336/2-3, 337/1 (velayet), md. 182 ve 323 (kişisel ilişki); mevzuat.gov.tr konsolide metin. e-Okul uygulaması ve Kamu Denetçiliği Kurumu'nun velayeti olmayan babanın e-Okul erişim başvurusunu reddettiği karar yalnız haber kaynağından görüldü (memurlar.net, 13/7/2026) — **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok — veli kaydı yalnız ad ve çocuk listesi taşır (`packages/school-core/src/data/seed.js:205-212`). React randevu ekranı (W20) velayet durumunu ayırmaz: veli, bağlı olduğu her çocuk için randevu talep eder (`?cocuk=`), kapsamı sunucu `parentId` bağından uygular (`TODO(velayet-kapsam)`).

### DOM-ILT-071 · Velayet değişikliği belgeyle ve kayıtla işlenir

- **Kural:** Velayet durumunu yalnız yönetici veya yetkili ön büro, belgeye dayanarak değiştirir; belge kısıtlı erişimli tutulur (yalnız yönetici). Değişiklikle birlikte etkinlik izinleri, teslim yetkisi, bildirim alıcıları ve bülten alıcıları yeniden hesaplanır; velayeti kaldırılan ebeveynin açık konuşmaları salt okur kapanır. Her değişiklik denetim kaydına yazılır.
- **Gerekçe:** Velayet değiştiği gün bildirim ve izinler eski duruma göre işlemeye devam ederse çocuğun güvenliği risk altına girer.
- **Kaynak:** İşletme kuralı; KVKK md. 12/1.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-ILT-072 · Vasi ve diğer yasal temsilci

- **Kural:** Vasi atanmışsa vasi, vasilik kararıyla `vasi` bağı kurulur ve velayet sahibi veli gibi yetki kullanır. Koruyucu aile veya kurum bakımındaki çocukta yasal temsilci belgeyle tanımlanır; belge yoksa bağ kurulamaz, bilgi yalnız yöneticinin kontrolünde verilir.
- **Gerekçe:** Yasal temsil yetkisi belgeye dayanır; belgesiz kişiye veli yetkisi vermek ifşadır.
- **Kaynak:** TMK md. 337/2 (vasi atanması), md. 404 vd. (vesayet) — **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** yok.

### DOM-ILT-073 · Ayrı veliler arasında bilgi sızmaz

- **Kural:** Bir velinin telefonu, e-postası, adresi ve mesajları diğer veliye gösterilmez; veli listesinde diğer veli yalnız adıyla ve "diğer veli" olarak görünür, koruma kararı varsa hiç görünmez. Ortak aile alanı, ortak konuşma ve ortak bildirim yoktur; her veli kendi hesabıyla çalışır.
- **Gerekçe:** Ayrı yaşayan ebeveynler arasında adres ve iletişim bilgisi sızıntısı fiziksel risk doğurabilir.
- **Kaynak:** İşletme kuralı; KVKK md. 4/2 (ölçülülük), md. 12/1.
- **Kurum türü:** ikisi
- **Kodda:** yok — öğrenci başına tek veli olduğu için ayrım yok; randevuda görüşmeyi yalnız açan veli görür (`DOM-ILT-103`, React ekranı `?randevu=` ile başka velinin görüşmesini açamaz, 404). Yazışma ve randevu dışındaki yüzeylerde ayrım yok.

## Talep ve şikayet

### DOM-ILT-080 · Veli talebi kayıtlı yanıtla kapanır

- **Kural:** Veli bağlı çocuğu için talep, şikayet veya öneri açar; talep `Yeni` durumunda ön büroya düşer. Ön büro ve yönetici durumu (`Yeni`, `İnceleniyor`, `Çözüldü`) ve ilgili birimi (ön büro, akademik koordinatör, finans birimi, şube müdürü) değiştirir, yanıt yazar. Yanıt eklenir, düzenlenmez ve silinmez; veli yanıtları çocuğunun talebinde görür. Ele alınmış talep `Yeni`'ye dönmez; çözülmüş talep yeniden incelemeye alınmadan değişmez. Hedef ilk yanıt süresi `DOM-ILT-013` ile aynıdır ve hesaplanır, saklanmaz. Pasif öğrenci için yeni talep açılmaz (`DOM-YTK-025`).
- **Gerekçe:** Talebin kimde olduğu ve ne yanıt verildiği uyuşmazlıkta kayıttan okunabilmeli; yanıtın sonradan değişmesi bu kaydı bozar.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — core `lib/requests.ts` (`openRequest`, `updateRequest`, `requestResponse`); yetki `request.open`, `request.update`. API `POST /requests` ve `PATCH /requests/:id` (`If-Match` zorunlu; çözülmüş talep 409 `request_resolved`, `Yeni`'ye dönüş 422), react-shared `useOpenRequest`, `useUpdateRequest`; React web talep ekranı henüz salt okurdur. Velayeti olmayan ebeveynin ve ikinci velinin ayrımı yok (`DOM-ILT-073`); talep açıldığında ve yanıtlandığında bildirim gitmez.

## Öğretmenime Sor

Öğrencinin ders öğretmenine yazılı soru sorması (`questions`, modül `learning`). Birebir yazışmadan ayrıdır: soru bir derse (ve varsa kazanıma) bağlıdır, yanıtı ders öğretmeni verir, yönetici yanıt süresini raporlar (IST-120).

### DOM-ILT-090 · Öğrenci yalnız kendi dersinin öğretmenine sorar

- **Kural:** Soruyu yalnız öğrenci kendi adına gönderir; veli, öğretmen, ön büro ve yönetici soru açmaz. Soru öğrencinin kendi sınıfında/grubunda o derse atanmış öğretmene gider; öğretmen ders atamasından çözülür, öğrenci başka sınıfın dersine veya atanmamış öğretmene soru gönderemez. Ders zorunludur; kazanım (dersin konu/kazanım listesinden) isteğe bağlıdır. Başlık 2–120, metin 10–2000 karakterdir. Kaydı pasif öğrenci yeni soru gönderemez; dersin öğretmeni pasifse soru açılmaz. Aynı dersi birden çok öğretmen paylaşıyorsa öğrenci öğretmeni seçer. Dosya eki dosya deposu gelene kadar kabul edilmez.
- **Gerekçe:** Öğrenci–öğretmen sınırı (`DOM-ILT-011`) soru kanalında da geçerlidir; öğrencinin istediği öğretmene ulaşabilmesi kayıtsız birebir kanal açar ve SLA raporunu bozar. Pasif öğrencinin yazma yetkisi yoktur (`DOM-YTK-025`).
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — core `askQuestion` (`packages/school-core/src/lib/questions.ts`), yetki `question.ask` (`lib/authorize.ts`; kapsam dışı ders veya öğretmen tek iletiyle 403 `question_scope_denied`, varlık sızdırılmaz). Gövde katıdır, öğrenci kimliği gövdeden alınmaz. Rehber öğretmene soru kanalı yoktur; rehberlik randevu ve yazışmayla yürür. API `POST /api/v1/questions` (`Idempotency-Key` zorunlu; `apps/api/src/routes/questions.ts`), kanca `useAskQuestion` (`packages/react-shared/src/use-question-commands.ts`); React ekranı W19'da geldi (`apps/web-react/src/pages/learning/AskQuestionPanel.tsx`, `QuestionsPage.tsx`).

### DOM-ILT-091 · Gönderilen soru değişmez; yanıtsız soru geri çekilir

- **Kural:** Gönderilen sorunun başlığı, metni, dersi ve kazanımı değiştirilemez ve soru silinemez. Öğrenci yanıtlanmamış sorusunu geri çekebilir: kayıt ve metin korunur, soru "Geri çekildi" olur, yanıt bekleyenler ve SLA hesabından çıkar. Yanıtlanmış soru geri çekilmez; geri çekilmiş soru yanıtlanmaz.
- **Gerekçe:** Öğrenci–öğretmen yazışması kurumda saklanır (`DOM-ILT-011`, `DOM-ILT-012`); geri çekme öğrencinin yanlış gönderimini kapatır ama kaydı ortadan kaldırmaz.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — core `withdrawQuestion` (`withdrawnAt`, `withdrawnBy`; yanıtlanmış soru 409 `question_answered`, ikinci geri çekme 409 `question_withdrawn`), yetki `question.withdraw` (yalnız kendi sorusu; başkasınınki 404). Durum saklanmaz, `questionStatus` ile türetilir. Geri çekme için süre sınırı yoktur. API `PATCH /api/v1/questions/:questionId` (gövde yalnız `{ "withdrawn": true }`, `If-Match` zorunlu), kanca `useWithdrawQuestion`, React ekranı W19 (`QuestionPanel.tsx`, onaylı geri çekme); yönetici SLA Raporu geri çekilen soruyu saymaz (`apps/web-react/src/pages/management/sla-rows.ts`).

### DOM-ILT-092 · Yanıtı atanmış öğretmen yazar; verilmiş yanıt değişmez

- **Kural:** Soruyu yalnız sorunun atandığı öğretmen yanıtlar; yönetici, ön büro ve başka öğretmen yanıt yazmaz. Ders öğretmeni değiştiğinde veya öğretmen arşivlendiğinde yanıt bekleyen sorular yeni öğretmene taşınır; yanıtlanmış ve geri çekilmiş sorular eski öğretmende kalır. Verilmiş yanıt düzenlenmez ve silinmez; düzeltme ek yanıtla yapılır, ilk yanıtın zamanı değişmez. Ek yanıtı yalnız öğrencinin sınıfında o derse hâlâ atanmış öğretmen yazar: dersten alınan öğretmen yanıtladığı soruyu okumaya devam eder ama ek yanıt yazamaz; derse yeniden atanırsa yazar. Bir soruya en çok 10 yanıt yazılır.
- **Gerekçe:** Yanıt öğrenciye verilmiş kayıtlı bilgidir; sonradan değişmesi uyuşmazlıkta kaydı ve yanıt süresi raporunu bozar. Taşınan soruyu eski öğretmenin yanıtlaması, artık o dersi vermeyen kişiye öğrenci verisi açar.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** var — core `answerQuestion` (ilk yanıt `answer`, `answeredAt`, `answeredBy`; sonrakiler `followUps`), yetki `question.answer` (başka öğretmenin sorusu 404; ders ataması kalkmış öğretmenin ek yanıtı 403 `question_teacher_reassigned`); taşıma `lib/school-management.ts` (`isOpenQuestion`). API `POST /api/v1/questions/:questionId/answers` (`If-Match` zorunlu; aynı sürümle eşzamanlı ikinci yanıt 409 `version_conflict`, `test:pg`), kanca `useAnswerQuestion`, React ekranı W19 (`QuestionAnswerForm.tsx`; yanıt düzenleme yok, ek yanıtla düzeltilir). Vue demosu yanıtı yerinde düzenletiyordu ("Yanıtı düzenle").

### DOM-ILT-093 · Soru görünürlüğü ve yanıt süresi

- **Kural:** Öğrenci kendi sorularını, veli bağlı çocuğunun sorularını salt okur; öğretmen kendisine atanan soruları, yönetici kurumun bütün sorularını görür; ön büro soru görmez. Yanıt süresi saklanmaz; soru anı ile ilk yanıttan hesaplanır ve hedefi `DOM-ILT-013`'tür. Soru formu, özel nitelikli bilgi için `DOM-ILT-014` uyarısını gösterir.
- **Gerekçe:** Veli çocuğunun akademik desteğini izler; yanıt süresi raporu kayıtlardan türetildiği için saklanan bir değer kayıtla çelişebilir.
- **Kaynak:** İşletme kuralı. Velinin öğrenci sorularını görmesi `DOM-ILT-011` gerekçesiyle (öğrencinin soru sormaktan çekinmesi) çelişebilir; mevcut okuma kapsamı korunmuştur, **doğrulanmalı**.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — okuma `lib/scope.ts` (`questions`: yönetici tümü, öğretmen `teacherId`, öğrenci ve veli `studentId`); core `questionResponse` iş saatiyle hedefi hesaplar, geri çekilen soruyu gecikmiş saymaz; uyarı metni `QUESTION_SENSITIVE_NOTICE`. Yönetici SLA Raporu hâlâ duvar saatiyle 24 saat kullanır (`apps/web-react/src/pages/management/sla-rows.ts`, `TODO(api-sla-aggregate)`). `TODO(soru-veli-gorunurlugu)`.

## Randevu

Öğretmenle yüz yüze görüşme veya bireysel etüt randevusu (`appointments`, modül `communication`). Öğretmenin paylaştığı uygunluk saatleri (`availability`) etüt modülünde yazılır; randevu bu saatlerden birine bağlanır.

### DOM-ILT-100 · Randevu talebini kim açar

- **Kural:** Veli bağlı çocuğu için, öğrenci kendisi için randevu talep eder; talep yalnız öğrencinin sınıfına ders atanmış etkin öğretmenle açılır. Görüşme türü veli için `Veli görüşmesi` veya `Akademik danışmanlık`, öğrenci için `Bireysel etüt` veya `Akademik danışmanlık`tır. Kaydı pasif öğrenci için talep açılmaz (`DOM-YTK-025`). Yönetici, ön büro ve öğretmen talep açmaz. Talep `Bekliyor` durumunda açılır ve açan kişi (`requestedBy`) saklanır.
- **Gerekçe:** Randevu öğretmenin zamanını ayırır; görüşme yalnız öğrenciyle ders ilişkisi olan öğretmenle anlamlıdır. Talebi kimin açtığı, geri çekme yetkisini ve ayrı veliler arasındaki görünürlüğü belirler.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — core `lib/appointments.ts` `bookAppointment`, yetki `appointment.book`; API `POST /appointments` (`apps/api/src/routes/appointments.ts`, `Idempotency-Key` zorunlu), react-shared `useBookAppointment`. React web ekranı W20'de: öğrenci `randevu-talep`, veli Randevular sekmesi (çocuk `?cocuk=`) ve sağ panelde talep formu `?randevu-form=yeni` (`apps/web-react/src/pages/communication/BookAppointmentPanel.tsx`; web yalnız seçeneği sınırlar, karar sunucudadır; e2e `tests/e2e-react/randevular.spec.ts`). Rehber öğretmenle (`guidanceCounselor`) ders ataması olmadan randevu açılmaz (`TODO(randevu-rehberlik)`). Vue demosu türü rol sınırı olmadan seçtirir ve pasif öğrenciyi denetlemez (`apps/web/src/views/Communication.vue:182-212`).

### DOM-ILT-101 · Randevu saati uygunluk saatine bağlıdır ve çakışmaz

- **Kural:** Talep öğretmenin bir uygunluk saati seçilerek açılır; randevunun başlangıcı ve süresi o saatten alınır. Saat gelecekte olmalıdır. Öğretmenin veya öğrencinin o aralıkta iptal edilmemiş dersi, başka etüdü, `Bekliyor` ya da `Onaylandı` durumunda başka randevusu veya öğrencinin kampüsünde okul etkinliği varsa talep reddedilir. Aynı saati iki talep aynı anda isterse yalnız biri yazılır. Çakışan randevuyu talep eden (veya onaylayan öğretmen) göremiyorsa ret iletisi genel kalır ("Bu saat uygun değil."); görebildiği randevuda neyin çakıştığı söylenir (`DOM-ILT-073`, `DOM-ILT-103`). Bekleyen veya onaylı randevusu olan uygunluk saati kaldırılamaz; önce talep reddedilir ya da geri çekilir veya randevu iptal edilir.
- **Gerekçe:** Öğretmen yalnız ayırdığı zamanda görüşür; çakışan iki görüşme veya derse denk gelen randevu yerine getirilemez.
- **Kaynak:** İşletme kuralı; CLAUDE.md "Etütler öğretmen uygunluk saatlerini kullanır".
- **Kurum türü:** ikisi
- **Kodda:** kısmen — core `bookAppointment` (`lib/tutor-conflicts.ts` `tutorConflict` ile tam denetim; görünmeyen randevu `canSeeAppointment` ile `HIDDEN_CONFLICT_MESSAGE` döner, talepte ve onayda); saat kaldırma `lib/assessment-automation.ts` `slot-remove` (409 `availability_has_appointments`; saati bilinmeyen eski randevu aynı öğretmenin aralığındaysa sayılır); `tutoring` modülü kapalı, `communication` açıkken uygunluk saati eklenemez ve kaldırılamaz ama var olan saatlerden talep açılır: ürün kararı bekliyor (`TODO(randevu-modul)`); API talepte yalnız seçilen uygunluk saatini yükler, kurum kilidi eşzamanlı iki talepten yalnız birini yazar (`apps/api/test/pg-concurrency.test.ts`). Vue demosu talepte ders ve etkinlik çakışmasını denetlemez (`apps/web/src/views/Communication.vue:122-137`).

### DOM-ILT-102 · Onay, red, iptal ve geri çekme

- **Kural:** `Bekliyor` talebi yalnız ilgili öğretmen onaylar (`Onaylandı`) veya gerekçe yazarak reddeder (`Reddedildi`); onay anında saat hâlâ gelecekte olmalı ve çakışma yeniden denetlenir. Talep eden kişi onaydan önce talebini geri çeker (`Geri çekildi`). Onaylanmış randevuyu başlangıcından önce öğretmen veya talep eden kişi gerekçe yazarak iptal eder (`İptal`). `Reddedildi`, `Geri çekildi` ve `İptal` son durumdur; kayıt değişmez ve silinmez. Her durum değişikliği yapan kişi, an ve gerekçesiyle kaydın geçmişine eklenir.
- **Gerekçe:** Görüşmenin neden yapılmadığı uyuşmazlıkta kayıttan okunabilmeli; karar öğretmenin zamanına dair olduğu için yalnız o öğretmene aittir.
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — core `lib/appointments.ts` `updateAppointment`, yetki `appointment.update`; API `PATCH /appointments/:id` (`If-Match` zorunlu), react-shared `useUpdateAppointment` (sürüm bilinmiyorsa istek atmaz). Yöneticinin randevuyu iptal etmesi yok (`TODO(randevu-yonetici-iptal)`). Açanı bilinmeyen eski talep (`requestedBy` yok) geri çekilemez ve talep eden adına iptal edilemez (`TODO(randevu-eski-kayit)`; React ekranı bu kayıtlarda düğme göstermez). React web ekranı W20'de (`AppointmentActions.tsx`): öğretmen onaylar, gerekçeyle reddeder veya iptal eder, talep eden geri çeker veya gerekçeyle iptal eder; sürüm çakışmasında (409) yazılan gerekçe korunur ve randevu yeniden okunur. Vue demosu red gerekçesi istemez, iptal ve geri çekme yoktur.

### DOM-ILT-103 · Veli görüşmesini yalnız açan veli görür

- **Kural:** Öğretmen kendi randevularını, yönetici kurumun bütün randevularını görür; ön büro görmez (`DOM-YTK-021`). Öğrenci kendisinin ve kendisi için açılmış veli dışı randevuları görür; velinin açtığı görüşmeyi görmez. Veli çocuğunun öğrenci tarafından açılmış randevularını ve yalnız kendi açtığı veli görüşmelerini görür; başka velinin görüşmesi ona görünmez. Açanı bilinmeyen eski `Veli görüşmesi` kaydı öğrenci ve veliye görünmez. Kapsam dışı randevu üzerinde işlem, olmayan kayıtla aynı yanıtı alır.
- **Gerekçe:** Ayrı yaşayan ebeveynlerin görüşme talepleri ve notları birbirine sızmamalıdır (`DOM-ILT-073`); veli ile öğretmen arasındaki görüşme öğrenciyle paylaşılmak zorunda değildir.
- **Kaynak:** İşletme kuralı; KVKK md. 4/2 (ölçülülük).
- **Kurum türü:** ikisi
- **Kodda:** kısmen — core `lib/scope.ts` `appointments` okuma kuralı ve `requireVisibleAppointment`; API okuması `GET /collections/appointments`, `PATCH /appointments/:id` sürümü kapsam ve yetkiden sonra karşılaştırır (kapsam dışı randevu yanlış sürümde de 404, görünür ama yetkisiz geçiş 403). Velayeti olmayan ebeveynin kapsamı (`DOM-ILT-070…073`) yok; talepler akışıyla birlikte ele alınacak (`TODO(velayet-kapsam)`). React ekranı veliye seçili çocuğun öğrenci tarafından açılmış randevularını ve yalnız kendi açtığı görüşmeleri gösterir; başka velinin görüşmesi listede ve `?randevu=` adresinde yoktur (404, "Kayıt bulunamadı"). Vue ve telefon demosu öğrencinin bütün randevularını gösterir.

### DOM-ILT-104 · Kapanan randevu takvimi bırakır

- **Kural:** Yalnız `Bekliyor` ve `Onaylandı` randevular öğretmenin ve öğrencinin zamanını tutar; reddedilen, geri çekilen ve iptal edilen randevu çakışma denetimine girmez ve aynı saat yeniden talep edilebilir. Günlük programlarda yalnız onaylanmış randevu görünür; iptal edilen randevu görünmez.
- **Gerekçe:** Gerçekleşmeyecek görüşme takvimi işgal etmemeli; programda görünen her randevu yapılacak bir görüşmedir.
- **Kaynak:** İşletme kuralı; CLAUDE.md "İptal dersleri günlük programlarda görünmez".
- **Kurum türü:** ikisi
- **Kodda:** kısmen — core `appointmentHoldsTime`, `scheduledAppointments` (`lib/appointment-status.ts`); `tutorConflict` ve sınıf/öğretmen/program çakışmaları bunu kullanır. React W20 ekranı "Yaklaşan randevular" bölümünde yalnız `scheduledAppointments` kullanır; bekleyen talep, red, geri çekme ve iptal programda görünmez (`TODO(randevu-w20)` kapandı). Vue ve telefon demosu yalnız `Reddedildi` durumunu dışlar.

### DOM-ILT-105 · Veli ve öğrenci yalnız alınabilir saatleri görür

- **Kural:** Öğrenci kendisi, veli her bağlı çocuğu için ayrı ayrı, öğrencinin sınıfına ders veren etkin öğretmenlerin gelecekteki uygunluk saatlerini görür; başka öğretmenin, pasif ya da arşivli öğretmenin ve geçmiş saat listede yoktur. Liste bir tarih aralığı içindir: verilmezse bugünden itibaren 14 gün, en çok 28 gün. Her saat için yalnız saat, öğretmen ve adı, başlangıç, süre, varsa kampüs ve öğretmenin o sınıfta verdiği dersler ile saatin alınıp alınamayacağı görünür; öğretmenin iç notu, saati tutan randevu ve onu açan kişi görünmez. Bekleyen ya da onaylı bir randevunun tuttuğu saat ile öğrencinin o aralıktaki dersi, etüdü, randevusu veya okul etkinliğiyle çakışan saat "Dolu" görünür; karar talebin çakışma denetimiyle aynıdır (`DOM-ILT-101`) ve nedeni hiçbir durumda söylenmez. Başka velinin çocuğu ve kurumda olmayan öğrenci için liste olmayan kayıtla aynı yanıtı alır; pasif öğrenci için talepteki gibi reddedilir (`DOM-YTK-025`). Yönetici, ön büro ve öğretmen bu listeyi kullanmaz.
- **Gerekçe:** Talep bir uygunluk saati seçilerek açılır (`DOM-ILT-101`); veli ve öğrenci seçemeyeceği saati görmemeli, dolu saatin nedeni ise başka velinin gizli görüşmesini veya başka öğrencinin randevusunu ele verebilir (`DOM-ILT-073`, `DOM-ILT-103`).
- **Kaynak:** İşletme kuralı.
- **Kurum türü:** ikisi
- **Kodda:** kısmen — core `lib/appointments.ts` `bookableSlots` (talep ile aynı `checkSlot` denetimi), `bookableSlotsQuerySchema`; yetki `appointment.slots` (öğrenci, veli; kapsam dışı öğrenci core'da `student_not_found`, API'de olmayan kayıtla aynı 404 `not_found`). API `GET /api/v1/appointments/slots?studentId=…&from=…&to=…` (`apps/api/src/routes/appointments.ts`, salt okunur, alan beyaz listesi `BookableSlot`), react-shared `useBookableSlots` (`packages/react-shared/src/use-bookable-slots.ts`; randevu yazıldıktan sonra geçersiz kılınır). Kapalı `communication` modülünde uç, diğer modül kapıları gibi 403 `module_disabled` verir. React ekranı W20'de: `SlotPicker` saatleri öğretmen ve güne göre gruplar, `available: false` saati "Dolu" yazar ve seçtirmez, nedeni göstermez; liste her açılışta tazelenir (`staleTime` 0). Uygunluk saati eklemek `tutoring` modülüne bağlıdır (`TODO(randevu-modul)`).

## Mevcut kodla farklar

| Kural                | Fark                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOM-ILT-001…012, 024 | Kural core ve API'dedir (`lib/communication.ts`, `routes/communication.ts`); Vue demosu eski davranıştadır: duyuru yalnız sınıf/genel, iki veli aynı konuşmayı paylaşır, öğretmen konuşma başlatamaz (`apps/web/src/views/Communication.vue:85-91,147`). React web ve mobil ekranlar API'ye geçmedi. İdare–veli yazışması, mesaj geri çekme ve bildirim yok.                  |
| DOM-ILT-013          | Veli talebinde (`lib/requests.ts` `requestResponse`) ve öğrenci sorusunda (`lib/questions.ts` `questionResponse`) hedef iş saatiyle hesaplanıyor; yönetici SLA Raporu ve mesajda yanıt süresi duvar saatiyle 24 saat, sessiz saat, hafta sonu, tatil sayılıyor (`apps/web-react/src/pages/management/sla-rows.ts`, `packages/school-core/src/lib/format.js:51-60`).           |
| DOM-ILT-020, 021     | Tercih kaydediliyor ama gönderim, zorunlu bildirim ve sessiz saat yok (`apps/web/src/views/Settings.vue:16-26,212`).                                                                                                                                                                                                                                                          |
| DOM-ILT-030, 034     | Veli kararı üzerine yazılıyor, geçmiş ve metin sürümü yok (`packages/school-core/src/lib/school-workflows.js:1062-1065`).                                                                                                                                                                                                                                                     |
| DOM-ILT-032          | Etkinlik iptalinde veliye bildirim yok (`packages/school-core/src/lib/school-workflows.js:1077-1083`).                                                                                                                                                                                                                                                                        |
| DOM-ILT-040          | İç not core kapsamında yalnız rehberlik görevli öğretmene dönüyor; yöneticinin gerekçeli erişimi ve API'nin kapsam fonksiyonunu kullanması yok (`packages/school-core/src/lib/scope.ts`).                                                                                                                                                                                     |
| DOM-ILT-041          | Core denetim kaydı iç notu maskeliyor; bildirim, PDF ve CSV yan kanalları ayrıca denetlenmedi.                                                                                                                                                                                                                                                                                |
| DOM-ILT-053          | Core ve API'de bildirim süre içinde geçmiş tarihi kabul ediyor, yoklama bağlantısı hesaplanıyor, gerekçe yalnız kategori; özür belgesi ve idare onayı yok. Vue demosunda geçmiş tarih engelli, serbest açıklama alınıyor ve talep kaydı açılıyor (`apps/web/src/views/Communication.vue:312-345`).                                                                            |
| DOM-ILT-070, 073     | Velayet durumu ve çoklu veli yok; öğrenci başına tek `parentId` (`packages/school-core/src/data/seed.js:197,205-212`).                                                                                                                                                                                                                                                        |
| DOM-ILT-090…093      | Kural core'dadır (`lib/questions.ts`), API uçları ve react-shared kancaları hazırdır; Vue demosu yanıtı yerinde düzenletiyor, geri çekme yok, öğretmeni pasif ders dışında sınır denetimi yok, dosya adını saklıyor (`apps/web/src/views/Learning.vue:318-360`). React ekranları W19'da geldi (`apps/web-react/src/pages/learning/`). Velinin soru görünürlüğü açık karardır. |
| DOM-ILT-100…104      | Kural core'dadır; Vue ve telefon demosu türü rol sınırı olmadan seçtirir, talepte ders ve etkinlik çakışmasını ve pasif öğrenciyi denetlemez, red gerekçesi istemez, iptal ve geri çekme yoktur, yalnız `Reddedildi` durumunu takvimden düşer (`apps/web/src/views/Communication.vue:122-241`, `apps/mobile/src/model/operations.ts:679-790`).                                |
