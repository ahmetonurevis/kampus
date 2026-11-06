---
etki: minor
---

Siteye gömülen ön başvuru formu kuralları: `lib/prospect-application-form.ts` (`prospectApplicationSchema`, `submitProspectApplication`, `updateApplicationFormSchema`, `siteOriginSchema`); `lib/prospects.ts` `requireValidNewProspect` ve `buildProspect` dışa açıldı (ON-133; DOM-KAY-002, -003, -009).

Formda işaretlenen ticari ileti kanalı `verified: false` yazılır ve onay sayılmaz: `hasMarketingConsent` bunu dışarıda bırakır, `hasUnverifiedMarketingConsent` eklendi. `setProspectMarketingConsent` doğrulanmamış seçimde iki kararı da kabul eder: `granted: true` işareti kaldırır (`MarketingConsentEvent.verified: true`), `granted: false` geri alır. Alanı olmayan eski onaylar doğrulanmış sayılır (DOM-KAY-004).
