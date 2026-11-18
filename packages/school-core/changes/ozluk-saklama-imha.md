---
etki: minor
---

- Personel özlük verisinin saklama ve imha kuralı eklendi (`lib/finance-staff-retention.ts`, DOM-FIN-122): altı veri kategorisi (istirahat raporları, sağlık raporu belgeleri, adli sicil kayıtları, özlük dosyası, izin kayıtları, mali kayıtlar), kategori başına başlangıç olayı (ayrılış günü ya da ayrılış yılını izleyen yıl başı), yasal en az süre ve imha yöntemi (`STAFF_RETENTION_CATEGORY_SPECS`). Kurum süresi yalnız uzatılabilir (`staffRetentionPolicyUpdateSchema`, `resolveStaffRetentionPolicy`).
- İmha adayı ve onay kuralı: `staffRetentionDueDay`, `staffRetentionState`, `staffRetentionCandidates`, `planStaffDataDestruction` (etkin personel, süresi dolmamış ve kayıtsız kategori reddedilir).
