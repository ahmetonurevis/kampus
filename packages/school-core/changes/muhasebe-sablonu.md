---
etki: minor
---

Muhasebe dosyasının Excel modeli ve hazır sütun şablonları eklendi (ON-094, IST-111; DOM-FIN-055). `lib/finance-sheet.ts` hücre türlerini (metin, tam sayı, tutar, gün) tanımlar; `profiledPaymentsSheet`, `profiledRefundsSheet`, `profiledInvoicesSheet` CSV ile aynı profilden sayfa üretir. `financeExportQuerySchema` isteğe bağlı `format` (`csv`, `xlsx`; varsayılan `csv`) aldı. `lib/finance-export-templates.ts` genel şablonları verir; belirli bir muhasebe programı biçimi, hesap kodu ve KDV sütunu yoktur.
