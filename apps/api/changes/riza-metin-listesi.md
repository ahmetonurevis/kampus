---
etki: minor
---

Yayımlı rıza metinleri tek istekle listelenir (OG-1006; #39; DOM-YTK-058, DOM-YTK-060).

- Yeni uç `GET /api/v1/consent-texts` (etiket `privacy`, `operationId` `listConsentTexts`): kurumun yayımlı rıza metinlerinin güncel sürümü, amaç sırasıyla; öğe `GET /consent-texts/{purpose}` yanıtıyla aynıdır (`text`, `minimumVersion`). Metni yayımlanmamış amaç listede yer almaz, yani 404 yerine boş liste olur. İsteğe bağlı `purpose` süzgeci beyaz listelidir; bilinmeyen parametre ve amaç 400. Roller tekil uçla aynıdır (`consent.status`); başka kurumun metni dönmez.
- Tekil uç ve 404 `consent_text_not_found` davranışı değişmedi.
- `@kampus/react-shared` `useConsentTexts` artık liste ucunu bir kez okur; yayımlanmamış amaç için tarayıcı konsoluna 404 düşmez, çağıranlara `consent_text_not_found` hatalı bir "metin yok" durumu görünür (arayüz değişmedi).
- OpenAPI ve api-client şeması yeniden üretildi; migration yok.
