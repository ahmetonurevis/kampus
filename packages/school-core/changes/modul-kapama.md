---
etki: minor
---

Kapalı modülde kalan uçlar ve sayfalar kapatıldı (OG-036, IST-009; `docs/domain/yetki-ve-kapsam.md` DOM-YTK-040). API tarafı `apps/api/changes/modul-kapama.md`'dedir.

- `lib/notifications.ts` `hiddenNotificationKinds` eklendi: bildirim merkezi ya da türün kendi modülü kapalıysa tür gizlenir. Modül kapanmadan önce yazılmış bildirim silinmez, modül açılınca geri gelir.
