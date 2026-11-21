---
etki: minor
---

- Öğrenciye aynı eğitim yılında ikinci burs ataması özgül kodla reddedilir (ON-289, #21; DOM-FIN-025): `requireAwardableProgram` bağlamı `studentAwarded` alır, öğrencinin o yıl arşivlenmemiş ataması varsa `DomainError` `scholarship_already_awarded` (kind `conflict`, "Öğrenciye bu eğitim yılında zaten burs atanmış.") döner; denetim onay ve program denetimlerinden sonra, kontenjandan önce gelir. Yenileme bağlamı `RenewalContext.scholarshipStudentAwarded` ile beslenir; kesin kayıt yeni öğrenci kimliği açtığından `false` geçer.
