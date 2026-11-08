---
etki: minor
---

- Burs fonu (DOM-FIN-068, ON-330): `planAwardFundRelease` burs ataması arşivlenince ya da tutarı düşünce fondan karşılanan paydan hangi atamaların en yeniden başlayarak bırakılacağını verir; kapalı fondaki atama bırakılmaz (K-117…K-119). `SCHOLARSHIP_FUND_RELEASE_REASONS` sistem gerekçesidir.
- `cancelledRenewalScholarshipYears` ayrılışla iptal edilen burslu yenilemelerin eğitim yıllarını verir (DOM-FIN-025, K-117).
- `planScholarshipFundAllocationCancel` artık fonu da alır; kapalı fonda atama iptali `scholarship_fund_closed` ile reddedilir (K-97). İmza değişikliği.
- `scholarshipFundMovements` ad gizlenen rolde atama satırının öğrenci ve burs kimliğini ve iptal gerekçesini de boş döndürür (K-98).
