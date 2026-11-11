# ADR 0003 · Dosya ve medya depolama

- Durum: Kabul edildi (2026-10-30, Oğuzhan Demirci); "Açık sorular" bölümünde önerilen seçenekler kabul edildi
- Onaylayan: Oğuzhan Demirci
- Ayrıntılandırdığı: ADR 0001 karar 8, ADR 0002 karar 3 (nesne depolama)

## Bağlam

Faz 1 (ister listesi §6) ilk kez gerçek dosya ister: ödev teslimleri (IST-047, IST-126), materyal ve içerik havuzu (IST-030), soru görselleri (IST-033), dinleme ses dosyaları (IST-045), konuşma ses kayıtları (IST-051, IST-052) ve kurumun sakladığı PDF belgeler. Bugün Vue demosu yalnız dosya adı ve boyutunu tutar, türü uzantıdan anlar (DOM-KYN-004 "çelişiyor").

Bağlayıcı kurallar:

- Dosya kayıt kapsamından geçer; başka kurumun veya öğrencinin dosyası açılmaz, bağlantı süresi dolunca erişilmez (IST-027, guvenlik-kvkk §6).
- Tür içerikten doğrulanır; çalıştırılabilir, makrolu, parola korumalı dosya kabul edilmez (DOM-KYN-004, guvenlik-kvkk §14).
- Konuşma kaydı kişisel veridir: 18 yaş altında veli onayı, yalnız ilgili kişiler dinler, her dinleme günlüğe yazılır, ses kurum dışındaki bir hizmete gönderilmez, biyometrik işleme yok, `m4a`/`webm`/`mp3`, en çok 20 MB ve 10 dk (DOM-BEC-050…054).
- Veri ve yedek Türkiye'de, depoda şifreli (IST-024); dış SaaS bağımlılığı eklenmez (ADR 0001); genel sorun hazır paketle çözülür (ADR 0002).
- `records.data`'ya dosya gömülmez; kayıt yalnız anahtar ve meta veri taşır (veritabani §3).

## Kararlar

1. **Depolama arayüzü ve iki sürücü.** `apps/api/src/storage/` altında tek arayüz: `put(stream)`, `head`, `delete`, `signedGetUrl`. Sürücüler:
   - `s3`: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; geliştirmede ve üretimde kullanılır. Kurum başına ayrı kova açılmaz; tek kova, kurum öneki (karar 4).
   - `disk`: `STORAGE_DIR` altında; yalnız birim/API testleri ve S3 sunucusu kurmak istemeyen yerel geliştirme için. İmzalı bağlantıyı API'nin kendi ucu (HMAC, süreli) üretir Üretimde seçilirse `config.ts` başlangıçta açık bir hatayla durur.

   `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `STORAGE_PUBLIC_URL` `config.ts`'te doğrulanır. `compose.yaml`'a isteğe bağlı `storage` profiliyle S3 uyumlu yerel sunucu eklenir (yazılım seçimi Açık soru 1). Üretim sağlayıcısı Türkiye'de barındıran S3 uyumlu hizmet veya kendi sunucumuzdaki S3 uyumlu yazılımdır; seçim dağıtım ADR'sindedir.

2. **Yükleme API üzerinden, akışla.** `POST /api/v1/files` `@fastify/multipart` ile tek dosya alır; dosya geçici diske yazılmadan akış hâlinde depoya gider, aynı anda SHA-256 ve boyut hesaplanır. Sınır aşılınca akış kesilir, nesne silinir, 413 `file_too_large`. Tarayıcıdan depoya imzalı URL ile doğrudan yükleme Faz 1'de yoktur (Alternatifler). Gövdede `purpose` (karar 3) zorunludur; kurum kimliği gövdede yoktur, oturumdan gelir. `Idempotency-Key` desteklenir (mobil yeniden deneme, karar 11).

3. **Amaç bazlı tür ve boyut sınırları.** Sınırlar school-core'da tek tabloda (`FILE_PURPOSES`) tutulur; web ve mobil yüklemeden önce aynı tabloyla uyarır, sunucu yeniden denetler.

   | `purpose`            | İzinli içerik (içerikten tespit)                | Azami boyut                 | Ek kural                                              |
   | -------------------- | ----------------------------------------------- | --------------------------- | ----------------------------------------------------- |
   | `submission`         | PDF, JPEG, PNG, WebP, DOCX                      | 20 MB, teslimde 10          | Mobil fotoğraf yüklemeden önce JPEG'e çevrilir (HEIC) |
   | `material`           | PDF, DOCX, PPTX, XLSX, JPEG, PNG, MP3, M4A, MP4 | 50 MB; video 200 MB         | Video Faz 1'de tek dosya, uyarlanabilir akış yok      |
   | `question_image`     | JPEG, PNG, WebP                                 | 2 MB                        | SVG yok (betik taşır)                                 |
   | `listening_audio`    | MP3, M4A, WAV, WebM                             | 50 MB, 15 dk                | Döküm olmadan görev yayımlanmaz (DOM-BEC-005)         |
   | `speaking_recording` | M4A, WebM, MP3                                  | 20 MB, görev süresi ≤ 10 dk | Veli onayı ön koşul (karar 9)                         |
   | `document`           | PDF                                             | 20 MB                       | İmzalı sözleşme taraması gibi kurum belgesi           |
   - Tespit `file-type` paketiyle sihirli baytlardan yapılır; uzantı ve istemcinin bildirdiği `Content-Type` yalnız tutarlılık denetimidir, çelişirse 422 `file_type_mismatch`. Office dosyalarında yalnız makrosuz OOXML; parola korumalı PDF ve Office reddedilir.
   - Süre `ffprobe` ile sunucuda ölçülür; istemcinin bildirdiği süreye güvenilmez.
   - Kurum kotası kurum ayarıdır (`institution_settings.storage_quota_bytes`, varsayılan Açık soru 6); `files` tablosundan toplanır, aşınca 422 `storage_quota_exceeded`.
   - Platformun ürettiği PDF'ler (dekont, sözleşme, ödev/değerlendirme çıktısı) saklanmaz; her açılışta kayıttan yeniden üretilir. Yalnız dışarıdan gelen belge `document` olarak saklanır.

4. **`files` tablosu ve anahtar biçimi.** Dosya meta verisi `records`'ta değil ilişkisel `files` tablosundadır (veritabani §4 ölçüt 2 ve 5: benzersiz anahtar, ayrı saklama/erişim kuralı). Zorunlu kolonlara ek: `id uuid`, `purpose`, `status` (`pending`, `processing`, `ready`, `rejected`, `deleted`), `storage_key`, `content_type`, `byte_size`, `sha256`, `duration_ms`, `original_name` (temizlenmiş; `// kvkk: K`), `uploaded_by_user_id`, `data_subject_id` (veri sahibi öğrenci/kursiyer; imha ve başvuru için), `attached_type` + `attached_id` (bağlı kayıt), `retention_until`, `deleted_at`. Anahtar sunucuda üretilir ve kişisel veri taşımaz: `<institution_id>/<purpose>/<yyyy>/<mm>/<uuid>`. Özgün ad yalnız indirmede `Content-Disposition` için kullanılır.

5. **İki aşamalı bağlama.** Yüklenen dosya `pending` başlar, denetimden (karar 7, 8) sonra `ready` olur. Dosya ancak bir iş işlemiyle (teslim, kaynak sürümü, soru) kayda bağlanır; işlem aynı transaction'da `attached_type`/`attached_id`'yi yazar, bağlanacak dosyanın aynı kurumda, `ready`, aynı yükleyiciye ait ve başka kayda bağlı olmadığını denetler. 24 saat içinde bağlanmayan dosya `pg-boss` temizlik işiyle silinir.

6. **Erişim her zaman kayıt kapsamından geçer.** Dosyanın kendi izin tablosu yoktur; `GET /api/v1/files/:fileId/url` dosyanın bağlı olduğu kaydı yükler ve o kaydın okuma kuralını (school-core kapsam fonksiyonu; konuşmada DOM-BEC-053 listesi) uygular. Kapsam dışı veya başka kurum 404'tür. Yanıt kısa ömürlü imzalı GET bağlantısıdır: varsayılan 5 dk, `speaking_recording` 2 dk; `response-content-disposition` (belgede `attachment`, ses/görüntüde `inline`) ve `response-content-type` imzaya dahildir. Depo kovası herkese kapalıdır; liste izni verilmez.
   - `speaking_recording` ve `submission` bağlantısı her üretimde `audit_log`'a `file.access` olarak yazılır (DOM-BEC-053, DOM-YTK-052).
   - Dinleme hakkı (IST-045) bağlantı üretiminde sayılır ve hak bitince bağlantı verilmez. İndirilen dosyanın tarayıcı önbelleğinden tekrar çalınması teknik olarak engellenemez; değerlendirme türündeki dinlemede ses yalnız oynatıcıdan ve `Cache-Control: no-store` ile sunulur.
   - Web CSP'ye (guvenlik-kvkk §5) `STORAGE_PUBLIC_URL` kökeni yalnız `img-src`, `media-src` ve `frame-src` (PDF önizleme) için eklenir.

7. **Görsellerde meta veri temizliği.** JPEG/PNG/WebP `sharp` ile yeniden kodlanır; EXIF/GPS ve gömülü küçük resim silinir, renk profili korunur. Özgün dosya saklanmaz.

8. **Virüs taraması.** Kurum içi yüklemenin çok öğrenciye dağıtılması en kısa saldırı yoludur (DOM-KYN-004). PDF, Office, görsel ve video dosyaları `pg-boss` `file.scan` işinde ClamAV (`clamd`, ayrı konteyner, imza güncellemesi `freshclam`) ile taranır; `AlertOLE2Macros`, `AlertEncrypted` ve PDF sezgileri açıktır. Tarama bitene kadar dosya `processing`'tir, kimseye bağlantı verilmez; zararlı bulunursa `rejected`, nesne silinir, yükleyiciye Türkçe hata. Uygulamada kaydedilip yeniden kodlanan ses kayıtları taramadan muaf değildir, ama sonuç beklenmeden kodlamaya geçer. Bağlantı küçük bir `clamd` INSTREAM istemcisiyle (`node:net`) yapılır (Sabah kararı 41; aşağıdaki uygulama notu); testte sahte tarayıcı kullanılır. Tarayıcı erişilemezse dosya `processing`'te kalır ve iş yeniden denenir; taramasız `ready` olmaz.

9. **Konuşma kaydına özel kurallar.**
   - Yükleme ucu, 18 yaş altı öğrenci için `consents` tablosunda geçerli `speaking_recording` rızası yoksa 403 `consent_required` döner; istemci kayıt düğmesini baştan göstermez ve görev yüz yüze değerlendirmeye düşer (DOM-BEC-050). Rıza geri alınınca rızaya dayalı kayıtlar imha kuyruğuna girer.
   - Ses yalnız kendi altyapımızda işlenir: dökümleme, otomatik puanlama veya dış servis yok (DOM-BEC-023, DOM-BEC-051).

10. **Ses dönüştürme.** `pg-boss` `media.transcode` işi `ffmpeg` ile (sistem ikilisi, ayrı süreç) `speaking_recording` ve `listening_audio` dosyalarını tek biçime çevirir: AAC-LC, M4A, mono, 48 kHz, ~64 kbps (dinleme ~96 kbps). Gerekçe: tarayıcı kayıtları WebM/Opus gelir ve her cihazda oynamaz; tek biçim boyutu da küçültür. Süre ve boşluk (`silencedetect`) burada yeniden denetlenir; boş kayıt `rejected`. Dönüşüm başarıyla doğrulanınca özgün dosya silinir (en az veri). Dönüşüm sürerken öğretmen listesinde "İşleniyor" görünür; teslim zamanı yükleme zamanıdır, dönüşüm zamanı değil.

- Uygulama notu (OG-262): iş `apps/api/src/jobs/media-transcode.ts`, işleyici `services/media-transcode.ts`, `ffmpeg`/`ffprobe` çağrısı `services/audio-transcoder.ts` (`execFile`, argüman dizisi, kabuksuz; giriş biçimi içerikten tespit edilen türe sabitlenir, yalnız `file` protokolü; süreç başına 120 sn sınırı, `JobDeps.signal` süreci öldürür; ikili yolu `FFMPEG_PATH`, `FFPROBE_PATH`). Ses yüklemesi `processing` başlar ve iş satırı yüklemeyle aynı transaction'da yazılır (pg-boss `send({ db })`; kuyruk politikası `exclusive`, dosya başına tek bekleyen ya da çalışan iş). Kuyruk kapalıyken dönüşüm yanıtı beklemeden süreç içinde, arka planda ve sırayla tek denemeyle çalışır, her hata dosyayı reddeder; kapanışta iptal edilen dönüşüm dosyayı reddetmez. Açılışta 15 dakikadır `processing` kalanlar yeniden kuyruğa (kuyruk açık) ya da açılışı beklemeden, `pg_try_advisory_lock` altında süreç içine (kapalı; kilit başka süreçteyse atlanır) alınır. ffmpeg çıktısı amaç süre sınırı + 1 sn'de kesilir (`-t`). İçerik hatası (çözülemeyen, ses akışı yok, boş, tamamen sessiz, dönüşmüş çıktı `FILE_PURPOSES` boyut/süre sınırını aşıyor) kalıcıdır: dosya `rejected`, nesne silinir, `file.reject` denetimi. Araç, depo, süre aşımı ve iptal geçicidir: pg-boss 3 kez geri çekilmeli yeniden dener, son denemedeki geçici hata dosyayı reddeder. Başarıda dönüşmüş nesne yeni anahtara yazılır, satırın anahtarı, türü (`audio/mp4`), boyutu, özeti ve `duration_ms`'i tek işlemde `ready` ile güncellenir (`file.ready` denetimi; migration 0033 içerik kolonlarını yalnız ses amacında ve yalnız `processing` → `ready` geçişinde değiştirmeye izin verir, hiçbir güncelleme dosyayı `processing`'e geri götüremez). Özgün nesnenin anahtarı aynı güncellemede `superseded_storage_key`'e geçer, nesne sonra silinir ve iz boşalır; silme başarısızsa iz kalır, nesneyi tekrarlanan iş, saatlik `files.purge-unattached`, kuyruksuz açılış ya da imha (saklama sonu, rıza geri çekme) siler. Özgün nesneyi `ready`'den önce silmek seçilmedi: aradaki çöküş ya da eşzamanlı deneme geçerli kaydı `media_object_missing` ile reddederdi. İş idempotenttir: `processing` olmayan dosya dönüştürülmez; `ready` dosyada yalnız özgün nesnenin silinmesi tekrarlanır. Log yalnız kimlik ve hata kodu taşır. Ses dönüşümü taramayı beklemez (ses taraması aşağıdaki OG-988 notunda).

- Uygulama notu (OG-092, IST-027): karar 8'in ses dışı kısmı. Tarayıcı arayüzü `apps/api/src/services/file-scanner.ts` (`FileScanner`; sürücüler `clamav` ve `off`, testte sahte tarayıcı `buildApp({ fileScan })` ile), iş `src/jobs/file-scan.ts`, işleyici `services/file-scan.ts`. `FILE_SCANNER` üretimde varsayılan `clamav`'dır ve `off` üretimde reddedilir; üretim dışında varsayılan `off`'tur: dosya bugünkü gibi `pending` kalır ve bağlanamaz, iş açılmaz (clamd'siz geliştirme ve e2e). Tarayıcı açıkken ses dışı yükleme `processing` başlar, `file.scan` işi ses dönüşümü deseniyle (`send({ db })`, `exclusive`) aynı transaction'da kuyruğa girer. Temiz dosya `recordFileCheck` ile `ready` (`file.ready`); zararlı (imza, `Heuristics.*` sezgi ya da sınır bulgusu) `rejected`, nesne silinir, `file.reject`; log yalnız kimlik ve imza adı taşır, dosya adı yazılmaz. Ret yazılıp nesne silinemezse iş yeniden denenir ve yeniden denemede yalnız silme çalışır (tarama ve denetim yinelenmez). Erişilemez tarayıcı, süre aşımı, iptal, eksik/bozuk yanıt ve `ERROR` geçicidir: 6 kez geri çekilmeli yeniden deneme, son denemede de dosya `processing` kalır; kuyruksuz yolda tek deneme, dosya yine `processing` kalır. 15 dakikadır `processing` kalan ses dışı dosyalar açılışta ve kuyruk açıkken 15 dakikada bir zamanlanan `file.scan-requeue` işiyle (`pg_try_advisory_lock` `file.scan-requeue` altında) yeniden kuyruğa girer; kuyruksuz açılışta ayrı kilit (`file.scan-recovery`) altında süreç içine alınır. Böylece `clamd` uzun süre kapalı kalsa da süreç yeniden başlamadan tarama sürer. Tarama bekleyen bağsız dosya 24 saatlik temizliğe girmez, yüklemeden 7 gün sonra silinir (`PROCESSING_FILE_TTL_MS`; hafta sonu kesintisini kapsar); geç taranıp `ready` olan bağsız dosyanın 24 saati taramanın bittiği andan sayılır (`ready_at`, migration 0041, OG-995), taramasız (`pending`) dosyada yüklemeden. İş idempotenttir: `processing` olmayan dosya taranmaz. Migration gerekmedi: 0033 tetikleyicisi yalnız güncellemede `processing`'e dönüşü engeller, içerik değişmeden `processing` → `ready`/`rejected` serbesttir.
  - **Sabah kararı 41: kendi INSTREAM istemcimiz.** `clamscan` paketi kaldırıldı; ADR 0002'nin hazır paket ilkesinden bilinçli istisnadır. Gerekçe: son sürümü 2024-10 olduğundan bağımlılık kuralının bakım ölçütünü (son 6 ayda sürüm) karşılamıyor; akışta backpressure yok (`write()` dönüşüne bakmıyor, büyük video bellekte birikir); zaman aşımı ve iptalde soketi kapatmıyor; kendi `console.error` çıktısı yapılandırılmış logun dışına düşüyor. İstemci küçük ve protokol sabittir: `zINSTREAM\0`, her parça 4 bayt big-endian uzunluk + en çok 64 KiB veri, sonda 4 bayt sıfır; yanıt `\0` ile biter (`stream: OK`, `stream: <imza> FOUND`, `... ERROR`). `node:net` + `node:stream` `pipeline` ile yazılır (backpressure korunur); `CLAMAV_TIMEOUT_MS` (120 sn) üst süresi ve işin `JobDeps.signal`'i tek `AbortSignal`'dir, iptalde soket ve giriş akışı `destroy()` edilir. `OK` yalnız bütün akış ve bitiş parçası gönderildiyse temizdir; `FOUND` ve sınır yanıtı akış yarıda kesilse de geçerlidir; `ERROR` asla temiz sayılmaz. Testler gerçek bir `net.createServer` sahte `clamd`'iyle koşar (`test/file-scanner.test.ts`); gerçek `clamd` entegrasyon testi yoktur.
  - **Sabah kararı 42: ayrı ret kodu.** Taramada reddedilen dosyada yükleyen okumada (`GET /files/:id`, `/url`) ve bağlamada (`attachFile`, teslim, soru, kaynak sürümü) 422 `file_rejected` alır: "Dosya güvenlik taramasından geçmedi. Başka bir dosya yükleyin." Varlık ipucu kuralı korunur: başka kurumun, başkasının ya da kapsam dışı dosya eskisi gibi 404 (bağlamada 422 `file_unavailable`); kod kapsam ve modül denetiminden sonra verilir. Ses dönüşümünün reddi tarama reddi değildir, eski davranış kalır. Oturumsuz indirme ucu (`/files/download`) 404 kalır.
  - **Sabah kararı 43: sınırlar.** `deploy/clamav/clamd.conf`'ta `AlertExceedsMax yes`: sınırı aşan içerik `Heuristics.Limits.Exceeded.*` bulgusu olarak reddedilir, taramasız `ready` olamaz. `StreamMaxLength` ve `MaxFileSize` (210M) core `FILE_PURPOSES` içindeki en büyük amaç sınırının (materyalde video 200 MB) üstünde, `MaxScanSize` 420M; `MaxScanTime` API üst süresinden kısadır (100 sn); değerler dosyada yorumla açıklanır ve `test/file-scanner.test.ts` en büyük amaç sınırıyla karşılaştırır. `INSTREAM size limit exceeded` yanıtı kalıcı rettir (`scan_limit_exceeded`). Yerelde `docker compose --profile clamav up -d` (resmî `clamav/clamav` imajı, imza güncellemesi aynı konteynerde). Ses taraması aşağıdaki OG-988 notundadır.

- Uygulama notu (OG-988): karar 8'in ses kısmı. Tarayıcı açıkken ses yüklemesi `media.transcode` ve `file.scan` işini aynı transaction'da kuyruğa koyar ve `scan_pending` ile başlar (migration 0042); dönüşüm taramayı beklemez. Dosya dönüşüm bitip tarama temiz çıkınca `ready` olur ve sonra biten iş yazar: ikisi de satırı kilitleyip kararını kilit altında verir. Tarama sürerken dönüşüm içeriği yazar ama dosya `processing` kalır; migration 0042 tetikleyicisi bu içerik değişimine yalnız taraması süren, henüz dönüşmemiş satırda ve bir kez izin verir, `scan_pending` dosyada `ready` kısıtla engellenir. Taranan nesne yüklenen özgün nesnedir: ClamAV kullanıcının gönderdiği bayta bakar, dönüşmüş çıktıyı kendi `ffmpeg`'imiz yazar. Bu yüzden özgün nesne tarama bitene kadar silinmez (izdeki anahtar temizliğe girmez). Zararlı ses `rejected` olur, dönüşmüş çıktı da özgün nesne de silinir. Dönüşüm reddi eskisi gibidir. Yeniden kuyruklama taraması bitmemiş sesi kapsar, yalnız dönüşüm bekleyeni kapsamaz. Tarayıcı kapalıyken ses eskisi gibi dönüşümle `ready` olur. Taramada reddedilen sesin yükleyene ayrı kodla (422 `file_rejected`) dönmesi `TODO(ses-tarama-ret-kodu)`.

11. **Mobil çevrimdışı yükleme kuyruğu (IST-126).** Kayıt `expo-audio` ile uygulamanın belge dizinine (önbellek değil) yazılır; kuyruk girdisi (görev, dosya yolu, `Idempotency-Key`, deneme sayısı, cihazdaki kayıt zamanı) yerel kuyrukta tutulur. Gönderim `expo-file-system` çok parçalı yüklemesiyle, bağlantı geri gelince (`@react-native-community/netinfo`) üstel bekleme ile yeniden denenir; aynı anahtar sunucuda mükerrer dosya açmaz. Dosya yalnız sunucu `ready` ve teslim işlemi başarılı olunca cihazdan silinir; çıkışta bekleyen kayıt varsa kullanıcı uyarılır, onaylarsa silinir. Kuyruk, silinecek demo AsyncStorage anlık görüntüsünden ayrıdır. Faz 1'de kaldığı yerden devam eden (tus) yükleme yoktur; 20 MB sınırında bütün dosya yeniden gönderilir. Son tarihten sonra ulaşan çevrimdışı kayıt Açık soru 4'e göre işaretlenir.

12. **Şifreleme.** Aktarımda TLS (API ve depo). Depoda sağlayıcının sunucu tarafı şifrelemesi (SSE) ve disk şifrelemesi zorunludur. Ç sınıfı dosyalar (teslim, ses kaydı) imzalı doğrudan indirmeyle uyumlu olsun diye uygulama düzeyinde ayrıca şifrelenmez. Ö sınıfı dosya (sağlık raporu vb.) Faz 1 kapsamında değildir; gelirse uygulama düzeyinde AES-256-GCM ile şifrelenir, imzalı URL verilmez, API üzerinden akışla sunulur (guvenlik-kvkk §8).

13. **Saklama ve imha.** `retention_until` bağlanma anında amaç ve kurum türüne göre hesaplanır; `pg-boss` imha işi en az ayda bir çalışır (periyodik imha aralığı en fazla 6 ay, Silme, Yok Etme veya Anonim Hâle Getirme Yönetmeliği — **doğrulanmalı**). Nesne silinir, satır `status = 'deleted'` ve `deleted_at` ile kalır (meta veri, süre ve rubrik sonucu korunur), `audit_log`'a ve imha tutanağına yazılır.

    | Amaç                                            | Varsayılan süre                                                                                                                                       |
    | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `speaking_recording`                            | Puanlama ve itiraz kapandıktan sonra, kur bitimi (`language_school`) veya ders yılı sonundan (`school`) itibaren 6 ay (DOM-BEC-052; **doğrulanmalı**) |
    | `submission`                                    | Açık soru 3 (**doğrulanmalı**)                                                                                                                        |
    | `material`, `question_image`, `listening_audio` | Bağlı kaynak var oldukça; kaynak "kaldırma" (DOM-KYN-051) ile silinir                                                                                 |
    | `document`                                      | Belge türünün yasal saklama süresi (**doğrulanmalı**)                                                                                                 |
    | Bağlanmamış/reddedilmiş                         | 24 saat                                                                                                                                               |

    Yedekte nesne sürümleme açıktır; silinen nesnenin eski sürümleri yaşam döngüsü kuralıyla en çok 30 günde temizlenir (**doğrulanmalı**). Veri sahibinin silme talebi (guvenlik-kvkk §11) `data_subject_id` ile dosyaları bulur.

## Sonuçlar

- Dosya erişimi tek uçtan ve kayıt kapsamından geçer; kapsam ikinci kez yazılmaz. Çapraz kurum ve çapraz öğrenci dosya erişimi API testleriyle (`app.inject`) denenir.
- API sunucusu yükleme bant genişliğini taşır; Faz 1 boyutlarında (≤ 200 MB) kabul edilebilir. Büyük video ve uyarlanabilir akış (IST-041, Faz 2) ayrı ADR'de imzalı çok parçalı yükleme ister.
- Yeni bağımlılıklar: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `file-type`, `sharp`; sistemde `ffmpeg`/`ffprobe` ve `clamd`. Mobilde `expo-audio`, `expo-file-system`, `@react-native-community/netinfo`.
- Takip işleri: `files` ve `consents` migration'ı; `guvenlik-kvkk.md` §5 (CSP), §10 (saklama tablosu) ve `veritabani.md` güncellemesi; `.env.example`; `compose.yaml` `storage` ve `clamav` profilleri; `docs/muhendislik/saklama-imha.md`.

## Alternatifler

- **Yalnız yerel disk (ADR 0001 karar 8'in v1'i):** en basit, ama imzalı URL'yi, ikinci sunucu örneğini ve yedeklemeyi bizim yazmamızı gerektirir; testte kalır, üretimde elendi.
- **İmzalı URL ile tarayıcıdan doğrudan yükleme:** API bant genişliğini kurtarır; ama tür/boyut denetimi yükleme sonrasına kalır, depo kökeni CORS'a açılır, yarım nesneler ayrıca temizlenir ve disk sürücüsüyle aynı akış olmaz. Faz 1 boyutlarında getirisi az; büyük video için Faz 2'de yeniden değerlendirilir.
- **tus ile kaldığı yerden devam eden yükleme (`@tus/server`):** zayıf bağlantıda güçlü; 20 MB ses için karmaşıklığı fazla. Faz 2 video ile birlikte.
- **Dosyayı PostgreSQL'de (`bytea`/large object) tutmak:** tek yedek, tek işlem; ama veritabanı boyutu ve yedek süresi büyür, imzalı bağlantı yoktur. Elendi.
- **Dış bulut medya hizmetleri (Cloudinary, Mux vb.):** dönüşüm ve akış hazır, ama yurt dışı aktarım ve dış SaaS bağımlılığı (ADR 0001, IST-024). Elendi.
- **Virüs taramasız başlamak:** işletim yükü yok; ama öğretmenin yüklediği dosya yüzlerce öğrenciye dağıtılır. Elendi; tarayıcı yerel konteyner olduğu için veri kurum dışına çıkmaz.
- **Ç sınıfı dosyalarda uygulama düzeyi şifreleme:** daha güçlü, ama imzalı doğrudan indirme ve tarayıcı oynatıcısıyla uyumsuz; SSE + erişim kapsamı + kısa ömürlü bağlantı yeterli görüldü.

## Açık sorular (önerilen seçeneklerle kapandı)

1. **Yerel ve üretim S3 uyumlu yazılım.** MinIO topluluk sürümünün 2025'te ikili/imaj dağıtımını bıraktığı bilgisi var (**doğrulanmalı**).
   - a) Üretimde Türkiye'de barındıran yönetilen S3 uyumlu hizmet, yerelde Garage veya SeaweedFS konteyneri **(önerilen)**
   - b) Kendi sunucumuzda Garage/SeaweedFS (üretim ve yerel aynı)
   - c) MinIO (son topluluk imajı sabitlenerek)
2. **Konuşma kaydının hukuki dayanağı.**
   - a) 18 yaş altında veli açık rızası, yetişkinde aydınlatma + açık rıza **(önerilen, muhafazakâr; DOM-BEC-050)**
   - b) Sözleşmenin ifası + aydınlatma, rıza yok
   - c) Hukukçu görüşüne kadar konuşma görevini yalnız yüz yüze yürütmek
3. **Ödev teslim dosyalarının saklama süresi.**
   - a) Ders yılı / kur sonundan itibaren 1 yıl **(önerilen, not itirazı ve veli talebi için)**
   - b) Öğrencinin kurumdan ayrılmasından itibaren 1 yıl
   - c) Kurum ayarı (alt ve üst sınırlı)
4. **Son tarihten sonra ulaşan çevrimdışı kayıt.**
   - a) Sunucu zamanı esas; teslim `geç` işaretlenir ve "çevrimdışı kaydedildi" notu ile cihaz zamanı gösterilir, öğretmen kabul eder **(önerilen; cihaz saati güvenilmez)**
   - b) Cihaz zamanı son tarihten önceyse 24 saat tolerans içinde zamanında sayılır
   - c) Son tarihten sonra hiç kabul edilmez
5. **Virüs taraması.**
   - a) ClamAV, Faz 1'den itibaren bütün belge/görsel/video yüklemelerinde **(önerilen)**
   - b) Yalnız öğretmen/yönetici yüklemelerinde (öğrenciye dağıtılan içerik)
   - c) Faz 2'ye ertelenir, Faz 1'de yalnız tür/makro denetimi
6. **Varsayılan kurum depolama kotası.**
   - a) 50 GB, platform yöneticisi artırır **(önerilen)**
   - b) Öğrenci başına 500 MB
   - c) Sınırsız, yalnız izleme
