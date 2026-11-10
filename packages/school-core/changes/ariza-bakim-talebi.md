---
etki: minor
---

- Arıza ve bakım talebi kuralı eklendi (`lib/finance-maintenance-requests.ts`, DOM-FIN-089): başlık, açıklama, yer, isteğe bağlı demirbaş etiketi ve öncelikle bildirim (`maintenanceRequestSchema`, `planMaintenanceRequest`), `open` → `assigned` → `in_progress` → `resolved` → `closed` ve `cancelled` geçiş tablosu (`maintenanceTransition`, `canTransition`), personele ya da tedarikçiye atama (`planMaintenanceAssign`), gün, not, isteğe bağlı maliyet ve tedarikçiyle çözüm (`planMaintenanceResolve`), iptal (`planMaintenanceCancel`), rol kapsamı ve maliyet görünürlüğü (`maintenanceVisibility`, `canSeeMaintenanceCost`, `maintenanceRequestActions`) ve `AT-<sıra>` numarası (`maintenanceRequestNumber`).
