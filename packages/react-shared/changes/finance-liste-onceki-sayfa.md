---
etki: patch
---

- Kayıt ve finans liste kancaları sayfa, arama ya da süzgeç değişince yeni yanıta kadar önceki sayfayı tutar (ON-319): `useFinanceListQuery` (`use-finance-list-query.ts`) ile `useRenewals`, `useRenewalCandidates`, `usePriceIndexes`, `useFeeTariffs`, `useLessonPackages`, `usePackageSales`, `useCourseOffers`, `usePackageReport`, `useFinanceReconciliation`, `useReferralRewards`, `useScholarshipPrograms`, `useScholarshipAwards`, `usePayments`, `useWithdrawals`, `useEOzelItems`. Hesap kaynağı olan `useEffectiveFeeTariff` ve `useAvailableReferralRewards` önceki yanıtı tutmaz (`keepPreviousPage: false`).
