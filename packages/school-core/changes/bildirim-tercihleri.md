---
etki: minor
---

Bildirim tercihi ve sessiz saat kuralları (OG-107; `docs/domain/iletisim-ve-veli.md` DOM-ILT-020, DOM-ILT-021, DOM-ILT-050).

- Yeni `lib/notification-preferences.ts`: kanallar (`in_app`, `push`, `email`, `sms`), konu × kanal tercih şeması, veli için çocuğa göre isteğe bağlı kırılım (`children`), kısmi güncelleme (`applyNotificationPreferencesPatch`), sessiz saat şeması (`HH:MM`, gece yarısını aşan aralık, varsayılan 21:00–08:00) ve kurum sınırı (`quietWithin`, `effectiveQuietHours`).
- Zorunlu konuda (devamsızlık, onay son tarihi) uygulama içi ve anlık bildirim kapatılamaz, yalnız e-posta/SMS eklenebilir; ihlal `DomainError` (`notification_channel_required`, 422). Sessiz saat ihlalleri `quiet_hours_invalid`, `quiet_hours_over_limit`.
- Saf `isQuietNow(quiet, now)` (Europe/Istanbul) ve `deliveryDecision` (`send`, `defer`, `skip`): sessiz saatte anlık bildirim ve SMS ertelenir, acil duyuru delir.
- Web: öğrenci ve veli Ayarlar sayfasında "Bildirimler" bölümü (konu × kanal tablosu, kilitli zorunlu kanallar, sessiz saat, veli için çocuk kapsamı); konu etiketleri `TOPIC_LABELS` olarak dışa açıldı. Anlık bildirim, e-posta ve SMS gönderimi henüz yok.
