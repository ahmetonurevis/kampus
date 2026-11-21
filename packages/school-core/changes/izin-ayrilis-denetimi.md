---
etki: minor
---

- Ayrılış, etkinlik günü ayrılış günü olan yedek ve izin bekleyen katılımı da iptal eder (`withdrawStudentWithFollowups`, K-418); asil katılımın sınırı değişmez (K-348).
- Etkin olmayan öğrenciye izin kaydedilmez (`applyConsentGrant`, `ConsentParticipation.studentActive`, 422 `paid_activity_student_inactive`; bağlamda isteğe bağlı `institutionType`). `planConsentSync` üçüncü parametre olarak `{ today, activityDate }` ister ve etkin olmayan öğrencinin taksitsiz katılımlarını `inactive` listesinde verir (K-418).
- Ayrılıştan kalan katılımlar: `isWithdrawnLeftover`, `planWithdrawnLeftoverCancel`, `cancelWithdrawnLeftoversSchema`, `WITHDRAWN_LEFTOVER_CANCEL_MAX` (K-419).
