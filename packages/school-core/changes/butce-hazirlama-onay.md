---
etki: minor
---

- Bütçe hazırlama ve onay kuralı eklendi (`lib/finance-budget-drafts.ts`, DOM-FIN-093): dönem × maliyet merkezi taslağı ve kalem, tutar, gerekçe satırları (`budgetDraftSchema`, `budgetDraftLinesSchema`, `planBudgetDraftCreate`, `planBudgetDraftLines`), `draft` → `submitted` → `approved` / `revision_requested` / `rejected` geçişleri ve onaylıdan yeni revizyon (`budgetDraftTransition`, `planBudgetDraftSubmit`, `planBudgetDraftReopen`), onayın bütçe satırlarını taslağa eşitleme planı (`planBudgetDraftApproval`), sürümler arası değişen kalemler (`budgetDraftChanges`), bütçe sorumlusu ataması ve ekran düğmeleri (`planBudgetOwner`, `budgetDraftActions`), önceki dönem ve karşılaştırma CSV'si (`previousBudgetPeriod`, `budgetDraftComparison`, `budgetDraftComparisonCsv`).
