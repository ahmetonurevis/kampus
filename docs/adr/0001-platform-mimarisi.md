# ADR 0001 · Çevrimdışı demodan çok kurumlu platforma geçiş

- Durum: Kabul edildi (2026-10-30); karar 6 kimlik tabloları ve karar 7 ADR 0002 ile değişti; karar 4'ün kurum türleri ADR 0008 ile `course_center` (kurs) türüyle genişledi
- Karar veren: Oğuzhan Demirci

## Bağlam

Kampüs bugüne kadar backend'siz bir demoydu: veri tarayıcıda (localStorage) ve telefonda (AsyncStorage) tutuluyor, web Vue 3 ile, mobil React Native ile yazılıyor, kod JavaScript. İş kuralları platformdan bağımsız olarak `packages/school-core` içinde.

Yeni hedef: dil okulları ve özel okullar için okul–veli–öğrenci arasında köprü kuran, okulun kendi kaynak platformunu oluşturan ve yayınevi/üçüncü taraf dijital platform bağımlılığını azaltan bir platform. İngilizcede okuma-anlama, dinleme, yazma ve konuşma becerilerini; diğer derslerde ders ve kazanım odaklı çalışmayı destekler. Sıradan bir LMS'ten fazlasıdır.

## Kararlar

1. **Monorepo** pnpm workspaces ile sürer:
   - `apps/api` — Fastify 5 + TypeScript, PostgreSQL 16, Drizzle ORM ve drizzle-kit migration'ları.
   - `apps/web` — React 19 + TypeScript + Vite. Vue uygulamasının yerini alır (bkz. 5).
   - `apps/mobile` — Expo SDK 57 + React Native + TypeScript.
   - `packages/school-core` — TypeScript; iş kuralları, Zod şemaları, rol/modül kaydı, örnek veri. Web, mobil ve API aynı kuralları çalıştırır.
   - `packages/api-client` — çatıdan bağımsız, tipli HTTP istemcisi (oturum yenileme dahil).
   - `packages/react-shared` — web ve mobilin ortak React hook'ları (veri sorguları, oturum, form durumu).
2. **TypeScript her yerde**, `strict`. Node 24 tür ayıklamasıyla `.ts` doğrudan çalışır; bu yüzden yalnız silinebilir sözdizimi kullanılır (`erasableSyntaxOnly`: enum, namespace, parametre özelliği yok) ve göreli içe aktarmalar `.ts` uzantılıdır.
3. **Çevrimdışı demo modu kaldırılır.** Web ve mobil veriyi yalnız API üzerinden okur/yazar. Demo, sunucudaki örnek kurumlarla yapılır: `Akademi Özel Okulları` (okul) ve `Kampüs Dil Akademisi` (dil okulu); her rol için demo kullanıcısı `pnpm --filter @kampus/api db:seed` ile kurulur.
4. **Çok kurumlu yapı.** Her kayıt bir kuruma (`institution_id`) aittir; kurum kimliği yalnız doğrulanmış oturumdan gelir. Kurum türü `school` (ders + kazanım) veya `language_school` (CEFR Pre-A1, A1–C2 ve A2+/B1+/B2+ artı seviyeleri + beceri). İngilizce beceri modülleri iki türde de çalışır.
5. **Web React'e taşınır.** Yeni uygulama geçiş süresince `apps/web-react` (`@kampus/web-react`) altında, API üzerine yazılır. Mevcut Vue uygulaması (`apps/web`) eşitlik sağlanana kadar davranış referansı olarak kalır ve TypeScript'e taşınmaz. Mevcut e2e senaryoları erişilebilir rol/etiket seçicileri kullandığı için yeni uygulamanın kabul testleri olur. Eşitlikten sonra Vue silinir ve `apps/web-react` → `apps/web` olur.
6. **Veri modeli (v1):** kimlik ve kiracı çekirdeği ilişkisel tablolardır (`institutions`, `users`, `memberships`, `refresh_tokens`). Okul verisi `records` tablosunda tutulur: `(institution_id, collection, id)` birincil anahtar, `data jsonb`, `version`, zaman damgaları, `archived_at`. API, işlem için gereken koleksiyonları kurum kapsamında yükler, school-core işlemini çalıştırır, değişen kayıtları sürüm kontrolüyle tek veritabanı işleminde yazar. Bu, mevcut bütün iş kurallarını yeniden yazmadan sunucuya taşır. Büyüyen koleksiyonlar (yoklama, not, ödeme) ölçüm gerektirdiğinde kendi tablolarına normalleştirilir; her biri ayrı ADR.
7. **Kimlik doğrulama:** e-posta + parola (`node:crypto` scrypt), kısa ömürlü JWT erişim belirteci (`jose`) ve veritabanında özeti tutulan, her kullanımda yenilenen yenileme belirteci. Web yenileme belirtecini httpOnly çerezde, mobil güvenli depoda tutar. Yetki: rol + kapsam (öğretmen kendi sınıfları/branşı, öğrenci kendisi, veli kendi çocukları) sunucuda school-core kapsam kurallarıyla.
8. **Dosya ve medya** bir depolama arayüzünün arkasında: v1 yerel disk (`STORAGE_DIR`), sonra S3 uyumlu (MinIO). Dış SaaS bağımlılığı eklenmez.
9. **Test:** API testleri `app.inject` ile; veritabanı testlerde PGlite (süreç içi PostgreSQL), geliştirmede Docker Compose ile PostgreSQL 16. E2E: Playwright, API + web birlikte, test ortamında her test kendi kurumunu kurar.

## Sonuçlar

- İş kuralları tek yerde kalır; API güvenliği sunucu tarafında uygulanır.
- `demo.onurevis.com` statik yayını backend'siz eski demoya aittir; API yayını ayrı bir ADR ile planlanır. O zamana kadar canlı demo güncellenmez.
- Geçiş sırası: TS araç zinciri → school-core TS → API iskeleti, kimlik, kiracı ve kayıt deposu → api-client ve react-shared → React web (modül modül, e2e ile) → mobil TS + API → demo kalıcılığının ve Vue uygulamasının silinmesi → yeni ürün modülleri.

## Değerlendirilen alternatifler

- NestJS: daha katı yapı ama daha ağır; Fastify + katman kuralları yeterli.
- Supabase: hızlı başlangıç ama dış servise bağımlılık hedefle çelişir.
- Vue'da kalmak: yeniden yazma maliyeti yok ama web ve mobil farklı çatılarda kalır. Web her dosyasıyla zaten elden geçeceği için geçişin en ucuz anı bu.
- Expo Router ile tek kod tabanı (react-native-web): en fazla paylaşım, ama yoğun tablo, PDF önizleme ve klavye ağırlıklı yönetim paneli için DOM tabanlı React daha uygun.
- Her koleksiyon için baştan ilişkisel tablo: en temiz şema ama 30+ koleksiyonun ve bütün kuralların yeniden yazılmasını gerektirir; v1'de `records` + kademeli normalleştirme seçildi.
