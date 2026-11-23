---
etki: minor
---

- Menüye yönetici için "Yoklama Düzeltme" (`yoklama-duzeltme`, modül `academic`, kategori `YÖNETİM`, görünüm `AttendanceCorrection`) eklendi (IST-093, DOM-AKD-035). Sayfa `apiOnly: true` taşır: Vue demosu ve mobil çevrimdışı demo menüsü düşürür, mobil API menüsü yalnız taşıdığı sayfaları gösterir. Diğer rollerin menüsü değişmedi.
- `lib/domain.ts`: yönetici düzeltme gerekçesi şeması `attendanceCorrectionReasonSchema` (kırpılmış 2–500 karakter) ve `ATTENDANCE_CORRECTION_REASON_MIN` dışa aktarıldı; `authorize('attendance.record')` ile aynı alt sınırı uygular, web/mobil form istek atmadan kullanır.
