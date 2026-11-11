---
etki: minor
---

- `lib/consents.ts`'e `consentGrantor` eklendi: amaçta rızayı kimin verdiği (`self`, `guardian`, 18 yaş altı öğrenci hesabında `null`) `isAdultStudent` ile hesaplanır; doğum tarihi bilinmiyorsa veli verir (DOM-YTK-057).
- `mayWithdrawConsent` eklendi: geri çekme yetkisi (veren ya da şu anda rıza verebilecek kişi; itiraz ve hesap rızası yalnız veren) tek yerde; `planConsentWithdrawal` bunu kullanır, davranışı değişmedi (DOM-YTK-059, DOM-YTK-062).
