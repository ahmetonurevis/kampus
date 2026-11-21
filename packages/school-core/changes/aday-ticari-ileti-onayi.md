---
etki: minor
---

- Adayın ticari ileti onayı kanal bazlı verilebilir ve anında geri alınabilir (ON-008; DOM-KAY-004): `setProspectMarketingConsent`, `setMarketingConsentSchema` ve `hasMarketingConsent` eklendi. Her değişiklik `marketingConsentHistory` olayı olarak kalıcı yazılır (`MarketingConsentEvent`); aşamadan bağımsızdır, aynı karar 409 `marketing_consent_unchanged`, e-postasız adayda e-posta onayı 422 `consent_contact_missing`. `prospect.consent` yazma eylemi `yonetici` ve `onburo`dur; öğretmene geçmiş görünmez.
