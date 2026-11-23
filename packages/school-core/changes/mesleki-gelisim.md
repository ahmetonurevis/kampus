---
etki: minor
---

- Mesleki gelişim kataloğu kuralı eklendi (`lib/finance-professional-development.ts`, DOM-FIN-125): kurs, seminer, konferans, kurum içi ve çevrim içi eğitim girdisi (`professionalDevelopmentProgramInputSchema`; yarım saat adımlı süre, tarih aralığı ya da sürekli, yer ya da https bağlantı, rol ve branş etiketleri, kuruş ücret, isteğe bağlı maliyet merkezi, kontenjan), durum geçişi taslak → yayında → arşiv (`assertStatusTransition`, `assertProgramEditable`).
- Personel ataması ve katılım isteği (`professionalDevelopmentEnrollmentInputSchema`, `assertEnrollmentAllowed`): yalnız yayındaki eğitime, etkin personele, kontenjan içinde ve bir kez; katılım durumu ve saati (`professionalDevelopmentEnrollmentUpdateSchema`, `assertEnrollmentUpdate`). Yazma rolü `FINANCE_PROFESSIONAL_DEVELOPMENT_WRITE_ROLES`, okuma `FINANCE_PROFESSIONAL_DEVELOPMENT_READ_ROLES`.
