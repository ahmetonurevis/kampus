---
etki: minor
---

- `skills/assignment.ts` `deadlineForVersion` yeniden teslim geçmişini (`resubmissionRounds`) okur: her sürüm kendisinden önceki en son turun son tarihine bağlanır, sonraki istek eski sürümün geç bayrağını değiştirmez (DOM-BEC-040, 044; IST-047). Geçmiş verilmezse eski davranış (yalnız son istek) sürer. `ResubmissionRound` tipi eklendi.
