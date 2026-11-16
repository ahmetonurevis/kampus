---
etki: minor
---

- Paydaş ve sponsor kaydı kuralı eklendi (`lib/finance-stakeholders.ts`, DOM-FIN-102): paydaş türleri, isteğe bağlı VKN ve iletişim kişisi, etiketler (`stakeholderSchema`, `updateStakeholderSchema`, `planStakeholderUpdate`, `assertStakeholderTaxNumberFree`), listede maskeli iletişim (`maskStakeholderContact`), iş birliği ve sponsorluk anlaşması (`stakeholderAgreementSchema`, `updateStakeholderAgreementSchema`, `checkAgreementTerms`, `planStakeholderAgreement`, `planStakeholderAgreementUpdate`, `planStakeholderAgreementActivate`, `planStakeholderAgreementTerminate`, `planStakeholderAgreementArchive`), hesaplanan durum ve yenileme uyarısı (`agreementSchedule`; bitiş günü dahil, bildirim günü penceresi), katkı özeti (`contributionSummary`) ve iki CSV (`stakeholdersCsv`, `stakeholderAgreementsCsv`).
