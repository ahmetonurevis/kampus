---
etki: minor
---

Bildirim gönderimi için alan başına tür kaydı (OG-018, IST-065; `docs/domain/iletisim-ve-veli.md` DOM-ILT-020, DOM-ILT-022, DOM-ILT-023). API tarafı `apps/api/changes/bildirim-gonderimi.md`'dedir.

- Yeni `lib/notification-type.ts` eklendi: `defineNotificationType` (konu, sınıf, alıcı kuralı, ilgili modül, katı `data` Zod şeması, veriden konu kimliği, başlık şablonu; katı olmayan şema ve `{öğrenci}` dışındaki yer tutucu tanımda reddedilir) ve `duplicateNotificationTypes`.
- Bildirim türleri alan başına dosyalara ayrıldı: platform ve akademik türler `platform/notification-types.ts` (`feedback_released`, modül `learning`), kayıt ve finans türleri `modules/notification-types.ts` içindeki `// Onur: kayıt ve finans` bloğu (`enrollment_completed`, modül `crm`). Birleşik kayıt `NOTIFICATION_TYPES` (`isNotificationType`, `notificationTypeSpec`); bir tür kodu iki kaynakta bulunamaz.
- `lib/notifications.ts`'e `notificationEnabled` (bildirim merkezi ve türün modülü açık mı), `notificationAudiences` (18 yaş altı ve yetişkin kitlesi) ve `notificationSubject` (veriyi tür şemasıyla doğrular, konu kaydını verir; ticari tür üretilmez) eklendi. `NOTIFICATION_KINDS`, `NOTIFICATION_TOPICS`, `NOTIFICATION_AUDIENCES` ve `notifyStudentEvent` aynı adlarla kalır.
