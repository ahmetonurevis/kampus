---
etki: minor
---

- Ödeyici velinin finans kapsamı (OG-1002, iş isteği #33, K-04 kullanıcı kararı 2026-11-03; DOM-ILT-074): ödeyici bağı aktöre ayrı bağlantı türüyle (`{ kind: 'payer', recordId: <öğrenci> }`, `ACTOR_LINK_KINDS`) taşınır. `lib/guardianship.ts` `payerActorLinks` yalnız ödeyici, iletişim kısıtı olmayan ve çocuk bağlantısı bulunan öğrenciye bağlantı kurar; `scopedActorLinks` velayet bağlantılarıyla (`guardedActorLinks`) birleştirir. `scopeFor` bu bağlantıyı yalnız veli rolünde `payerStudentIds` kümesine alır; `studentIds`, `classIds` ve onlara dayanan akademik, iletişim ve rıza kapsamı değişmez. Finans kuralı için yapı taşları: `payerStudent`, `ownOrPayerStudent`, `FINANCE_PERSONAL` (`modules/scope-builders.ts`) ve `financeStudentIds(scope)`.
- Finans bildirimleri (`installment_due`, `installment_overdue`, `payment_received`, `refund_paid`; `PAYER_NOTIFICATION_KINDS`) ödeyici velinin de bildirimidir: `canSeeNotification` ve `notifications` okuma kuralı ödediği öğrencinin finans türü veli bildirimini açar (`payerNotificationStudentIds`). Diğer türlerin alıcısı değişmez; iletişim kısıtlı veli almaz.
