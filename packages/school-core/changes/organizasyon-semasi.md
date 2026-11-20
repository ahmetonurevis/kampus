---
etki: minor
---

- Organizasyon şeması kuralı eklendi (`lib/finance-org-chart.ts`, DOM-FIN-129): birim ağacında döngü ve derinlik engeli, pasif üst birim ve pasife alma koşulları (`assertUnitPlacement`, `assertUnitDeactivation`), raporlama hattında döngü engeli (`assertReportingLine`), aynı üst birimde ad ve aynı birimde unvan tekilliği (`assertUniqueName`).
- Atama kuralları: personel denetimi (`assertAssignmentStaff`), aynı personelin çakışan ataması ve günlük kadro sınırı (`assertAssignmentRange`, `maxConcurrent`), kadro sayısı indirimi (`assertHeadcount`), pozisyon kaldırma (`assertPositionArchivable`), dolu/boş kadro (`positionFill`); görsel şema için `buildOrgTree`, `flattenOrgTree`, `unitPath`.
