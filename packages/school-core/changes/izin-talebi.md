---
etki: minor
---

- Personel izin talebi ve onayı kuralı eklendi (`lib/finance-leave-requests.ts`, DOM-FIN-116): talep bekliyor → onaylandı ya da reddedildi (gerekçe), bekleyen talep geri çekilir, onaylı talep gerekçeyle iptal edilir (`planLeaveRequest`, `planLeaveRequestApproval`, `planLeaveRequestRejection`, `planLeaveRequestCancel`). Talep kullanılmış izin kaydı kurallarından (`planLeaveRecord`) geçer; bekleyen ya da onaylı taleple çakışma 422 `staff_leave_request_overlap`. Onayda yetersiz yıllık izin 422 `staff_leave_balance_insufficient` (avans izin işaretiyle onaylanır), onaylı bordro ayına değen onay ve iptal 409 `payroll_period_locked`.
- Ders bağı: izin aralığındaki öğretmen dersleri (`affectedLessons`, `lessonSnapshot`), elle yedek öğretmen seçimi (`applySubstitutes`, `planLeaveRequestSubstitutes`) ve engel olmayan uyarılar (`substituteWarnings`: aynı saatte dersi var, izinli, başka branş). Hafta içi gün önerisi `weekdayCount`.
- Talepten doğan kullanılmış izin kaydı elle iptal edilmez (`assertManualLeaveRecord`, `lib/finance-staff-leave.ts`; 422 `staff_leave_record_from_request`); kayıt talebin iptaliyle iptal edilir.
