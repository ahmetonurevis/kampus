---
etki: minor
---

- Kıdem ve ihbar tazminatı tahmini eklendi (`lib/finance-severance.ts`, DOM-FIN-094): elle girdili istek şeması (`severanceRequestSchema`; giriş ve çıkış günü, brüt ücret ve düzenli yan ödemeler kuruş, sabit çıkış nedeni listesi `SEVERANCE_EXIT_REASONS`, ihbar verildi mi, isteğe bağlı kümülatif gelir vergisi matrahı), hizmet süresi (`servicePeriod`), 4857 md. 17 ihbar süresi (`noticeWeeks`), yürürlük tarihli kıdem tavanı (`SEVERANCE_CEILINGS`, `severanceCeilingOn`) ve ücret gelir vergisi tarifesi (`WAGE_INCOME_TAX_TARIFFS`, `wageTariffFor`), kalem kalem döküm (`severanceEstimate`: gün, günlük ücret, brüt, gelir ve damga vergisi, net) uyarı kodları ve metinleri (`severanceWarningCodes`, `severanceWarnings`) ile ekran ve PDF'in ortak döküm satırları (`severanceBreakdownRows`, `severanceFacts`, `severanceNotes`). Sonuç saklanmaz.
