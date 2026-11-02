# Güvenlik ve KVKK

Kampüs çoğunluğu reşit olmayan öğrencilerin verisini işler. Varsayılan tutum: en az veri, en dar erişim, sunucuda zorlama, istemciye güven yok.

Hukuki roller: kurum (okul, dil okulu) **veri sorumlusudur**; Kampüs platformu kurum adına **veri işleyendir**. Kurumla veri işleme sözleşmesi yapılır, VERBİS kaydı kurumundur. Bu belgedeki süreler ve işleme şartları mühendislik varsayılanıdır; "hukuk onayı" işaretli maddeler yayından önce hukuk danışmanıyla kesinleşir.

Kimlik doğrulama ve oturum **Better Auth** iledir (ADR 0002 karar 3; ADR 0001 karar 7'nin yerine). Parola özeti, oturum belirteci, çerez ve kimlik uçlarındaki hız sınırı için kendi kodumuz yazılmaz; bu belge Better Auth'un **nasıl yapılandırılacağını** ve onun üstündeki kendi kurallarımızı tanımlar. Yapılandırma tek dosyadadır: `apps/api/src/auth.ts`.

## 1. Kimlik doğrulama (Better Auth)

- Yöntem: `emailAndPassword` (Better Auth'un varsayılan scrypt özeti). Özel `password.hash`/`verify`, elle JWT, elle yenileme belirteci veya elle oturum tablosu yazılmaz.
- Açık kayıt kapalıdır (`disableSignUp: true`). Hesapları kurum yöneticisi davetle (`organization` daveti) veya sunucu API'siyle açar; öğrenci ilk girişte parolasını değiştirir.
- Uçlar Better Auth'a aittir ve `basePath: '/api/v1/auth'` altında Fastify'a bağlanır. Bu uçların istek/yanıt biçimi Better Auth'undur; bizim yanıt zarfımız bu önek dışında geçerlidir. İstemci bu uçları yalnız Better Auth istemcisiyle çağırır (`better-auth/react`, mobilde `@better-auth/expo/client`).
- HTTP'ye açık Better Auth uçları izin listesindedir (`OPEN_AUTH_PATHS`, `apps/api/src/auth.ts`): giriş, çıkış, oturum, parola değişimi/sıfırlama, oturum listesi/iptali ve kurum listesi/etkin kurum/kendi üyeliği. Listede olmayan her yol Better Auth'a iletilmeden 404 döner; sürüm yükseltmesiyle gelen yeni uç kendiliğinden kapalıdır. Test (`apps/api/test/auth-surface.test.ts`) Better Auth uç kaydını dolaşarak bunu doğrular. Üye/davet listeleri, başkasının rolü (`get-active-member-role`) ve sosyal giriş olmadığından Expo yetkilendirme vekili kapalıdır.
- Giriş hatası kullanıcıya tek mesajla gösterilir: "E-posta veya parola hatalı." Parola sıfırlama isteği hesabın var olup olmadığını belli etmez (test edilir).
- Parola sıfırlama (IST-003): web'de `/parolami-unuttum` e-postayı alır; yanıt hesabın var olup olmadığını belli etmez (gövde, durum ve süre aynıdır). Bağlantı `WEB_URL/parola-sifirla#token=…` biçimindedir: belirteç adres parçasındadır, bu yüzden sunucuya, `Referer` başlığına ve erişim loguna gitmez; sayfa belirteci bir kez okuyup adresten siler ve `POST /reset-password` ile tüketir. Better Auth'un `GET /reset-password/:token` yönlendirme ucu kapalıdır (`OPEN_AUTH_PATHS`). `WEB_URL` yapılandırmadan gelir, istek başlığından türetilmez (Host sahteleme); üretimde `WEB_URL` yoksa bağlantı kurulamaz ve ileti gönderilmez.
  - Belirteç 30 dk geçerli (`resetPasswordTokenExpiresIn: 1800`) ve tek kullanımlıktır; veritabanında özetiyle saklanır (`verification.storeIdentifier`, `reset-password:` için `hashed`). Parola sıfırlanınca (`onPasswordReset`) ve `change-password` sonrası kullanıcının bekleyen bütün belirteçleri silinir (`verifications.value = userId`); eşzamanlı ikinci bağlantı parolayı yeniden değiştiremez. `revokeSessionsOnPasswordReset: true`: bütün oturumlar kapanır.
  - Gönderim katmanı `services/mailer.ts` arabirimidir; sağlayıcı seçimi `MAIL_DRIVER`: `log` (bağlantıyı belirteciyle loga yazar, yalnız yerel geliştirme), `memory` (test kutusu), `none` (hiçbir şey göndermez, uyarı loglar). Varsayılan geliştirmede `log`, testte `memory`, üretimde `none`; üretimde `log` ve `memory` başlangıçta reddedilir, belirteç üretim loguna girmez (gönderilen iletinin logu belirteci `[gizli]` yazar). Gerçek e-posta sağlayıcısı OG-095'tedir; o gelene kadar üretimde sıfırlama bağlantısı kimseye ulaşmaz (kullanıcıya hata gösterilmez, denetimde `mail_not_configured`). İleti yanıtı beklemeden arka planda gider (`advanced.backgroundTasks`), kapanışta tamamlanır; sağlayıcı gecikmesi hesap var/yok ayrımına yol açmaz.
  - Kuruma bağlı üyeliği kalmamış hesaba ileti gitmez (`no_membership`).
  - Taciz ve posta kutusu doldurma: IP başına saatte 3 (Better Auth `rateLimit`), hesap başına açık belirteç varken 5 dk soğuma ve saatte en çok 3 ileti (`resetThrottleReason`, `before` kancası; reddedilen istek `verifications` satırı yazmaz, yanıt aynıdır, denetimde `cooldown`/`rate_limited`). E-posta sınırı bellek içidir (tek sunucu örneği; §4).
  - Denetim: `auth.password_reset_requested` oturumsuz olduğundan `actorUserId` boştur, hesap `entityType='user'`/`entityId` alanındadır; bilinmeyen e-posta için aktör ve varlık boştur, ham e-posta yazılmaz. `auth.password_reset_completed` hesap sahibine yazılır. Parola değişiminde diğer oturumlar kapatılır (`revokeOtherSessions`).
- E-postası olmayan öğrenci girişi (ör. `username` eklentisi) ve yönetici/finans rollerinde `twoFactor` (TOTP) eklentisi açık sorudur; eklenirse aynı yapılandırma dosyasında.
- Better Auth sürümü tam sabitlenir; güvenlik duyuruları izlenir, güncelleme sonrası şema üretimi yeniden koşulur ve fark migration olarak eklenir ([veritabani.md](veritabani.md#kimlik-tabloları-better-auth)).
- Kimlik olayları (giriş başarısı/başarısızlığı, çıkış, parola değişimi/sıfırlama, üyelik ve rol değişimi) Better Auth `hooks`/`databaseHooks` ile `audit_log`'a yazılır.

## 2. Parola politikası

- `minPasswordLength: 12`, `maxPasswordLength: 128`. Bileşim kuralı (büyük harf, rakam, sembol) ve periyodik zorunlu değişim yok.
- Yaygın parola listesi, e-postanın kendisi/yerel kısmı, kurum adı ve `kampus` türevleri Better Auth `hooks.before` içinde `/sign-up/email`, `/reset-password`, `/change-password` için reddedilir. Liste depoda tutulur; parola dış servise gönderilmez (`haveIBeenPwned` eklentisi dış istek yaptığı için kullanılmaz).
- Yapıştırma ve parola yöneticisi engellenmez; "parolayı göster" düğmesi bulunur (WCAG 3.3.8). Alanlarda `autocomplete="current-password"` / `"new-password"`.
- Ele geçirildiği bilinen parola için yönetici kullanıcının oturumlarını kapatıp sıfırlama başlatabilir.

## 3. Oturum

- Veritabanı oturumu (Better Auth `session` tablosu). Ayarlar: `expiresIn: 14 gün`, `updateAge: 1 gün` (kullanıldıkça uzar), `freshAge: 15 dk`.
- `cookieCache` kapalıdır: oturum, üyelik ve rol her istekte veritabanından doğrulanır; iptal ve rol değişikliği anında etkili olur. Açılması ölçümle gerekçelenmiş ayrı karardır.
- Web: Better Auth çerezi (`cookiePrefix: 'kampus'`, `HttpOnly`, üretimde `Secure`, `SameSite=Lax`). Erişim belirteci veya oturum kimliği JavaScript'e, `localStorage`'a, `sessionStorage`'a yazılmaz. Web ve API aynı kaynaktan (ters vekil ile `/api`) sunulması önerilir; alt alan adı gerekirse `crossSubDomainCookies` dağıtım ADR'sinde karara bağlanır.
- Mobil: `@better-auth/expo` oturumu `expo-secure-store`'da tutar; API istekleri çerez başlığını Better Auth istemcisinden alır (`authClient.getCookie()`). AsyncStorage'a oturum yazılmaz. Çerez başlığı yalnız TLS üzerinden gider: üretim derlemesinde `EXPO_PUBLIC_API_URL` `https` olmalıdır, `http` yalnız geliştirmede kabul edilir. Sorgu önbelleği oturum kapanınca, kullanıcı kimliği değişince (arada `unauthenticated` görülmese de) ve mobilde 401 ile girişe düşünce temizlenir; sonraki kullanıcı öncekinin verisini görmez.
- Oturumu süresi dolan istemci 401 alır ve giriş ekranına yönlenir; istemcide yenileme mantığı yazılmaz.
- Hassas işlemler (iade, rol/üyelik değişikliği, kişisel veri dışa aktarma, veri sahibi silme talebi) taze oturum ister: oturum `freshAge`'den eskiyse 403 `reauthentication_required`, istemci parolayı yeniden sorar.
  - API: uç `preHandler: [app.authenticate, app.requireFreshSession]` bildirir (`plugins/authenticate.ts`, süre `SESSION_FRESH_AGE_SECONDS`); platform testi `apps/api/test/fresh-session.test.ts`.
  - Web: `@/auth/use-reauth-retry.tsx` işlemi çalıştırır, 403 `reauthentication_required` gelirse `@/auth/ReauthModal.tsx` parolayı sorar, doğrulamadan sonra işlemi bir kez tekrarlar; vazgeçilirse sessizce kapanır. Parola yalnız pencere açıkken bellekte kalır, yanlış denemede silinir; giriş sonrası işlem aynı kurumda sürer. Sabit ve hata denetimi `@kampus/react-shared/reauthentication.ts` (`REAUTHENTICATION_CODE`, `isReauthenticationRequired`).
  - Mobil henüz taze oturum penceresi sunmaz (hassas işlemler web'dedir).
- Oturum listesi (IST-003, KVKK veri en azı): `GET /list-sessions` yanıtı `id`, `token`, `createdAt`, `updatedAt`, `expiresAt`, `device` (kaba "Tarayıcı · İşletim sistemi" özeti) ve `current` döndürür; IP adresi ve ham `User-Agent` dönmez (`lib/session-device.ts`). `token` yalnız `/revoke-session` içindir. Better Auth bu ucu taze oturumla (`freshAge`) sınırlar; web Güvenlik sayfası (`/:rol/guvenlik`, avatar menüsünde) gerekirse parola penceresini açar. Tek oturum sonlandırılır ya da parola değişiminde "diğer cihazlardan çıkış yap" (varsayılan açık) ile eski oturumların hepsi kapanır; bu cihaza yeni oturum açılır ve etkin kurum korunur. Bilinen kenar: taze oturum için yapılan yeniden doğrulama girişi eski oturumu kapatmaz, o cihaz listede ayrı satır görünür.
- Çıkış oturumu siler; "Bütün cihazlardan çık" `revokeSessions` kullanır. Yönetici, kullanıcının oturumlarını kapatabilir.
- `BETTER_AUTH_SECRET` en az 32 bayt rastgele değerdir; ortamdan gelir ve ortamlar arası paylaşılmaz. Üretimde `CHANGE_ME` önekli veya depoda geçen bilinen değerler reddedilir.
- `Secure` çerez üretimde ve `BETTER_AUTH_URL` https olduğunda her zaman açıktır. `NODE_ENV` zorunludur (varsayılanı yok); Expo Go kökenleri (`exp://`) ve `/api/docs` yalnız açıkça `development`/`test` ortamında açılır.

## 4. Hız sınırlama

- Kimlik uçları: Better Auth `rateLimit` (`enabled: true` bütün ortamlarda, testte açıkça), `customRules` ile:

| Uç                                    | Sınır                 |
| ------------------------------------- | --------------------- |
| `/sign-in/email`                      | 5 istek / 60 sn (IP)  |
| `/request-password-reset`             | 3 istek / 1 saat (IP) |
| `/reset-password`, `/change-password` | 5 istek / 15 dk (IP)  |
| Diğer `/api/v1/auth/*`                | 60 istek / 60 sn (IP) |

- Uygulama uçları: `@fastify/rate-limit`, 429 + `Retry-After` + `rate_limited`. Kimlikli istekte anahtar kullanıcı kimliği, kimliksizde IP. Genel sınır kullanıcı başına 300/dk; içe/dışa aktarma kullanıcı başına 10/dk.
- Sıfırlama iletisi için hesap başına ek sınır §1'dedir (5 dk soğuma, saatte 3). X-Forwarded-For arkasında sınır `TRUST_PROXY` kuralına uyar; sahte başlık sınırı aşamaz (`password-reset.test.ts`).
- Hesap kalıcı kilitlenmez (kötü niyetli kişi veliyi kilitleyemesin).
- v1 tek sunucu örneğinde bellek içi sayaç; birden çok örnekte Better Auth `storage: 'database'` ve paylaşılan depo kullanılır (dağıtım ADR'si). Ters vekil arkasında gerçek IP (`advanced.ipAddress`, Fastify `trustProxy`) yalnız vekile güvenilerek ayarlanır: `TRUST_PROXY` vekil sayısı (hop) veya vekil IP/CIDR listesidir, varsayılan güvenmemektir; bütün vekillere güvenen `true` reddedilir, çünkü istemcinin yazdığı `X-Forwarded-For` hız sınırını atlatır.

## 5. CORS, CSRF, CSP ve güvenlik başlıkları

- CORS (`@fastify/cors`): izinli kaynaklar `CORS_ORIGINS` ortam değişkeninden tam eşleşmeyle, `credentials: true`; `*` yok. Aynı liste Better Auth `trustedOrigins`'e verilir. Mobil yerel istemci CORS'a tabi değildir.
- CSRF: oturum çerezde olduğu için durum değiştiren (`POST`, `PATCH`, `DELETE`) uygulama isteklerinde `Sec-Fetch-Site: cross-site` veya izinli listede olmayan `Origin` 403 `csrf_rejected` alır. `GET` yan etkisizdir. Kimlik uçlarında bu denetimi Better Auth yapar.
- API (`@fastify/helmet`): `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` (kişisel veri içeren yanıtlarda).
- Web CSP (statik sunucuda başlık olarak):

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:;
font-src 'self'; connect-src 'self'; worker-src 'self' blob:;
frame-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self';
form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

- `unsafe-eval` yok. Radix/shadcn bileşenlerinin konumlandırma için yazdığı satır içi `style` öznitelikleri gerekiyorsa yalnız `style-src-attr 'unsafe-inline'` eklenir; `script-src`'ye satır içi izin verilmez. CSP önce `Content-Security-Policy-Report-Only` ile denenir.
- Dosya indirme (ADR 0003 karar 6): disk sürücüsünde imzalı bağlantı API kökenindedir; web API'yi ayrı kökende sunarsa `img-src`/`media-src`/`frame-src`'ye API kökeni eklenir. S3 sürücüsünde `STORAGE_PUBLIC_URL` kökeni eklenir (`TODO(F3c2-csp)`, S3 ile birlikte). İndirme ucu Helmet'in `Cross-Origin-Resource-Policy: same-origin` varsayılanını `cross-origin` ile ezer; yoksa tarayıcı başka kökenden gömülen görsel/sesi engeller. Yetki imzadadır (S3 ön imzalı bağlantısı da CORP göndermez); JSON uçları `same-origin` kalır.
- `Permissions-Policy: camera=(), geolocation=(), microphone=(self)` (konuşma becerisi kaydı için yalnız kendi kaynağımız).

## 6. Kiracı izolasyonu

- Kurum Better Auth `organization` eklentisidir. Kurum kimliği yalnız doğrulanmış oturumun **etkin kurumundan** (`session.activeOrganizationId`) gelir ve `authenticate` ön işleyicisinde `request.ctx.institutionId`'ye konur. Etkin kurum yoksa 403 `no_active_institution`. Gövde, sorgu, yol veya başlıktaki kurum kimliği okunmaz; şema bu alanı reddeder.
- Etkin kurum yalnız Better Auth `organization.setActive` ile değişir (üyelik doğrulanır). İstemci kurum değişince sorgu önbelleğini tamamen temizler.
- Her istekte kullanıcının etkin kurumdaki üyeliği (`member`) okunur; üyelik yoksa veya kaldırılmışsa 403.
- Bütün veritabanı erişimi kurum kapsamlı depo fonksiyonlarından geçer; ilk parametre `institutionId`'dir. Serviste kurum filtresi olmayan sorgu yazılmaz.
- Başka kuruma ait kayıt 404 döner (403 değil; varlık sızdırılmaz).
- Dosya depolama anahtarları `<institution_id>/` önekiyle başlar; indirme bağlantıları kısa ömürlü ve imzalıdır.
- `pg-boss` işleri, önbellek anahtarları ve dışa aktarmalar kurum kimliğini açıkça taşır; iş yükünde kişisel veri değil kimlik bulunur.
- Kurumlar arası işlem (platform bakımı) API'den yapılmaz; ayrı komut satırı betiğiyle ve denetim kaydıyla yapılır.
- Ek savunma olarak PostgreSQL satır düzeyi güvenliği (RLS) değerlendirilecek (açık soru, ADR).

## 7. Rol ve kapsam yetkisi

- Roller (`yonetici`, `onburo`, `ogretmen`, `ogrenci`, `veli`) Better Auth access control (`createAccessControl`) ile `organization` eklentisinde tanımlanır; rol üyelikte (`member.role`) tutulur. Varsayılan ret: rol listesi bildirmeyen rota kayıt edilemez.
- Rota düzeyi: `requireRole([...])` (üyelik rolünden) ve `requireModule('<modül>')` (kurumun açık modüllerinden). İzin ifadeleri gerekiyorsa Better Auth `hasPermission` ile.
- Kayıt düzeyi: school-core kapsam fonksiyonları (öğretmen kendi sınıfları/branşı, öğrenci kendisi, veli kendi çocukları). Üyeliğin school-core bağlantısı (öğrenci kimliği, veliye bağlı çocuklar, öğretmen kimliği) üyeliğe bağlı tabloda tutulur ([veritabani.md](veritabani.md#kimlik-tabloları-better-auth)). API kapsamı ikinci kez elle yazmaz.
- Alan düzeyi: rehberlik iç notu, sağlık bilgisi, finans ayrıntısı yalnız yetkili role dönen yanıt şemasında bulunur; ortak şemaya "gizle" bayrağıyla eklenmez.
- Rol ve üyelik değişikliği yalnız `yonetici` tarafından, taze oturumla yapılır ve denetim kaydına yazılır.
- Yetki kararı istemcide yalnız görünümü gizlemek içindir; güvenlik sunucudadır.

## 8. Kişisel veri sınıflandırması

| Sınıf | Tanım                       | Örnekler                                                                                                                                                                     | Kural                                                                                         |
| ----- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| G     | Genel, kişisel olmayan      | Kurum adı, ders adları, müfredat, soru bankası                                                                                                                               | Serbest                                                                                       |
| K     | Kişisel veri                | Ad-soyad, e-posta, telefon, sınıf, kullanıcı kimliği, giriş zamanları                                                                                                        | Rol kapsamı; logda yalnız kimlik                                                              |
| Ç     | Çocuk verisi ve yüksek risk | Reşit olmayan öğrencinin bütün verisi, notlar, devamsızlık, deneme sonuçları, ödev/ses kayıtları, fotoğraf/video, adres, servis konumu, finans (borç, ödeme), T.C. kimlik no | K + dışa aktarma denetim kaydında; T.C. kimlik no listelerde maskeli (`*******1234`)          |
| Ö     | Özel nitelikli (KVKK m.6)   | Sağlık (alerji, ilaç, kronik hastalık, engellilik, revir), rehberlik iç notları içindeki sağlık/aile bilgisi, din bilgisi (muafiyet), biyometrik veri                        | Ç + ayrı alan/tablo, alan düzeyi şifreleme, okuma denetim kaydına yazılır, yalnız gerekli rol |

- Yeni alan eklerken sınıfı şema dosyasında yorumla belirtilir (`// kvkk: Ö`). Sınıfı belirtilmemiş kişisel alan incelemede reddedilir.
- En az veri: ihtiyaç gerekçelendirilemeyen alan toplanmaz (ör. yemek modülü için tam sağlık geçmişi değil, yalnız alerji listesi).
- Ö sınıfı veriler `records.data` içinde tutulmaz; normalleştirme ölçütü 5 gereği ayrı tabloda, uygulama düzeyinde AES-256-GCM ile şifreli kolonda tutulur (anahtar ortamdan, kurum başına türetilmiş).
- Ses ve konuşma kayıtları kimlik tespiti için kullanılmaz; kullanılırsa biyometrik sayılır ve ayrı ADR ister.

## 9. Açık rıza ve aydınlatma

- **Aydınlatma** (KVKK m.10) her durumda yapılır: ilk girişte ve hesap menüsünde, rol bazlı (veli, öğrenci, personel) sürümlü metin. Gösterim kaydı `notice_acknowledgements` tablosunda (kullanıcı, metin sürümü, zaman). Aydınlatma rıza değildir; "okudum" işareti rıza yerine geçmez.
- **İşleme şartı** her veri kategorisi ve amaç için belirlenir (sözleşme, hukuki yükümlülük, meşru menfaat, açık rıza). Açık rıza yalnız başka şart yoksa kullanılır (**doğrulanmalı**).
- **Açık rıza** gerekiyorsa: belirli amaca özgü, ayrı onay kutusu, önceden işaretli değil, hizmet şartına bağlanmamış; reddetmek temel eğitim hizmetini engellemez. Reşit olmayan için veli verir.
- Rıza kaydı: `consents` (kurum, veri sahibi, veren kullanıcı, amaç kodu, metin sürümü, kanal, `given_at`, `withdrawn_at`). Geri çekme verildiği kadar kolaydır (aynı ekranda tek işlem) ve ilgili işleme hemen durur.
- Metin değişince yeni sürüm yayımlanır; eski sürüme verilmiş rıza yeni amacı kapsamaz.
- Kodda: kurallar `packages/school-core/src/lib/consent-purposes.ts` (amaç kodları), `lib/privacy-notices.ts` (sürümlü metin, `needsNoticeAcknowledgement`), `lib/consents.ts` (`requireConsentAuthority`, `planConsent`, `planConsentWithdrawal`, `hasValidConsent`); tablolar `privacy_notices`, `notice_acknowledgements`, `consents` (migration `0024`, `apps/api/src/db/schema/privacy.ts`, depo `apps/api/src/db/privacy.ts`); alan kuralları DOM-YTK-056…062. Ekranlar: web `components/consent/ConsentStep.tsx` ve Ayarlar "Rızalarım" bölümü, kancalar `packages/react-shared/src/use-consents.ts` ([sayfalar/platform.md](../sayfalar/platform.md)); aydınlatmanın ilk girişte gösterimi OG-113'tedir.
- Uçlar (`apps/api/src/routes/privacy.ts`; rıza ve aydınlatma platform yeteneğidir, modül kapatılamaz): `GET/POST /api/v1/privacy-notices` (yalnız yönetici; yayım `Idempotency-Key` zorunlu), `GET /api/v1/privacy-notices/current` ve `POST /api/v1/privacy-notices/:noticeId/acknowledge` (beş rol; aynı sürüm ikinci kez 200, eski sürüm 409), `GET /api/v1/consent-texts/:purpose` (güncel rıza metni ve en düşük geçerli sürüm), `POST /api/v1/consents` (veli ve öğrenci; `Idempotency-Key` zorunlu), `POST /api/v1/consents/:consentId/withdraw` (veli ve öğrenci), `GET /api/v1/consents` (yönetici, ön büro, veli, öğrenci; satırlar; rızayı veren kullanıcının kimliği yalnız yönetici ve ön büroya döner, veli ve öğrenci yalnız ilişkiyi görür) ve `GET /api/v1/consents/status` (öğretmen dahil; yalnız var/yok). Personel rıza veremez; kâğıt/yüz yüze rızanın personelce kaydı yok (açık soru). Denetime yalnız alan adları yazılır; metin gövdesi, öğrenci kimliği ve amaç loglanmaz.
- Velayet: rızayı veren velinin bağı veli–öğrenci bağı tablosundan (`student_guardians`, migration 0027; DOM-ILT-070) okunur (`apps/api/src/services/consents.ts` `consentActorOf`, core `guardianBondsFor`). Kurumun kurduğu bağ doğrulanmış sayılır; velayeti olmayan (`custody: none`) ya da iletişim kısıtlı veli rıza veremez, 403 `consent_custody_required`. Okuma kapsamı hâlâ üyelik bağlantısından (`child`) gelir (`TODO(velayet-kapsam)`, OG-032).
- Eğitim yılı rızası (fotoğraf/video amaçları) kurumun eğitim yılı sonunda düşer: başlangıç yılının (`institution_settings.academic_year`) ertesi yılında 1 Eylül 00:00 Europe/Istanbul (core `academicYearEndsAt`). Veli rızası öğrencinin 18. yaş günü başında düşer.
- İmha: konuşma kaydı rızası geri çekilince öğrencinin `speaking_recording` dosyaları aynı transaction'da imhaya işaretlenir (`retention_until = now`, `file.purge_scheduled` denetim satırı): kayda bağlanmış olanlar (`data_subject_id`) ve öğrencinin hesabının yüklediği henüz bağlanmamış olanlar. Yükleme ve bağlama geçerli rıza yoksa 403 `consent_required`; bağlamada veri sahibi çağırandan alınmaz, yükleyenin öğrenci kaydından türetilir ve rıza bağlama anında yeniden denetlenir (yükleme sürerken geri çekilen rıza böyle yakalanır). Nesneyi silen zamanlanmış imha işi henüz yok (`TODO(F3c2-imha)`: pg-boss kurulunca `retention_until <= now` dosyaları siler); bağlanmamış dosya 24 saatlik temizlikle silinir.
- Yurt dışına aktarım (m.9): barındırma, yedek, e-posta/SMS sağlayıcısı ve mobil anlık bildirim servisleri (FCM/APNs) aktarım riski taşır; her biri ADR'de değerlendirilir (açık soru).

## 10. Saklama ve silme

- Her koleksiyon/tablo için saklama süresi ve imha yöntemi bir saklama ve imha tablosunda tutulur; tablo hukuk onayıyla `docs/muhendislik/saklama-imha.md` olarak yazılacak (açık soru). Mühendislik varsayılanı: arşivlenen kayıt süre dolana kadar saklanır, sonra silinir veya anonimleştirilir.
- İmha işi zamanlanmış çalışır; periyodik imha aralığı 6 ayı geçmez (Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik). Her imha `audit_log`'a ve imha tutanağına yazılır.
- Anonimleştirme geri döndürülemez olmalıdır: ad, iletişim, kimlik alanları silinir; istatistik için yalnız toplu değerler kalır.
- Teknik kayıtlar: Better Auth `sessions` ve `verifications` süresi dolunca 7 gün sonra, `idempotency_keys` 24 saat sonra, uygulama logları 90 gün sonra silinir. Bir kayda bağlanmayan veya reddedilen yüklenmiş dosya (`files`) 24 saat sonra depodan silinir, satırı `deleted` kalır (zamanlayıcı `TODO(jobs)`); bağlı dosyanın saklama süresi (`retention_until`) saklama ve imha tablosuyla belirlenecek (`TODO(F3c2-retention)`). `audit_log` saklama süresi hukukçu onayıyla belirlenir (öneri 2 yıl, **doğrulanmalı**).
- Yedekler aynı saklama süresine uyar; silinen veri yedek dönüşü sonunda yedekten de çıkar.
- Kurum sözleşmesi bitince kurum verisi dışa aktarılıp teslim edilir, sonra sözleşmedeki sürede silinir.

## 11. Veri sahibinin hakları (KVKK m.11)

- Haklar: işlenip işlenmediğini öğrenme, bilgi isteme, amaç ve aktarılan taraflar, düzeltme, silme/yok etme, itiraz, zararın giderilmesi. Başvuru veri sorumlusuna (kuruma) yapılır; platform kuruma araç sağlar.
- Kurum yöneticisi için araçlar: kişinin bütün verisini makine okunur (JSON) ve okunur (PDF) dışa aktarma, alan düzeltme, silme/anonimleştirme, talebi `data_subject_requests` tablosunda izleme (alınma, yanıt, sonuç).
- Yanıt süresi en geç 30 gündür (m.13); talep kaydı bu süreyi gösterir ve 20. günde yöneticiyi uyarır.
- Veli, reşit olmayan çocuğu adına başvurur; çocuk reşit olunca kendi hesabıyla başvurur.
- Silme, hukuki saklama yükümlülüğü olan kayıtları (finans belgeleri gibi) kapsamıyorsa ret gerekçesi kayda yazılır.

## 12. Gizli anahtar yönetimi

- Bütün gizli değerler ortam değişkenindedir: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `FIELD_ENCRYPTION_KEY`, `CORS_ORIGINS`, SMTP bilgileri. `config.ts` başlangıçta doğrular; eksikse süreç başlamaz.
- `.env` commit edilmez; `.env.example` yalnız yer tutucu değerle güncel tutulur.
- Üretim sırları sunucunun sır deposunda/ortamında; nasıl tutulacağı dağıtım ADR'sindedir. Geliştirme ve test sırları üretimden farklıdır.
- Anahtar döndürme: `BETTER_AUTH_SECRET` yılda bir ve yetkili personel ayrılığında döndürülür (imzalı çerezler geçersizleşir, kullanıcılar yeniden giriş yapar; bu sırla şifrelenmiş değer, ör. iki adım sırrı, varsa etkisi önce test ortamında denenir); alan şifreleme anahtarı sürümlü (`key_version` kolonu) döndürülür.
- Mobil ve web paketlerine sır girmez (`EXPO_PUBLIC_*`, `VITE_*` herkese açıktır).
- Android imzalama anahtarı depo dışında tutulur (mevcut kural).
- Sızan sır derhal döndürülür; git geçmişinden silmek yetmez.

## 13. Loglarda kişisel veri

- Loglanmaz: parola, belirteç, çerez, `Authorization`, istek/yanıt gövdesi, e-posta, telefon, T.C. kimlik no, adres, Ç ve Ö sınıfı alan değerleri, serbest metin (rehberlik notu, mesaj).
- Loglanır: `reqId`, `institutionId`, `userId`, kayıt kimlikleri, rota, durum kodu, süre, hata kodu.
- IP adresi uygulama logunda son okteti sıfırlanarak (`203.0.113.0`), denetim kaydında tuzlanmış özetle tutulur.
- Maskeleme pino `redact` ile merkezîdir ([kod-yazim.md](kod-yazim.md#6-loglama)); yeni hassas alan eklenince `redact` listesi aynı committe güncellenir ve testle doğrulanır.

## 14. Girdi, dosya ve çıktı güvenliği

- Bütün girdi Zod ile doğrulanır; nesne şemaları bilinmeyen anahtarı atar (`__proto__` dahil).
- SQL yalnız Drizzle sorgu kurucusu veya `sql` şablonuyla (parametreli); kullanıcı girdisiyle `sql.raw` yasak. jsonb yolu kullanıcı girdisinden kurulmaz.
- Dosya yükleme: boyut sınırı, içerikten tür tespiti (uzantıya güvenilmez), izinli türler listesi, dosya adı sunucuda üretilir. İndirme `Content-Disposition: attachment` ve `nosniff` ile.
- Dosya deposu (ADR 0003; `apps/api/src/storage`, `services/files.ts`): yükleme akışla depoya yazılır, boyut ve SHA-256 aynı geçişte ölçülür; amacın sınırı aşılınca akış kesilir ve yarım nesne silinir (413). Tür `file-type` ile sihirli bayttan bulunur; bildirilen tür veya ad uzantısı içerikle çelişirse 422. Depo anahtarı kurum önekli ve rastgeledir, özgün ad anahtara, loga ve denetim kaydına girmez. İndirme bağlantısı API'nin kendi ucudur (`GET /api/v1/files/download?token=`): belirteç HMAC-SHA256 ile imzalı ve süreli (varsayılan 5 dk, konuşma kaydı 2 dk), anahtar `BETTER_AUTH_SECRET`'tan türetilir; süresi geçmiş veya bozuk imza 403. Belirteç imzalı ama şifresizdir; bu yüzden yalnız kurum, dosya kimliği, bitiş ve disposition taşır, özgün ad ve tür indirmede `files` satırından okunur (silinmiş/reddedilmiş dosya 404). Böylece ad vekil loguna ve tarayıcı geçmişine girmez. İstek logu sorgu dizesini yazmadığı için belirteç uygulama loguna düşmez. Bağlantı üretimi bağlı kaydın okuma kapsamından geçer (önce kapsam, sonra modül: modül kapalıyken kapsam dışı dosya 404 alır, varlık ipucu verilmez); teslim ve konuşma kaydında `audit_log`'a `file.access` yazılır. Tutulmayan nesnenin silme hatası asıl hatayı örtmez, depo anahtarıyla loglanır; reddedilen dosyanın nesnesi silinemezse hata dosya kimliğiyle loglanır ve fırlatılır (satır `rejected` kalır); satırsız kalan nesneler için önek taraması `TODO(F3c2-orphans)`. Bildirilen tür core `canonicalMimeType` ile takma addan kanonik MIME'a çevrilir; web ön denetimi aynı tabloyu kullanır. Virüs taraması (ClamAV), S3 sürücüsü ve uygulama düzeyi şifreleme `TODO(F3c2-scan)`, `TODO(F3c2-s3)`.
- CSV dışa aktarmada formül enjeksiyonu önlenir ([api-tasarimi.md](api-tasarimi.md#3-sayfalama-filtre-ve-sıralama)).
- React'te `dangerouslySetInnerHTML` yasak; zengin metin gerekirse ADR ve temizleyici kitaplık.

## 15. Bağımlılık güvenliği

- CI'da `pnpm audit --prod --audit-level high`; yüksek/kritik açık birleştirmeyi engeller. Düzeltme yoksa istisna kayıt numarası ve son tarihle `pnpm-workspace.yaml`'da tutulur.
- pnpm yayın yaşı beklemesi (`minimumReleaseAge`) ve kurulum betiği izinleri (`allowBuilds`, `onlyBuiltDependencies`) korunur.
- Bağımlılık güncellemeleri haftalık toplu PR ile; güvenlik güncellemesi beklemeden.
- GitHub Actions adımları sürüm etiketine değil commit SHA'sına sabitlenir.
- Lisans ve ekleme politikası: [kod-yazim.md](kod-yazim.md#8-bağımlılık-ekleme-politikası).

## 16. Olay müdahalesi

- Kişisel veri ihlali şüphesinde: erişim kapatılır, kanıt (log, denetim kaydı) korunur, kurum (veri sorumlusu) gecikmeden bilgilendirilir. Kurul'a bildirim veri sorumlusunca öğrenmeden itibaren en geç 72 saat içinde yapılır; platform bu süreye uygun bilgi sağlar.
- Olay sonrası kök neden ve önlem ADR veya olay raporuyla kayda geçer.
