---
etki: minor
---

- Yıl sonu mutabakatı açılış aktarımını ayırır (ON-299, K-16, K-19; DOM-FIN-056, DOM-FIN-014): dosyadan aktarılan geçmiş ödeme `tutmayan` çıkmaz, tahsilat sayılmaz. `financeReconciliation` satır ve toplamda `openingImportCents` döner, formül `açılış + tahakkuk − ayrılış düzeltmesi − tahsilat − açılış aktarımı + iptal + iade = kapanış` olur. Aktarım ödeme gününde sayılır; vadesinden önce aktarılan ödeme vade gününe kadar alacaktır. Mutabakat dosyasında ve aktarım profilinde `openingImport` sütunu eklendi; standart dosyada `Tahsilat (₺)` sütununun arkasındadır, sonraki sütunlar bir sağa kayar. Kayıtlı profilin sütunları değişmez.
