---
etki: patch
---

- Banka ekstresi maskesi gruplanmış yazımı da kapsar (`maskStatementText`, DOM-FIN-069, K-122): boşluk, tire ya da noktayla bölünmüş en çok dört haneli gruplar ("TR12 0006 1005 …", "123 456 789 01") toplam 11 ve daha çok haneyse son dört hane dışında maskelenir; önizleme satırında referans da maskeli döner (`planBankStatementImport`). Aktarılacak hareket ham kalır.
