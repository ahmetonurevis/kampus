---
etki: minor
---

- Pilot verisi aktarımı: öğrenci ve veli eklendi (ON-060, IST-007; DOM-KAY-010, -012, -013): `lib/enrollment-import.ts`. `parseStudentImport` başlıklı metni en çok 1.000 satırla ayrıştırır (`öğrenci adı`, `sınıf`, `kimlik no`, `doğum tarihi`, `veli adı`, `veli telefonu`, `yakınlık`; isteğe bağlı `kampüs`, `kimlik türü`, `öğrenci telefonu`). `planStudentImport` satırları doğrular; satır sonucu `ready`, `skipped` ya da `invalid`, tek hata yazılacak listeyi boşaltır, önizleme satırında kimlik ve telefon maskelidir. Aynı telefon ve ad kardeşleri aynı veli kaydına bağlar, telefon aynı ad farklıysa `guardian_phone_conflict`; kurumda aynı adlı etkin öğrencideki kimlik atlanır, başka ad `student_identity_conflict`, pasif öğrenci `student_identity_inactive`. `applyStudentImport` öğrenci ve veli kayıtlarını kesin kayıttaki biçimle açar.
- `lib/enrollment-import-cells.ts`: aktarım gövdesi (`importFileInputSchema`, `fileBase64` + `dryRun`), satır sorunu ve bilgisi, `parseImportDay`, `parseImportPhone` (Excel'in düşürdüğü baştaki sıfır ve `+90` düzelir), `normalizeImportIdentity`.
