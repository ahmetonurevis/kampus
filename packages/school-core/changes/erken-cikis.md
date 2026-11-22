---
etki: minor
---

- Erken çıkış ve izinli ayrılış kuralı eklendi (`lib/finance-early-dismissals.ts`, DOM-FIN-161, ON-168). Veli velayetli ve iletişim kısıtı olmayan çocuğu için gün, saat, neden ve teslim alacak kişiyle (kendisi, kayıtlı teslim yetkilisi ya da adı, kimliğin son dört hanesi ve yakınlığıyla kayıtlı olmayan kişi) talep açar; talep okul onayı bekler, okulun açtığı acil talep onaylı doğar; öğrenciye günde tek açık talep (`earlyDismissalCreateSchema`, `planEarlyDismissal`, `planEarlyDismissalApproval`, `planEarlyDismissalRejection`, `planEarlyDismissalCancel`; K-538).
- Teslim yetkilisi velayetli ve kısıtsız veli ya da teslim alma yetkisi işaretli bağdır (`canPickUpStudent`, `authorizedPickups`). Teslimde kimlik görüldü işareti zorunludur, yetkisiz kişiye teslim ve son dört hanesi eşleşmeyen kayıtlı olmayan kişi reddedilir, gerçek çıkış anı kaydedilir (`earlyDismissalReleaseSchema`, `planEarlyDismissalRelease`; K-539).
- Erken çıkışın etkilediği ders saatleri ders programından hesaplanır (`dismissalLessonEffects`, `dismissalDeparture`; K-540); yoklama kaydı değiştirilmez.
- Veli bildirim türleri `early_dismissal_decided` ve `early_dismissal_released` eklendi (`EARLY_DISMISSAL_NOTIFICATION_TYPES`).
