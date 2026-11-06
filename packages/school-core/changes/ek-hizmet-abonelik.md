---
etki: minor
---

- Ek hizmet aboneliği kuralları eklendi (ON-087; DOM-FIN-002, -003, -040): `lib/finance-student-services.ts`. Yazılma ücreti tarifeden hesaplar ve sözleşmesiz ayrı taksit açar; çıkış ileri vadeli ödenmemiş taksiti iptal eder, ödenen tutarda iade yazmaz; ayrılış açık abonelikleri kapatır.
- Tarife kalem türlerine `club` (Kulüp) eklendi (`FEE_ITEM_KINDS`).
- `lib/authorize.ts` ve `modules/commands.ts`: `studentService.manage` eklendi (yönetici, ön büro; modül `finance`).
- Tarifeli yenileme aynı yılın açık aboneliğindeki ek hizmeti `renewal_extra_has_service` ile reddeder (`openStudentServiceKinds`).
