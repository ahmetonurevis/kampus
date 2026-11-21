---
etki: minor
---

- Aday bilgisi düzeltilebilir (ON-282; DOM-KAY-003, KVKK md. 11): `updateProspectDetails` ve `updateProspectDetailsSchema` eklendi. Ad, telefon, e-posta, ilgi ve 18 yaş altında veli adı yalnız gönderilen alanlarla değişir; değişiklik yoksa 409 `prospect_unchanged`, açık adayda mükerrer denetimi yeniden çalışır, onaylı e-posta silinemez (`consent_contact_in_use`), yetişkin adayda veli adı tutulmaz (`guardian_not_applicable`). Kayda yalnız düzeltilen alan adları yazılır (`profileEdits`, `ProspectProfileEdit`). `prospect.update` yazma eylemi `yonetici` ve `onburo`dur; öğretmene `profileEdits` görünmez.
