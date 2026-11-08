---
etki: minor
---

- Demirbaş zimmeti kuralı eklendi (`lib/finance-fixed-asset-assignments.ts`, DOM-FIN-086): personele (etkin yönetici, öğretmen ya da ön büro üyeliği) ya da konuma (isteğe bağlı kampüs ve oda) zimmet, demirbaş başına tek açık zimmet, gün sınırları (alım ve son iade gününden önce, bugünden sonra olamaz) ve sağlam/hasarlı iade (`planFixedAssetAssignment`, `planFixedAssetReturn`, `fixedAssetAssignmentSchema`, `fixedAssetReturnSchema`).
- `planFixedAssetScrap` isteğe bağlı zimmet girdisi alır: açık zimmetli demirbaş hurdaya ayrılmaz (`fixed_asset_assigned`), hurda günü son iadeden önce olamaz (`fixed_asset_scrap_before_return`).
