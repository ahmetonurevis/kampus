---
etki: minor
---

Bildirim gönderimi servisi (OG-018, IST-065; `docs/domain/iletisim-ve-veli.md` DOM-ILT-020, DOM-ILT-022, DOM-ILT-023, DOM-ILT-052, DOM-ILT-073; DOM-YTK-040). Core tarafı `packages/school-core/changes/bildirim-gonderimi.md`'dedir.

- Yeni `services/notify.ts` eklendi: `notify(tx, ctx, { type, recipients: { studentIds }, data, dedupeKey? })` çağıranın transaction'ında uygulama içi bildirim yazar (çağıran geri alınırsa bildirim de yok). `data` türün katı şemasıyla doğrulanır, geçersiz veri ve bilinmeyen tür 500'dür; kayda veri değil yalnız konu kimliği yazılır. Kurumda olmayan öğrenci atlanır (`notification.recipient_skipped`, yalnız sayı); kitle türün kuralıyla 18 yaş altında ve yetişkinde ayrı seçilir. İletişim ya da türün modülü kapalıysa hiçbir şey yazılmaz (`notification.skipped`). `dedupeKey` aynı olayın aynı alıcıya ikinci kez yazılmasını önler. Yazılan bildirimler için tek `notification.create` denetim satırı (yalnız alan adları; aktörsüz çağrıda aktör boş).
- Kanal arayüzü (`NotificationChannel`) eklendi; bugün yalnız uygulama içi kanal vardır, e-posta (D2), SMS ve anlık bildirim (D3) `TODO(D2-bildirim-kanali)` ile genişler.
- Öğretmen puanının `feedback_released` bildirimi `notify`'a geçirildi; davranış, kayıt biçimi ve denetim satırları aynıdır. `services/notifications.ts` `studentNotice` kaldırıldı (tek tüketicisi buydu; yaş kararı `notify`'dadır).
- Uç ve OpenAPI değişmedi; migration yok.
