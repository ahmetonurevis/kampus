---
etki: minor
---

- Personel çalışma ve hizmet belgesi kuralı eklendi (`lib/finance-staff-certificates.ts`, DOM-FIN-106): çalışma belgesi yalnız etkin, hizmet belgesi yalnız ayrılan personele düzenlenir; görev ve günler elle girilir, T.C. kimlik no isteğe bağlıdır (kontrol haneli), muhatap boşsa "İlgili makama". Ücret yalnız çalışma belgesinde ve istenirse düzenleme günündeki ana ücretten kopyalanır (`staffCertificateInputSchema`, `planStaffCertificate`, `planStaffCertificateCancel`).
- Belge numarası `PB-<yıl>-<sıra>` (`staffCertificateLabel`), belge metni ve hizmet süresi (`staffCertificateParagraphs`, `staffCertificateWageText`, `staffCertificateServiceText`).
