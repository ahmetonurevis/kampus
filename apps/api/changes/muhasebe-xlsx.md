---
etki: minor
---

`GET /api/v1/finance/exports` isteğe bağlı `format` parametresi aldı (ON-094, IST-111; DOM-FIN-055). `format=xlsx` aynı satırları kurumun profiliyle Excel dosyası olarak döner: metin alanı formül çalıştırmayan metin hücresi, tutar `#,##0.00` biçimli sayı, tarih Europe/Istanbul günü. Yetki (yönetici, taze oturum), hız sınırı ve denetim CSV ile aynıdır; denetim kimliğinin sonuna `:xlsx` eklenir. Varsayılan CSV değişmedi. Migration yok. Yeni bağımlılık `write-excel-file` yalnız API'dedir.
