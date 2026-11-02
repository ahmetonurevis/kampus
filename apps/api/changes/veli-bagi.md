---
etki: minor
---

Veli–öğrenci bağı tablosu (OG-031; IST-019, DOM-ILT-070…075).

- Migration `0027_create_student_guardians`: `student_guardians` (veli kaydı `parent_id` ve/veya hesap `membership_id`, yakınlık, velayet, `is_contact_restricted`, `is_payer`, `is_pickup_authorized`); tek ödeyici `student_guardians_payer_key`, kısıtlı veli kısıtı `student_guardians_restriction_check`, öğrenci–veli tekilliği. Geri doldurma: etkin `membership_links` `child` bağlantıları velayetli (`full`), kısıtsız, `other` yakınlıkla bağ olur.
- Depo `db/student-guardians.ts`; `ensureMembershipLinks` veli bağlantısında varsayılan velayetli bağı da açar. Demo tohumu örnek bağları yazar ve yeni demo velisi Kemal Yılmaz'ı (velayetsiz, kısıtlı, çocuk bağlantısız) ekler.
