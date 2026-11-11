---
etki: minor
---

Yoklamada geç gelme dakikası ve yoklama geçmişi aralığı eklendi (OG-042; IST-093, DOM-AKD-036).

- `attendanceInputSchema` isteğe bağlı `lateMinutes` (öğrenci kimliği → pozitif tamsayı dakika) alır. `recordAttendance` dakikayı yalnız `late` öğrenci için ve en uzun ders süresine kadar kabul eder (`lateMinutesLimit`, `DEFAULT_LESSON_MINUTES` = 40); aksi 422 `late_minutes_without_late` / `late_minutes_out_of_range` ve hiçbir kayıt değişmez. Alan verilmezse kayıtlı dakika korunur, verilip öğrenci anahtarı yoksa boşalır.
- Dakika değişikliği de düzeltme geçmişine yazılır (`AttendanceCorrection.previousLateMinutes` / `lateMinutes`); durumu ve dakikası değişmeyen öğrenciye geçmiş eklenmez, aynı öğrenci ve gün için kayıt yinelenmez.
- Geç gelme devamsızlık günü sayılmaz ve "gelmedi" bildirimi üretmez (`attendanceAlerts` yalnız durumdan karar verir); alan kuralı `DOM-AKD-036`.
