---
etki: minor
---

- Satın alma raporu eklendi (ON-227; DOM-FIN-075): `lib/finance-purchase-report.ts` bütçe dönemi ya da en çok 366 günlük tarih aralığı sorgusu (`purchaseReportQuerySchema`), Europe/Istanbul açılış gününe ya da talebin bütçe dönemine göre kapsam, iptal edilmeyen siparişlerin tedarikçi kategorisi, tedarikçi, maliyet merkezi ve gider kalemi bazında net, KDV ve brüt toplamı ile payı (`purchaseReport`), talepten siparişe ortalama gün (`purchaseLeadDays`), en çok harcama yapılan beş tedarikçi ve formül kaçışlı CSV dökümü (`purchaseReportCsv`).
