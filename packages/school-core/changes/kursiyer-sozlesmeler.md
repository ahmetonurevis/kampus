---
etki: minor
---

- Yetişkin kursiyerin sözleşmelerim görünümü eklendi (ON-068, IST-082; DOM-FIN-059): `lib/contract-self-service.ts` `learnerReadsOwnContracts` kursta 18 yaşını doldurmuş kursiyeri (`isCourse`, `guardianRequired`; doğum tarihi yoksa adayın yaş grubu) seçer, `contractPlanSummary` sözleşme sürümünün ödeme planı özetini (satır, toplam, ödenen satır, yürürlükteki sürümde sıradaki vade) Ek 1 satırlarından hesaplar. Uç `GET /api/v1/finance/students/:studentId/contracts` (rol `ogrenci`, modül `finance`): kayıt, durum ve plan özeti döner; başka öğrenci, başka kurum ve okul 404, 18 yaş altı 403 `adult_learner_only`. Onay bu uçta yoktur.
