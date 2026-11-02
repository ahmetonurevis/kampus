---
etki: minor
---

Veli–öğrenci bağı tablosu (OG-031; IST-019, DOM-ILT-070…075).

- Migration `0027_create_student_guardians`: `student_guardians` (veli kaydı `parent_id` ve/veya hesap `membership_id`, yakınlık, velayet, `is_contact_restricted`, `is_payer`, `is_pickup_authorized`); tek ödeyici `student_guardians_payer_key`, kısıtlı veli kısıtı `student_guardians_restriction_check`, öğrenci–veli tekilliği. Geri doldurma: etkin `membership_links` `child` bağlantıları velayetli (`full`), kısıtsız, `other` yakınlıkla bağ olur.
- Depo `db/student-guardians.ts`; `ensureMembershipLinks` veli bağlantısında varsayılan velayetli bağı da açar. Demo tohumu örnek bağları yazar ve yeni demo velisi Kemal Yılmaz'ı (velayetsiz, kısıtlı, çocuk bağlantısız) ekler.
- Uçlar `GET`, `POST /api/v1/students/:studentId/guardians` ve `PATCH`, `DELETE /api/v1/students/:studentId/guardians/:linkId` (`listStudentGuardians`, `linkStudentGuardian`, `updateStudentGuardian`, `unlinkStudentGuardian`): yönetici ve ön büro bağları kurar, değiştirir, kaldırır (arşiv) ve hepsini görür; veli yalnız kendi bağını kısıt alanı olmadan görür, bağsız ya da kısıtlı veli 404 (DOM-ILT-073). Oluşturma `Idempotency-Key` zorunlu (201 + `Location`), düzenleme ve kaldırma `If-Match` zorunlu; denetime yalnız alan adları (`guardian.link`, `guardian.update`, `guardian.unlink`). OpenAPI şemaları `StudentGuardian`, `StudentGuardianListItem`.
- Rıza velayeti artık bağ tablosundan okunur: velayeti olmayan ya da iletişim kısıtlı veli rıza veremez, 403 `consent_custody_required` (DOM-YTK-057; geçici "her bağlı veli velayetli" kuralı kalktı). Okuma kapsamı henüz üyelik bağlantısındadır (OG-032).
