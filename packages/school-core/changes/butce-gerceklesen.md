---
etki: minor
---

- Bütçe–gerçekleşen raporu eklendi (ON-244; DOM-FIN-066): `lib/finance-budget-actuals.ts` seçilen bütçe döneminin planını kalem × maliyet merkezi × ay bazında gerçekleşenle karşılaştırır (fark, gerçekleşme oranı on binde bir). Gelir tahakkuk (varsayılan; vade günü, ayrılış düzeltmesi düşülür) ya da tahsilat esasıyla (ödeme, iptal ve iade günü; açılış aktarımı ayrıca gösterilir) taksit ücret türünden gelir kalemine eşlenir; merkez öğrencinin kampüs ve program bağından bulunur, bulunamazsa "dağıtılmamış". Gider gerçekleşeni için `BudgetExpenseActual` arabirimi; kaynak yokken gider "gerçekleşen verisi yok" döner. `budgetActualsCsv` uzun biçim CSV üretir. `lib/finance-reconciliation.ts` ayrılışta mahsup edilen alacağı `withdrawalSettledCredit` olarak dışa açar.
