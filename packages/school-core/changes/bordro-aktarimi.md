---
etki: minor
---

- Bordro programına aktarım kuralı eklendi (`lib/finance-payroll-exports.ts`, DOM-FIN-105): Kampüs bordro hesaplamaz, ayın girdi dosyasını üretir. Ay şeması ve aralığı (`payrollMonthSchema`, `payrollMonthRange`), ay için elle girilen ek ders saati (`payrollLessonHoursInputSchema`, `payrollLessonHoursUpdateSchema`, `planPayrollLessonHours`, `planPayrollLessonHoursUpdate`; personel × ay × tür, tam saat 1–400, gelecek ay ve mükerrer kayıt reddi).
- Kalem başına girdi satırları (`payrollExportLines`): ayla kesişen ana ücret ve yan hak tanımı başına bir satır (ay içi başlangıç/bitiş günü, gün sayısı; kısmi ayda ve saatlik ücrette tutar boş, orantılama yok), ek ders saati × ayın son tanımlı birim ücreti; satır yönü `earning`, `deduction` avans ve kesintiler için ayrılmıştır; uyarı kodları (`PAYROLL_WARNINGS`).
- Genel CSV ve sütun eşleme şablonu (`payrollExportCsv`, `payrollExportProfileSchema`, `setPayrollExportProfileSchema`, `defaultPayrollExportProfile`, `PAYROLL_EXPORT_COLUMN_OPTIONS`): ayırıcı, ondalık, tarih biçimi, sütun adı/sırası ve sabit sütun; formül kaçışı.
