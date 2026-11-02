---
etki: minor
---

Finans bildirimleri, uygulama içi (`docs/domain/finans.md` DOM-FIN-035). Core tarafı `packages/school-core/changes/finans-bildirim.md`'dedir.

- `installments.remind` işi eklendi (ON-026, IST-109; `jobs/installment-reminders.ts`, `services/installment-reminders.ts`): her gün 09:00 (Europe/Istanbul) kurum kilidi altında taksitleri tarar, `notify` ile `installment_due` ve `installment_overdue` yazar. `dedupeKey` taksit ve vade günüdür; ikinci çalıştırma bildirim yazmaz. Sessiz saatte (21:00–08:00), iletişim ya da finans modülü kapalıyken okumaz ve yazmaz. Arşivlenmiş öğrencinin taksiti taranmaz, ayrılan öğrencinin kalan borcu taranır. İş henüz `jobs/registry.ts`'e eklenmediği için zamanlanmaz.
- Alıcı `notify` kuralıdır: iletişim kısıtlı veli görmez; ödeyiciye daraltma yoktur, velayetli bütün veliler görür.
- `GET /api/v1/notifications` yanıtındaki `kind` listesine türler eklendi. OpenAPI ve `api-client` şeması yeniden üretildi.
