---
etki: minor
---

- Yönetici yanlışlıkla ileri alınan açık aday aşamasını gerekçeyle geri alabilir (ON-007; DOM-KAY-030): `revertProspectStage`, `revertProspectStageSchema` ve `revertableProspectStages` eklendi. Hedef geçerli aşamadan önceki bir açık aşamadır, gerekçe zorunludur (2–300 karakter) ve `stageReverts` kaydında saklanır; görüşme öncesi aşamaya dönerken ileri tarihli görüşme ve deneme dersi kalkar. `prospect.stageRevert` yazma eylemi yalnız `yonetici`dir; vazgeçen ve kayıtlı aday geri alınmaz.
