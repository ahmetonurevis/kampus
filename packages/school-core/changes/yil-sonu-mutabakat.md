---
etki: minor
---

- Yıl sonu mutabakatı eklendi (ON-085, IST-111, DOM-FIN-056): `lib/finance-reconciliation.ts` seçilen eğitim yılı için öğrenci bazında açılış, tahakkuk, ayrılış düzeltmesi, tahsilat, iptal, iade, burs, indirim ve kapanışı hesaplar, toplamı tutmayan öğrencileri nedeniyle verir.
- Aktarım profiline isteğe bağlı `columns.reconciliation` eklendi; `profiledReconciliationCsv` mutabakat dosyasını üretir. Bu alanı taşımayan eski profil geçerli kalır, standart sütunlarla çalışır.
