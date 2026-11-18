---
etki: minor
---

- Öğretmen çalışma onayı takibi kuralı eklendi (`lib/finance-work-permits.ts`, DOM-FIN-114): onay türü (ilk, yenileme, branş değişikliği), branş, başvuru, onay ya da ret günü, onay sayısı ve geçerlilik bitişi. Öğretmen başına tek açık kayıt; yenileme ve branş değişikliği önceki onayı ister; sonuçlanmış kayıtta yalnız not ve belge değişir (`workPermitInputSchema`, `planWorkPermit`, `planWorkPermitUpdate`, `planWorkPermitApply`, `planWorkPermitApprove`, `planWorkPermitReject`).
- Varsayılan geçerlilik bitişi onay gününün eğitim yılı sonudur, yıl sonuna 60 günden az kala verilen onayda sonraki yılın sonu (`defaultWorkPermitValidUntil`). "Süresi doldu" saklanmaz (`workPermitState`); öğretmen özeti geçerli, dolmak üzere (30 gün), süresi doldu ve onay yok durumlarını verir (`teacherPermitSummary`, `isUnapprovedTeaching`).
