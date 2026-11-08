---
etki: minor
---

- Banka ekstresi maskesi gruplanmış yazımı da kapsar (`maskStatementText`, DOM-FIN-069, K-122): boşluk, tire ya da noktayla bölünmüş en çok dört haneli gruplar ("TR12 0006 1005 …", "123 456 789 01") toplam 11 ve daha çok haneyse son dört hane dışında maskelenir; önizleme satırında referans da maskeli döner (`planBankStatementImport`). Aktarılacak hareket ham kalır.
- Banka hareketi mükerrer izi biçimden bağımsızlaştı (`bankTransactionKeys`, K-120): banka referansı hareketi tanımlıyorsa (en az 6 harf/rakam, rakam içerir) iz hesap, gün, tutar ve referanstır; yoksa açıklama `normalizeStatementText` ile (harf katlama, noktalama ve boşluk tekleştirme) girer. Aynı ekstre CSV ve MT940 olarak yüklenince referanslı hareket ikinci kez yazılmaz.
- Onayda olası mükerrer denetimi eklendi (`assertNoPossibleDuplicate`, K-121): aynı hesap, gün ve tutarda aynı öğrenciye eşleşmiş başka hareket ya da aynı gün aynı tutarda elle girilmiş etkin banka havalesi tahsilatı varsa `bank_match_possible_duplicate` (409); `bankMatchSchema` isteğe bağlı `confirmDuplicate` ile açık onayı alır.
- Eşleştirme önerisi gruplanmış kimlik numarasını da tanır (`statementDigitRuns`, DOM-FIN-069): "100 000 001 46" ya da "100-000-001-46" bitişik yazımla aynı puanı alır; puan kuralı değişmedi.
