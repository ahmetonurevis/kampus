---
etki: minor
---

- Bütçe ve maliyet merkezi kuralları eklendi (ON-241, ON-242; DOM-FIN-062): `lib/finance-cost-centers.ts` kampüs, birim ve program merkezi şeması (kod biçimi, türe uyan bağ), hiyerarşi denetimi (etkin üst merkez, döngü yok, en çok 4 düzey), kampüs ve program bağı tekilliği, pasifleştirme ve yeniden etkinleştirme; `lib/finance-budget.ts` gelir ve gider kalemi (ücret türü eşlemesi, kullanılan kalemin türü değişmez), eğitim yılına ya da gün aralığına bağlı bütçe dönemi (taslak → açık → kapalı, açık dönemler örtüşmez, kapalı dönem değişmez), planlanan tutar ve aylık dağılım denetimi, `periodMonths` ve `evenMonthlySplit`.
