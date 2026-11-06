---
etki: minor
---

Gecikmiş taksitte elle hatırlatma (`docs/domain/finans.md` DOM-FIN-035, ON-113). API tarafı `apps/api/changes/taksit-elle-hatirlatma.md`'dedir.

- `manualInstallmentReminder` eklendi: yalnız gecikmiş ve açık taksit hatırlatılır (kısmi ödenmiş dahil); tam ödenmiş `invoice_already_paid`, vadesi geçmemiş `invoice_not_overdue` (422). Bugün elle hatırlatılmış ya da taramanın gönderdiği taksitte bildirim üretmez.
- `installmentReminders` bugün elle hatırlatılan taksiti atlar: günde bir hatırlatma; tarama ertesi gün gönderir. Anahtar `scanReminderKey` olarak dışa açıldı.
