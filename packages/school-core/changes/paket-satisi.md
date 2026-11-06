---
etki: minor
---

- Dil okulunda paket ve ders saati satışı eklendi (IST-078, DOM-DIL-050, -051): kur ücreti, saat paketi ve özel ders paketi tanımlanır; fiyat yayımlı tarifeden saat × saat ücreti − ilanlı indirim olarak hesaplanır, ilan üstü saat ücreti reddedilir, ilan altı fiyat %50 indirim tavanına girer.
- Satış sözleşme ve taksitleri tek işlemde açar, son kullanma günü paketin kullanım süresinden çıkar. Saat bakiyesi saklanmaz: satın alınan − tüketilen − iade edilen; süre dolunca kalan saat silinmez, tüketim durur ve süre uzatılabilir.
- Ek hizmet kalemi hesabı `extraLines` olarak ayrıldı, taksit vade planı `dueDateOf` dışa açıldı; davranış değişmedi.
