---
etki: minor
---

- Personel hesabı kuralları eklendi (IST-007, DOM-YTK-070; `lib/staff-accounts.ts`): `STAFF_ROLES` (yönetici, öğretmen, ön büro), davet ve rol değişikliği girdi şemaları (`staffInvitationInputSchema`, `staffRoleChangeInputSchema`; öğretmen kaydı yalnız öğretmen rolünde bağlanır), `planStaffRoleChange` ve `planStaffActivation`. Kişi kendi rolünü değiştiremez, kendini pasifleştiremez ve geri alamaz (422 `self_reactivate`); kurumdaki son etkin yönetici düşürülemez ve pasifleştirilemez (422 `last_admin`); pasif hesabın rolü değişmez; öğrenci ve veli hesapları bu kurallarla yönetilmez (422 `member_not_staff`). Davette kurumda kayıtlı e-posta, bekleyen davet ve başka hesaba bağlı öğretmen kaydı 409'dur.
- Personel daveti (karar 73): e-postanın başka kurumda hesabı varsa üyelik açılmaz, parola bağlantısı gönderilmez, yalnız bekleyen davet yazılır; yanıt yeni hesaptakiyle aynı biçimdedir ve yöneticinin girdiği adı taşır. Davet görünümünden `membershipId` kaldırıldı.
