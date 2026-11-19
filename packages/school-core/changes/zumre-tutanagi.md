---
etki: minor
---

- Zümre toplantısı tutanağı kuralı eklendi (`lib/finance-department-meetings.ts`, DOM-FIN-132): toplantı girdisi (`departmentMeetingInputSchema`; ders, dönem başı/dönem sonu/ara tür, gün, yer, başkan, sıralı gündem ve görüşme özeti, katıldı/katılmadı/mazeretli katılım; başkan "katıldı" olmalı), gündem birleştirme (`mergeAgenda`; kararı olan madde silinmez), kişi denetimi (`assertMeetingPerson`; etkin öğretmen ya da yönetici üyeliği).
- Karar ve takip (`departmentDecisionInputSchema`, `assertDecision`, `departmentDecisionFollowUpSchema`, `assertFollowUp`): gündem maddesine bağlı karar, sorumlu, termin; açık/tamamlandı/iptal (iptalde not zorunlu). Kesinleştirme (`departmentMeetingFinalizeSchema`, `assertFinalize`, `assertMeetingEditable`): imza günüyle kesinleşen tutanak değişmez. Termini geçmiş açık karar (`isDecisionOverdue`, `overdueDays`), hesaplanan karar numarası (`numberDecisions`). Rol `FINANCE_DEPARTMENT_MEETING_ROLES` (yalnız yönetici).
