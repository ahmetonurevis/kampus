---
etki: minor
---

- Finans özeti eklendi (ON-012; IST-116, IST-121): `financeOverview`, `financeOverviewQuerySchema` ve `defaultOverviewPeriod`. Dönemin net tahsilatını ve ay kırılımını, bugünün açık ve gecikmiş tutarını (`financeTotals` ile aynı kural), gecikmiş borcu olan öğrencileri (`overdueStudents`) döndürür. İptal, iptal edildiği ayda düşer; ay Europe/Istanbul gününe göredir.
