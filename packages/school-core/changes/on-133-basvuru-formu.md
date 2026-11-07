---
etki: minor
---

Siteye gömülen ön başvuru formu kuralları: `lib/prospect-application-form.ts` (`prospectApplicationSchema`, `submitProspectApplication`, `updateApplicationFormSchema`, `siteOriginSchema`); `lib/prospects.ts` `requireValidNewProspect` ve `buildProspect` dışa açıldı (ON-133; DOM-KAY-002, -003, -009).

Formda işaretlenen ticari ileti kanalı `verified: false` yazılır ve onay sayılmaz: `hasMarketingConsent` bunu dışarıda bırakır, `hasUnverifiedMarketingConsent` eklendi. `setProspectMarketingConsent` doğrulanmamış seçimde iki kararı da kabul eder: `granted: true` işareti kaldırır (`MarketingConsentEvent.verified: true`), `granted: false` geri alır. Alanı olmayan eski onaylar doğrulanmış sayılır (DOM-KAY-004).

Form notu sınırları metinden bağımsız yapıldı: aday başına 24 saatte bir, 30 günde en çok 20, kartta toplam en çok 100; nottaki ad ve ilgi 40 karakterle sınırlandı (DOM-KAY-002). Kurum başına günlük aday tavanı `APPLICATION_DAILY_PROSPECT_LIMIT` eklendi.

Kurum tavanı doluyken alınamayan başvuruların günlük sayımı `APPLICATION_DAILY_REJECTED_LIMIT` ile sınırlandı (DOM-KAY-002, K-23).
