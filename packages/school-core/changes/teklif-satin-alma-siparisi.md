---
etki: minor
---

- Satın alma teklifi ve siparişi kuralları eklendi (ON-224, ON-225; DOM-FIN-072, DOM-FIN-073): `lib/finance-purchase-quotes.ts` onaylı talebe tedarikçi başına teklif şeması (kalem bazında KDV hariç birim fiyat, %0/%1/%10/%20 KDV, teslim süresi, geçerlilik günü), talebin bütün kalemlerini kapsama denetimi, kalemde yarım kuruş yukarı yuvarlanan KDV (`vatCents`), kalem × tedarikçi karşılaştırması ve geçerli teklifler arasında en düşük vurgusu (`compareQuotes`), en düşük olmayan teklifin gerekçeli seçimi; `lib/finance-purchase-orders.ts` seçili tekliften sipariş, `SA-<yıl>-<sıra>` numarası (Europe/Istanbul yılı), taslak → gönderildi → kısmen teslim → tamamlandı ve iptal durumları, talep başına tek etkin sipariş, beklenen teslim günü.
