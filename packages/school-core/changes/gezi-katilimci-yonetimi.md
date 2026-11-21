---
etki: minor
---

- Gezi katılımcı yönetimi eklendi (`lib/finance-paid-activity-participants.ts`, DOM-FIN-112, K-369…K-371): kontenjan doluyken katılım sıra numarasıyla yedeğe yazılır (taksit yok), yer açılınca en küçük numaralı yedek otomatik asile geçer ve taksiti o anda açılır; veli izni isteyen etkinlikte asil "izin bekliyor" olur, taksit izinle açılır, izin geri çekilir ya da formda reddedilirse katılım K-302 kuralıyla iptal edilir; sınıf seçerek toplu katılım; maskeli veli telefonlu katılım listesi CSV'si.
- `lib/finance-paid-activities.ts`: katılım durumları `awaiting_consent` ve `waitlisted`, iptal türü `consent`, izin durumları ve kanalları, ödeme durumu `not_billed` eklendi; etkinlik şeması `requiresConsent` ve `permissionFormId` alır. `applyPaidActivityJoin` kontenjan doluyken 409 `paid_activity_full` yerine yedek yazar (yedek listesi doluysa 409 `paid_activity_waitlist_full`); `applyParticipationCancel` taksiti olmayan katılımı parasız kapatır.
