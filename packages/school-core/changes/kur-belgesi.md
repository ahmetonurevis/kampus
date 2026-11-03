---
etki: minor
---

- Kurum başarı belgesi kuralları eklendi (OG-088; IST-081, DOM-DIL-081, DOM-DIL-082): `cefr/certificates.ts` `planCertificateIssue` belgeyi yalnız kaydın geçerli onaylı `geçti` kararıyla düzenler (onay bekleyen, tekrar ve devamsızlık kararında 422), içeriği düzenleme anının kopyası olarak üretir (kur adı, toplam ders saati, devam, "kurum değerlendirmesine göre CEFR B1 düzeyinde" seviye ifadesi, kur sonu beceri puanları) ve "CEFR sertifikası", "Avrupa Konseyi" gibi ifadeleri reddeder. `planCertificateCancellation` gerekçeli ve bir kez iptal eder; iptal edilen belgenin yerine `replacesCertificateId` ile yeni numaralı belge düzenlenir. `formatCertificateNumber`, `formatVerificationCode` (140 bit Crockford base32), `normalizeVerificationCode` ve yalnız baş harf, kur, gün, durum ve kurum adı taşıyan `certificateVerificationView` eklendi.
