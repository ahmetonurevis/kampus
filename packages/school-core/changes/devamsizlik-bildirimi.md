---
etki: minor
---

Yoklamadan devamsızlık bildirimi kuralı (OG-043, IST-072; `docs/domain/iletisim-ve-veli.md` DOM-ILT-052, DOM-ILT-023). API tarafı `apps/api/changes/devamsizlik-bildirimi.md`'dedir.

- `platform/notification-types.ts` içine `absence_recorded` ve `absence_corrected` eklendi: konu `attendance`, zorunlu hizmet bildirimi, `academic` modülü, 18 yaş altında veli, yetişkin kursiyerde kendisi; konu kaydı yoklama (`attendance`), veri yalnız `attendanceId`. Başlık yalnız öğrencinin adını taşır; durum, ders, neden ve mazeret bildirimde yoktur.
- Yeni `lib/attendance-alerts.ts`: `attendanceSnapshots` (günün yoklama satırları) ve `attendanceAlerts` (yoklama yazımından önceki/sonraki fark: yeni "gelmedi" bugün için `absence_recorded`; "gelmedi" başka duruma düzeltilince `absence_corrected`; aynı durum yinelenmez, geçmiş güne ilk "gelmedi" bildirim üretmez). Düzeltmede bildirim geri çekilmez, düzeltildiği ayrı bildirimle belirtilir.
- Yasal eşik bildirimleri kapsam dışıdır (`TODO(devamsizlik-esik)`). `recordAttendance` değişmedi.
