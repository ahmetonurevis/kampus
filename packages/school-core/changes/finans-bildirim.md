---
etki: minor
---

Finans bildirimleri (`docs/domain/finans.md` DOM-FIN-034, DOM-FIN-035; `docs/domain/iletisim-ve-veli.md` DOM-ILT-023). API tarafı `apps/api/changes/finans-bildirim.md`'dedir.

- Yeni `lib/finance-notifications.ts`: `installment_due` ve `installment_overdue` hizmet bildirimi türleri eklendi (ON-026, IST-109): konu `payment`, `finance` modülü, 18 yaş altında veli, yetişkin kursiyerde kendisi; veri yalnız `invoiceId`, başlıkta tutar ve vade yok.
- Yeni `lib/installment-reminders.ts`: `installmentReminders` vadeye 3 gün kala ve vade günü `installment_due`, vade geçince `installment_overdue` kararı verir. Tam ödenmiş taksit hatırlatılmaz, kısmi ödenmiş taksit açık sayılır; gün Europe/Istanbul takvimindendir. Biçimi bozuk taksit atlanır ve sayılır.
- `openAmount` yalnız `id`, `amount` ve `paidAt` alanlarını isteyecek biçimde daraltıldı.
