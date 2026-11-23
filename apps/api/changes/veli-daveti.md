---
etki: minor
---

Veli hesabı daveti (OG-1003; iş isteği #32; DOM-YTK-071).

- Uç `POST /api/v1/institution-members/guardian-invitations` (`inviteGuardianAccount`): yönetici ve ön büro (diğer roller 403), taze oturum, `Idempotency-Key` zorunlu; başarı 201 + `Location`. Gövde core `guardianInvitationInputSchema` (e-posta, ad, 1–10 benzersiz `studentIds`, isteğe bağlı `parentId`). Yanıt `GuardianInvitation` (`id`, `name`, `email`, `role: 'veli'`, `status`, `studentIds`, `parentId`, `createdAt`, `expiresAt`).
- Yeni e-postada kullanıcı (parolasız), `veli` üyeliği, her öğrenci için `membership_links` `child` ve `parentId` verilmişse o veli kaydının seçilen öğrencilerdeki `student_guardians` bağlarının `membership_id`'si tek transaction'da yazılır; parola belirleme bağlantısı personel davetindeki `staff.password-link` işiyle yanıtı beklemeden gider. `parentId` verilmezse velayet bağı yazılmaz; çocuk bağlantısı tek başına kapsam vermez, velayet bağ ucuyla kurulur.
- Başka kurumda hesaplı e-postada (karar 73) yalnız bekleyen davet yazılır; öğrenciler ve veli kaydı davette saklanır, yanıt ve denetim alanları yeni hesaptakiyle aynıdır.
- Hatalar: olmayan, arşivli ya da başka kurumun öğrencisi veya veli kaydı 404; 409 `member_exists`, `invitation_exists`, `guardian_link_exists` (bağ başka hesaba bağlı ya da veli kaydı bekleyen bir veli davetinde); 422 `guardian_record_not_linked`, `guardian_identity_mismatch`.
- Migration `0055_invitation_guardian`: `invitations.student_ids` (jsonb) ve `invitations.parent_id` (text); Better Auth `invitation.additionalFields`.
- Personel davet listesi (`GET /institution-members/invitations`) yalnız personel rollerini listeler ve sayar; personel davet iptali veli davetini bulmaz (404): davetle açılan üyelik silinirse velayet bağı da silinirdi.
- react-shared `useInviteGuardianAccount()` (`use-guardian-invitations.ts`); başarıda üye, davet ve veli bağı (`student-guardians`) sorguları geçersiz kılınır.

Bekleyen veli davetleri ve süre (OG-1003 inceleme düzeltmesi; DOM-YTK-071).

- `GET /api/v1/institution-members/guardian-invitations` (`listGuardianInvitations`): kurumun bekleyen veli davetleri, yeni önce, `page`/`pageSize`, `meta.total`; öğe `GuardianInvitation`. Yönetici ve ön büro (diğer roller 403). Süresi dolmuş ama hâlâ `pending` davet de listelenir.
- `POST /api/v1/institution-members/guardian-invitations/{invitationId}/cancel` (`cancelGuardianInvitation`): yönetici ve ön büro, taze oturum, `Idempotency-Key` isteğe bağlı; 200 ve `GuardianInvitation` (`canceled`). Olmayan, başka kurumun ya da personel daveti 404; bekleyen olmayan davet 409 `invitation_not_pending`. Yalnız daveti kapatır: davetle açılmış hesap, üyelik, çocuk bağlantıları ve velayet bağının hesabı korunur (üyelik silinseydi `student_guardians.membership_id` zinciriyle velayet bağı da silinirdi). Denetim eylemi `guardian.invite_cancel` (yalnız `status`).
- Veli ve personel davetlerinde `invitation_exists`, `guardian_link_exists` (veli kaydı), `teacher_invitation_pending` ve toplu aktarımdaki bekleyen e-posta denetimi süresi dolmuş daveti saymaz; böylece başka kurumda hesaplı e-posta ve veli kaydı süresiz kilitli kalmaz.
- Veli davet ucu `routes/guardian-invitations.ts` dosyasına (`registerGuardianInvitationRoutes`, `PLATFORM_LATE_ROUTES` sonu) taşındı; yeni core yetkileri `guardian.invite_list` ve `guardian.invite_cancel`.
- Migration yeniden üretildi: `0055_invitation_guardian` entegrasyondaki `0054_allow_feedback_audio` sonrasına alındı (günlük sırası 55).
- react-shared `useGuardianInvitations(page)` ve `useCancelGuardianInvitation()`.
