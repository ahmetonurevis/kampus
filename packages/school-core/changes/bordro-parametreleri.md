---
etki: minor
---

- Bordro parametreleri eklendi (`lib/finance-payroll-parameters.ts`, DOM-FIN-100): yürürlük tarihli parametre seti şeması (`payrollParameterSetSchema`, `updatePayrollParameterSetSchema`; brüt asgari ücret ve kıdem tavanı kuruş, oranlar on binde bir, damga vergisi yüz binde bir, asgari ücret GV ve DV istisnası), artan oranlı dilim doğrulaması (`incomeTaxBracketsSchema`: ilk dilim 0, alt sınırlar ve oranlar kesin artan, 1–10 dilim), 2025 ve 2026 platform varsayılanı (`PAYROLL_PLATFORM_DEFAULTS`, değerler doğrulanmalı), platform + kurum kopyası birleşimi ve tarihe göre geçerli set (`payrollParameterTimeline`, `effectivePayrollParameters`, `requireEffectivePayrollParameters`), yıllık dönem tablosu (`payrollParameterYear`), hesaplanan değerler (`payrollDerivedValues`: net asgari ücret, SGK taban ve tavan tutarı), kıdem hesaplayıcısına okuma bağı (`severanceCeilingRows`, `wageTariffBrackets`) ve ekran satırları (`payrollParameterRows`, `incomeTaxBracketRows`).
