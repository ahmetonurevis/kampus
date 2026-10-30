# Güvenlik ve KVKK

Kampüs çoğunluğu reşit olmayan öğrencilerin verisini işler. Varsayılan tutum: en az veri, en dar erişim, sunucuda zorlama, istemciye güven yok.

Hukuki roller: kurum (okul, dil okulu) **veri sorumlusudur**; Kampüs platformu kurum adına **veri işleyendir**. Kurumla veri işleme sözleşmesi yapılır, VERBİS kaydı kurumundur. Bu belgedeki süreler ve işleme şartları mühendislik varsayılanıdır; "hukuk onayı" işaretli maddeler yayından önce hukuk danışmanıyla kesinleşir.

## 1. Kimlik doğrulama

- E-posta + parola. Parola `node:crypto` scrypt ile özetlenir: `N = 2^17, r = 8, p = 1`, 16 bayt rastgele tuz, 64 bayt çıktı, `maxmem` 256 MB. Saklama biçimi: `scrypt$17$8$1$<tuz-base64url>$<özet-base64url>`.
- Karşılaştırma `crypto.timingSafeEqual` ile. Parametreler güçlendirilirse eski özet başarılı girişte yeniden özetlenir.
- Giriş hatası tek mesajdır: "E-posta veya parola hatalı." Hesabın varlığı, kilitli olduğu veya hangi alanın yanlış olduğu söylenmez. Var olmayan e-posta için de sahte özet hesaplanır (zamanlama farkı olmaz).
- Parola sıfırlama: 32 bayt rastgele, tek kullanımlık, 30 dakika geçerli belirteç; veritabanında SHA-256 özeti tutulur. Sıfırlama ve parola değişimi kullanıcının bütün yenileme belirteçlerini iptal eder.
- Öğrenci hesaplarını kurum açar; ilk parola tek kullanımlıktır ve ilk girişte değiştirilir.
- Yönetici ve finans yetkili roller için TOTP ikinci adımı yol haritasındadır (açık soru: v1'e girer mi).

## 2. Parola politikası

- En az 12, en fazla 128 karakter; boşluk ve Unicode serbest, NFKC ile normalleştirilir.
- Bileşim kuralı (büyük harf, rakam, sembol zorunluluğu) yok; periyodik zorunlu değişim yok.
- Reddedilenler: yaygın parola listesi (depoda tutulan yerel liste; dış servis yok), e-postanın kendisi veya yerel kısmı, kurum adı, `kampus` türevleri.
- Yapıştırma ve parola yöneticisi engellenmez; "parolayı göster" düğmesi bulunur (WCAG 3.3.8).
- Ele geçirildiği bilinen parola için yönetici zorunlu sıfırlama başlatabilir.

## 3. Oturum ve yenileme belirteci

| Belirteç | Biçim                                 | Ömür                                 | Saklama                                                                                                                                              |
| -------- | ------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Erişim   | JWT (`jose`), `EdDSA`, başlıkta `kid` | 15 dk                                | Web: yalnız bellek. Mobil: yalnız bellek.                                                                                                            |
| Yenileme | 32 bayt rastgele, base64url           | 30 gün kayan, en fazla 90 gün mutlak | Web: `__Host-kampus_rt` çerezi (`HttpOnly; Secure; SameSite=Strict; Path=/`). Mobil: `expo-secure-store`. Sunucu: SHA-256 özeti `refresh_tokens`'da. |

- JWT talepleri: `sub` (kullanıcı), `iid` (kurum), `mid` (üyelik), `iat`, `exp`, `jti`. Rol ve kapsam belirtece yazılmaz; her istekte üyelikten okunur. Böylece rol değişikliği ve üyelik iptali anında etkili olur.
- Yenileme her kullanımda döner (rotation): eski belirteç iptal edilir, aynı aileden (`family_id`) yenisi verilir. İptal edilmiş bir belirteç tekrar gelirse bütün aile iptal edilir, `auth.refresh_reuse` olayı `warn` ile loglanır ve denetim kaydına yazılır.
- Yenileme ucu (`POST /api/v1/auth/refresh`) çerezle çalıştığı için `Origin` başlığı izinli kaynaklarla eşleşmek zorundadır (CSRF). Diğer uçlar çerez değil `Authorization: Bearer` kullandığı için CSRF'ye açık değildir.
- Çıkış aileyi iptal eder; "Bütün cihazlardan çık" kullanıcının bütün ailelerini iptal eder.
- İmzalama anahtarları ortamdan gelir; iki anahtar aynı anda geçerli olabilir (döndürme sırasında eski `kid` 15 dk daha doğrulanır).

## 4. Hız sınırlama

`@fastify/rate-limit`, 429 + `Retry-After` + `rate_limited`.

| Uç                          | Sınır                                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| `POST /auth/login`          | IP başına 10/dk; hesap başına 5 başarısız/15 dk → 15 dk artan gecikme |
| `POST /auth/password-reset` | E-posta başına 3/saat, IP başına 10/saat                              |
| `POST /auth/refresh`        | Aile başına 30/dk                                                     |
| Kimlikli diğer uçlar        | Kullanıcı başına 300/dk                                               |
| İçe aktarma ve dışa aktarma | Kullanıcı başına 10/dk                                                |

- Hesap kalıcı kilitlenmez (kötü niyetli kişi veliyi kilitleyemesin); artan gecikme uygulanır.
- v1 tek sunucu örneğinde bellek içi sayaç; birden çok örnekte paylaşılan depo gerekir (dağıtım ADR'sinde).

## 5. CORS, CSP ve güvenlik başlıkları

- CORS: izinli kaynaklar `CORS_ORIGINS` ortam değişkeninden tam eşleşmeyle; `*` yok. `credentials: true` yalnız web kaynağına. Mobil yerel istemci CORS'a tabi değildir.
- API (`@fastify/helmet`): `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` (kişisel veri içeren yanıtlarda).
- Web CSP (statik sunucuda başlık olarak):

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:;
font-src 'self'; connect-src 'self' https://<api-kökü>; worker-src 'self' blob:;
frame-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self';
form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

- `unsafe-inline` ve `unsafe-eval` yok; satır içi stil gereken kitaplık ADR ister. CSP önce `Content-Security-Policy-Report-Only` ile denenir.
- `Permissions-Policy: camera=(), geolocation=(), microphone=(self)` (konuşma becerisi kaydı için yalnız kendi kaynağımız).

## 6. Kiracı izolasyonu

- Kurum kimliği yalnız doğrulanmış belirteçten (`request.ctx.institutionId`) gelir. Gövde, sorgu, yol veya başlıktaki kurum kimliği okunmaz; şema bu alanı reddeder.
- Bütün veritabanı erişimi kurum kapsamlı depo fonksiyonlarından geçer; ilk parametre `institutionId`'dir. Serviste ham `db.select()` ile kurum filtresi olmayan sorgu yazılmaz.
- Başka kuruma ait kayıt 404 döner (403 değil; varlık sızdırılmaz).
- Dosya depolama anahtarları `<institution_id>/` önekiyle başlar; indirme bağlantıları kısa ömürlü ve kurum kapsamlı imzalıdır.
- Önbellek anahtarları, arka plan işleri ve dışa aktarmalar kurum kimliğini açıkça taşır.
- Kurumlar arası işlem (platform bakımı) API'den yapılmaz; ayrı komut satırı betiğiyle ve denetim kaydıyla yapılır.
- Ek savunma olarak PostgreSQL satır düzeyi güvenliği (RLS) değerlendirilecek (açık soru, ADR).

## 7. Rol ve kapsam yetkisi

- Roller: `yonetici`, `onburo`, `ogretmen`, `ogrenci`, `veli`. Varsayılan ret: rol listesi bildirmeyen rota kayıt edilemez.
- Rota düzeyi: `requireRole([...])` ve `requireModule('<modül>')`. Kayıt düzeyi: school-core kapsam fonksiyonları (öğretmen kendi sınıfları/branşı, öğrenci kendisi, veli kendi çocukları). API kapsamı ikinci kez elle yazmaz.
- Alan düzeyi: rehberlik iç notu, sağlık bilgisi, finans ayrıntısı yalnız yetkili role dönen yanıt şemasında bulunur; ortak şemaya "gizle" bayrağıyla eklenmez.
- Veli, çocuğu adına haklarını kullanır; çocukla bağı `memberships` + öğrenci ilişkisiyle sunucuda doğrulanır.
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
- **İşleme şartı** her veri kategorisi ve amaç için belirlenir (sözleşme, hukuki yükümlülük, meşru menfaat, açık rıza). Açık rıza yalnız başka şart yoksa kullanılır (hukuk onayı).
- **Açık rıza** gerekiyorsa: belirli amaca özgü, ayrı onay kutusu, önceden işaretli değil, hizmet şartına bağlanmamış; reddetmek temel eğitim hizmetini engellemez. Reşit olmayan için veli verir.
- Rıza kaydı: `consents` (kurum, veri sahibi, veren kullanıcı, amaç kodu, metin sürümü, kanal, `given_at`, `withdrawn_at`). Geri çekme verildiği kadar kolaydır (aynı ekranda tek işlem) ve ilgili işleme hemen durur.
- Metin değişince yeni sürüm yayımlanır; eski sürüme verilmiş rıza yeni amacı kapsamaz.
- Yurt dışına aktarım (m.9): barındırma, yedek, e-posta/SMS sağlayıcısı ve mobil anlık bildirim servisleri (FCM/APNs) aktarım riski taşır; her biri ADR'de değerlendirilir (açık soru).

## 10. Saklama ve silme

- Her koleksiyon/tablo için saklama süresi ve imha yöntemi bir saklama ve imha tablosunda tutulur; tablo hukuk onayıyla `docs/muhendislik/saklama-imha.md` olarak yazılacak (açık soru). Mühendislik varsayılanı: arşivlenen kayıt süre dolana kadar saklanır, sonra silinir veya anonimleştirilir.
- İmha işi zamanlanmış çalışır; periyodik imha aralığı 6 ayı geçmez (Kişisel Verilerin Silinmesi, Yok Edilmesi veya Anonim Hale Getirilmesi Hakkında Yönetmelik). Her imha `audit_log`'a ve imha tutanağına yazılır.
- Anonimleştirme geri döndürülemez olmalıdır: ad, iletişim, kimlik alanları silinir; istatistik için yalnız toplu değerler kalır.
- Teknik kayıtlar: `refresh_tokens` süresi dolunca 7 gün sonra, `idempotency_keys` 24 saat sonra, uygulama logları 90 gün sonra silinir. `audit_log` saklama süresi hukuk onayıyla belirlenir (öneri 2 yıl).
- Yedekler aynı saklama süresine uyar; silinen veri yedek dönüşü sonunda yedekten de çıkar.
- Kurum sözleşmesi bitince kurum verisi dışa aktarılıp teslim edilir, sonra sözleşmedeki sürede silinir.

## 11. Veri sahibinin hakları (KVKK m.11)

- Haklar: işlenip işlenmediğini öğrenme, bilgi isteme, amaç ve aktarılan taraflar, düzeltme, silme/yok etme, itiraz, zararın giderilmesi. Başvuru veri sorumlusuna (kuruma) yapılır; platform kuruma araç sağlar.
- Kurum yöneticisi için araçlar: kişinin bütün verisini makine okunur (JSON) ve okunur (PDF) dışa aktarma, alan düzeltme, silme/anonimleştirme, talebi `data_subject_requests` tablosunda izleme (alınma, yanıt, sonuç).
- Yanıt süresi en geç 30 gündür (m.13); talep kaydı bu süreyi gösterir ve 20. günde yöneticiyi uyarır.
- Veli, reşit olmayan çocuğu adına başvurur; çocuk reşit olunca kendi hesabıyla başvurur.
- Silme, hukuki saklama yükümlülüğü olan kayıtları (finans belgeleri gibi) kapsamıyorsa ret gerekçesi kayda yazılır.

## 12. Gizli anahtar yönetimi

- Bütün gizli değerler ortam değişkenindedir: `DATABASE_URL`, `JWT_PRIVATE_KEYS`, `FIELD_ENCRYPTION_KEY`, `CORS_ORIGINS`, SMTP bilgileri. `config.ts` başlangıçta doğrular; eksikse süreç başlamaz.
- `.env` commit edilmez; `.env.example` yalnız yer tutucu değerle güncel tutulur.
- Üretim sırları sunucunun sır deposunda/ortamında; nasıl tutulacağı dağıtım ADR'sindedir. Geliştirme ve test sırları üretimden farklıdır.
- Anahtar döndürme: JWT anahtarı yılda bir ve personel ayrılığında; alan şifreleme anahtarı sürümlü (`key_version` kolonu) döndürülür.
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
