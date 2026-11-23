---
etki: minor
---

- Zümre tutanağı kuralı kurul türleriyle genişledi (`lib/finance-department-meetings.ts`, DOM-FIN-135): `MEETING_BOARDS` (zümre, öğretmenler kurulu, şube öğretmenler kurulu), `departmentMeetingInputSchema` yeni `board` (varsayılan zümre), `classId` ve `agendaTemplateId` alanlarını alır; `subjectId` artık yalnız zümrede zorunludur, diğer türlerde boş olmalıdır (kırıcı değil: eski gövde zümre sayılır). Toplantı adı `meetingTitle`, tutanak başlığı `MEETING_BOARD_MINUTES_TITLES`.
- Gündem şablonu (`meetingAgendaTemplateInputSchema`, `meetingAgendaTemplateUpdateSchema`, `assertAgendaTemplate`, `assertTemplateEditable`, `agendaFromTemplate`): kurul türü başına adlı, sıralı maddeli kurum şablonu; arşivli ya da başka türün şablonu yeni toplantıya bağlanmaz. Önerilen gündemler `SUGGESTED_AGENDAS` (H-101 doğrulanmalı).
