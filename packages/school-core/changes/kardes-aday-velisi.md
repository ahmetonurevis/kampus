---
etki: minor
---

- `findParentMatches` isteğe bağlı üçüncü parametre `{ prospectId }` alır (ON-103; DOM-KAY-013, DOM-KAY-031): adayın kardeş ağındaki (`siblingOfId` iki yönde, zincir boyunca) kesin kayda dönmüş adayın velisi telefon farklı olsa da önerilir. Her öneri `match` (`'sibling' | 'phone'`, `PARENT_MATCH_KINDS`) taşır; kardeş önerisi listenin başındadır. Yetişkin kursiyerin kendi satırı kardeş bağıyla da önerilmez (`isNotGuardian`).
