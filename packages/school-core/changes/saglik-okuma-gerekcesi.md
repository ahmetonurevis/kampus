---
etki: minor
---

- Sağlık verisi okuma gerekçesi kuralı eklendi (`lib/finance-health-access.ts`, DOM-FIN-156, ON-164): gerekçe kodu (acil durum, ilk yardım / revir işlemi, veli görüşmesi, tutanak hazırlama, resmî talep, diğer) ve yalnız "diğer"de 5–200 karakter açıklama (`healthAccessReasonSchema`); kodlu gerekçede açıklama reddedilir (K-523).
- `healthAccessReasonHeaders`, `parseHealthAccessReasonHeaders`: gerekçe `X-Access-Reason` ve yüzde kodlu `X-Access-Reason-Note` başlıklarıyla taşınır; eksikte `health_access_reason_required`, bozukta `health_access_reason_invalid` (K-523).
- `healthAccessReasonRequired`: personelden gerekçe istenir, veli ve öğrenciden istenmez; `rememberedReasonValid`: istemcide seçilen gerekçe 15 dakika geçerli (K-525). `HEALTH_ACCESS_ACTION_LABELS`: erişim günlüğündeki kayıt türleri (K-524).
