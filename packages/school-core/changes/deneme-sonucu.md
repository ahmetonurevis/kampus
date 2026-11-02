---
etki: minor
---

- Öğretmen deneme dersi sonucunu yazabilir (ON-006; DOM-DIL-031, DOM-YTK-080): `recordTrialResult` ve `recordTrialResultSchema` eklendi. Dersin grubunun öğretmeni, ders yapıldıktan sonra seviye uygunluğunu (`suitable`, `lower_level`, `upper_level`) ve en fazla 500 karakterlik kısa notu yazar; sonuç aday aşamasını, öğrenci kaydını ve yoklamayı değiştirmez, yeniden yazılabilir. `prospect.trialResult` yazma eylemi (yalnız `ogretmen`, hedef `classId`, kapsam dışı grup 404, okul kurumunda 404) ve komut tablosu girdisi eklendi; `TRIAL_FITS`, `TRIAL_FIT_LABELS`, `ProspectTrialLesson.result` dışa aktarıldı.
- Öğretmen `prospects` koleksiyonunu yalnız kendi gruplarındaki deneme adayları için okur ve ad, kampüs, ilgi, aşama, yaş bayrağı ile deneme dersini görür; telefon, e-posta, veli, not, rıza ve satış bilgisi ayıklanır (`PROSPECT_TEACHER_VISIBLE`). Seviye ve yaş bandı denetimi (`TODO(crm-trial-level)`) önkoşulları eksik olduğu için yapılmadı.
