---
etki: minor
---

- Banka ekstresi içe aktarma kuralı eklendi (`lib/finance-bank-statement.ts`, DOM-FIN-069, IST-115): CSV ve Excel dökümünde başlık satırı ilk 30 satırda aranır, yaygın Türk bankası başlıkları ya da kullanıcının seçtiği sütun adları eşlenir; işaretli tek tutar ya da alacak/borç sütunu, MT940 `:61:`/`:86:` hareketleri okunur. Yalnız gelen hareket eşleştirme adayıdır; mükerrer anahtarı hesap, gün, tutar, katlanmış açıklama ve referanstan kurulur, aynı dosyadaki eş hareket sıra numarasıyla ayrılır (`bankTransactionKeys`). 11 ve daha uzun rakam dizileri yanıtta maskelenir (`maskStatementText`).
- Banka hareketi eşleştirme önerisi eklendi (`lib/finance-bank-matching.ts`): T.C. kimlik no (tamamı ya da son haneleri), öğrenci numarası, sözleşme kimliği, öğrenci ve veli adı ile tutarın açık taksite uyumu puanlanır; öneriler sıralı, güven düzeyli ve kısmi/fazla ödeme bilgisiyle döner (`suggestBankMatches`). Rol listesi `BANK_MATCH_ROLES`, onay ve yoksayma gövdeleri `bankMatchSchema`, `bankIgnoreSchema`.
