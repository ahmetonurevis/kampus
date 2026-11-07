---
etki: minor
---

- `GET /api/v1/finance/reconciliation` satır ve toplamda `openingImportCents` döner (ON-299; DOM-FIN-056, DOM-FIN-014): dosyadan aktarılan geçmiş ödeme `unrecorded_payment` sayılmaz, formülde ayrı kalemdir. `GET /api/v1/finance/reconciliation/export` standart dosyasına `Tahsilat (₺)` sütununun arkasına `Açılış aktarımı (₺)` eklendi.
