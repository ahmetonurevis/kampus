---
etki: minor
---

Kapalı modülde kalan uçlar kapatıldı (OG-036, IST-009; DOM-YTK-040).

- `GET /notifications` ve `GET /notifications/unread-count` kapalı modülün bildirim türlerini (ör. `learning` kapalıyken `feedback_released`) listeden, imleçten ve okunmamış sayısından süzer; kayıt silinmez, modül açılınca döner.
- Modül eklentisi rota → modül envanterini tutar (`app.routeModules()`); `test/module-inventory.test.ts` her ucu bir modüle ya da gerekçeli modülsüz listeye bağlar, her modül kapatılınca ilgili bütün uçların 403 `module_disabled` döndüğünü sınar.
