---
etki: minor
---

- Kampanya kodu eklendi (DOM-KAY-041, ON-134): `lib/prospect-campaigns.ts` kod biçimi (büyük harf, 3–20 karakter), tanım ve düzeltme şemaları, kanal → kaynak önerisi ve kampanya geçerliliği (`requireUsableCampaign`) kurallarını taşır. Aday açılırken `campaignCode` girilirse aday kampanyaya bağlanır (`campaignId`, `campaignCode`); kod bulunamazsa, pasifse ya da tarih aralığı dışındaysa 422.
- Aday `Teklif verildi` aşamasına ilk geçişte `offeredAt` izini alır; aşama teklif aşamasından geri alınınca iz silinir.
- Kayıt hunisinin kampanya kırılımı eklendi (`lib/enrollment-campaign-funnel.ts`): aday → görüşme → teklif → kesin kayıt, dönüşüm oranı, aday başı ve kayıt başı maliyet, CSV.
