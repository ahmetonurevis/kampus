---
etki: minor
---

- Veli hesabı daveti kuralları eklendi (DOM-YTK-071; `lib/guardian-invitations.ts`): `guardianInvitationInputSchema` (e-posta ≤ 254, ad 2–120, 1–10 benzersiz `studentIds`, isteğe bağlı `parentId`; katı) ve `planGuardianInvitation`. Kurumda kayıtlı e-posta 409 `member_exists`, bekleyen davet 409 `invitation_exists`; veli kaydı seçilen öğrencinin velisi değilse 422 `guardian_record_not_linked`, kaydın bağı başka hesaba bağlıysa ya da kayıt bekleyen bir veli davetinde tutuluyorsa 409 `guardian_link_exists`, kayıt başka öğrencide başka hesapla eşlenmişse 422 `guardian_identity_mismatch`. Veli kaydı verilmezse velayet bağı yazılmaz; çocuk bağlantısı tek başına kapsam vermez.
- Yeni yazma eylemi `guardian.invite` (yönetici ve ön büro; modülsüz platform yeteneği). `lib/guardianship.ts` `requireSameGuardian` dışa açıldı.
