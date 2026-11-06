---
etki: minor
---

- Yenileme daveti kuralları eklendi (ON-056, K-10, IST-100; DOM-KAY-027): `lib/renewal-invitations.ts` (`planRenewalInvitations`, `planRenewalInvitationResponse`, `renewalInvitationStatus`, `renewalInvitationAccess`, `invitableStudentIds`). Yanıt niyet beyanıdır, sözleşme, taksit ve sınıf yazmaz; durum yanıt ve yenileme kaydından türer.
- `renewal_invited` bildirim türü eklendi: `lib/finance-notifications.ts` `RENEWAL_NOTIFICATION_TYPES` (hizmet bildirimi, `renewal` modülü, veri yalnız `invitationId`), `modules/notification-types.ts` Onur bloğunda birleşir. Ödeyici bağının açtığı tür listesi (`PAYER_NOTIFICATION_KINDS`) değişmedi.
