---
etki: major
---

- Kıdem hesaplayıcısı (`lib/finance-severance.ts`, DOM-FIN-094) tavanı, gelir vergisi dilimlerini ve damga vergisi oranını kurumun çıkış günündeki bordro parametre setinden okur (`severanceParametersOn`, K-344); `severanceEstimate` ikinci parametreyle (`parameters`, `paySource`) çağrılır, sonuç `parameters` ve `paySource` taşır. Kırıcı: `SEVERANCE_CEILINGS`, `WAGE_INCOME_TAX_TARIFFS`, `severanceCeilingOn` ve `wageTariffFor` kaldırıldı; 2025 öncesi için yedek tablolar `SEVERANCE_FALLBACK_CEILINGS`, `WAGE_INCOME_TAX_FALLBACK_TARIFFS`. `lib/finance-payroll-parameters.ts`'ten kullanılmayan `severanceCeilingRows` kaldırıldı.
- İstek şemasına isteğe bağlı `membershipId`; öneri kaynağı `severancePaySource` ve gösterimi `severancePaySourceFacts`, `severanceParameterSourceLabel` (K-346). Yeni uyarı kodu `pay_suggestion_unavailable`; dayanaklara "Ücret kaynağı", "Yan ödeme kaynağı", "Damga vergisi oranı" ve "Parametre kaynağı" satırları eklendi.
- Kırıcı: `severancePaySuggestion` (`lib/finance-pay-rates.ts`) artık durum (`SEVERANCE_SUGGESTION_STATUSES`), tanımlar ve yan hakların giriş işaretiyle döner; yalnız nakdi yan haklar toplanır, net, saatlik ya da ders saati ücretinde öneri `null`dur (K-345). Uyarı metinleri `SEVERANCE_SUGGESTION_WARNINGS`.
