---
etki: minor
---

- Mesleki gelişim saati ve belgeleri kuralı eklendi (`lib/finance-professional-development-hours.ts`, DOM-FIN-144): öğretim yılı başına hedef saat girdisi (`professionalDevelopmentTargetInputSchema`; tam saat 1–500, hedef rolleri, varsayılan öğretmen), öğretim yılı aralığı ve günün yılı (`professionalDevelopmentYearRange`, `professionalDevelopmentYearOf`), katılım günü (`attendanceDay`) ve tamamlanan/hedef/eksik saat (`hoursProgress`, `targetAppliesTo`).
- Katılım belgesi ve sertifika: belge girdisi (`professionalDevelopmentDocumentInputSchema`; PDF, en çok 10 MB, `assertDocumentFile`), yalnız katıldı katılımda (`assertDocumentAllowed`); sertifika var olan özlük belgesine ya da yüklemeyle yeni özlük belgesine (`professionalDevelopmentCertificateInputSchema`, `assertCertificateLink`); belgesi olan katılım geri alınamaz (`assertAttendanceKeepsDocuments`). Okuma ve yazma rolü `FINANCE_PROFESSIONAL_DEVELOPMENT_HOURS_ROLES`.
- Gelişim hedefi bağı: `professionalDevelopmentEnrollmentUpdateSchema` isteğe bağlı `developmentGoalId` alır (`assertGoalLink`; aynı personelin açık ya da süren hedefi).
- Özlük dosyası imha kategorisinin içeriğine mesleki gelişim katılımları ve katılım belgeleri eklendi (`STAFF_RETENTION_CATEGORY_SPECS.personnel_file.contents`).
