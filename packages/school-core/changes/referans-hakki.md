---
etki: minor
---

- Referans indirimi hakkı (ON-139; DOM-FIN-024): `lib/finance-referrals.ts`. Veli referansıyla gelen aday kesin kayda alınınca hak açılır, ilk taksit ödenince doğar, sonraki kesin kayıt ya da yenilemede `referralRewardId` ile bir kez kullanılır; `referral` kalemi artık yalnız hakla seçilir ve tavanı aşan kısmı düşer. Öğretim başlamadan iade alan kaydın kullanılmamış hakkı iptal olur. Yeni bildirim türü `referral_reward_earned`.
