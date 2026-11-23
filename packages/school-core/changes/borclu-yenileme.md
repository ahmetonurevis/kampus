---
etki: minor
---

- Borçlu öğrencinin yenilemesi yönetici onayı ister (ON-057, DOM-KAY-025): `outstandingTuitionCents` önceki yıllardan vadesi geçmiş ödenmemiş öğrenim ücretini hesaplar; `RenewalContext.outstandingTuitionCents` sıfırdan büyükse `planRenewal` `debtApproved: true` olmadan 422 `renewal_debt_unapproved`, yönetici dışı onayda 403 `renewal_debt_approval_forbidden` verir. `RenewalPrice` borcu `outstandingTuitionCents` ile taşır.
- API: yenileme önizlemesi `outstandingTuitionCents` döner, plan gövdesi `debtApproved` alır. Web: yenileme özetinde borç uyarısı ve yöneticiye onay kutusu.
