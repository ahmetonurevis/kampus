---
etki: minor
---

- Personel izin takvimi ve çakışma uyarıları kuralı eklendi (`lib/finance-leave-calendar.ts`, DOM-FIN-123): takvim kaydının görünür biçimi (`calendarEntryView`; yönetici tür adını, raporu yalnız "Raporlu" görür, ön büro türsüz "İzinli"), talepten doğan kaydın çift sayılmaması (`calendarAbsences`), aynı branşta eşiğe ulaşan günler (`branchBusyDays`).
- Engel olmayan uyarılar (`leaveConflicts`, `leaveConflictText`): aynı branşta eşzamanlı izin (eşik kurum ayarı, varsayılan 2), sınav haftasına denk gelen izin, yedeği o gün izinli ders.
- Kurum ayarı şeması `leaveCalendarSettingsSchema` (eşik 2–20, en çok 40 çakışmasız sınav haftası) ve `planLeaveCalendarSettings` (değişiklik yoksa 422 `leave_calendar_settings_unchanged`).
