---
etki: minor
---

- Cari ekstre eklendi (ON-021, IST-107, DOM-FIN-054): `lib/finance-statement.ts` `studentStatement` taksit ve tahsilatları yürüyen bakiyeyle sıralar; özet `studentBalance` ile aynı kuraldadır. API: `GET /api/v1/finance/students/:studentId/statement`. `statementLineLabel` ekran ve PDF açıklamasını üretir.
