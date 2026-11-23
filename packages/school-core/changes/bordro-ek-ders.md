---
etki: major
---

- Bordro hesabı (`lib/finance-payroll-calc.ts`, DOM-FIN-115) ek dersi yalnız müdür onaylı ek ders çizelgesinden alır (DOM-FIN-120, K-423). **Kırıcı:** `payrollCalculation` girdisine zorunlu `lessonSheet` (`status`, onay bekleyen `pending` saatleri) ve `PayrollPersonInput`'a zorunlu `lessonHoursUnapproved` eklendi; geçiş için onaylı ayda `{ status: 'approved', pending: [] }` ve `false` verin. Onay bekleyen saat hesaba girmez, personelin satırı yeni `lesson_hours_unapproved` uyarısını taşır; sonuç `lessonSheet` özeti (`status`, `pendingStaffCount`, `pendingHours`) döner, özet metni `payrollLessonSheetNotice`.
- Ek ders çizelgesi kuralına (`lib/finance-lesson-hour-approvals.ts`) `lessonHoursPendingApproval` (onay bekleyen saatler) ve `assertPayrollLessonHoursApproved` eklendi: ayda onay bekleyen ek ders saati varken bordro dönemi onayı 409 `payroll_lesson_hours_pending` olur (DOM-FIN-108, K-424).
