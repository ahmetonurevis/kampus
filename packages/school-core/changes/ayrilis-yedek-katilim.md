---
etki: minor
---

- Ayrılış yedek ve izin bekleyen etkinlik katılımlarını iptal eder (`withdrawStudentWithFollowups`, K-395): etkinlik günü ayrılış gününden sonraysa katılım parasız kapanır, dökümde satır açmaz. `WithdrawalActivityParticipation.invoiceId` boş olabilir; `WithdrawalActivityCancel` `activityId` ve yer boşalttığını söyleyen `freesSeat` taşır.
- Yedekten geçiş etkin olmayan öğrenciyi atlar (`promotionCandidates`, K-396): `WaitlistEntry.studentActive` `false` ise sıradaki yedek geçer; alan verilmezse öğrenci etkin sayılır.
