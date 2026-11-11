---
etki: minor
---

- Tedarikçi ve satın alma talebi kuralları eklendi (ON-221, ON-222; DOM-FIN-070, DOM-FIN-071): `lib/finance-suppliers.ts` şirket (VKN) ve şahıs (TCKN) tedarikçi şeması, türe göre vergi numarası ve TR IBAN mod-97 denetimi, sabit kategori kümesi, dosyasız belge listesi ve süre uyarısı, şahıs TCKN'si ile IBAN maskesi; `lib/finance-purchase-requests.ts` talep şeması (maliyet merkezi, bütçe dönemi, gider kalemi, gerekçe, kalemler), taslak → gönderildi → onaylandı/reddedildi ve iptal geçişleri, ön büro sahiplik denetimi, hesaplanan talep tutarı ve bilgi amaçlı bütçe kalanı. `lib/finance-corporate.ts` VKN ve TCKN denetimini dışa açar (`isValidVkn`, `isValidTckn`).
