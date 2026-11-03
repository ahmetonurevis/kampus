---
etki: minor
---

- Toplu personel aktarımı eklendi (OG-060, IST-007, DOM-YTK-070): `lib/staff-import.ts`. `parseStaffImport` başlıklı CSV'yi (`ad`, `e-posta`, `rol`, isteğe bağlı `branş`, `kampüs`; ayraç `;` ya da `,`, sıra serbest) en çok 1.000 satırla ayrıştırır; dosya düzeyindeki sorun `DomainError` (`csv_too_many_rows`, `csv_missing_column` …). `planStaffImport` her satırı tek davetle aynı kurallarla doğrular, dosyada yinelenen e-postayı, kurumda kayıtlı üyeyi ve bekleyen daveti ayrı hata olarak satır numarasıyla döndürür; tek hata davet listesini boşaltır. Öğretmen satırı aynı e-postalı (yoksa aynı ad, branş ve kampüslü) öğretmen kaydına bağlanır; branş ve kampüs yalnız öğretmende girilir ve kayıtla uyuşmalıdır. Rol kod ya da etiketle yazılabilir (`parseStaffRole`).
- `lib/delimited-input.ts`: `delimitedRecords` kaydın dosyadaki satırını verir; `csvTable` takma adlı, sırasız ve isteğe bağlı sütunlu başlıklı tablo okur (toplu aktarımların ortak girişi). Tırnak hatalarının iletisi satır numarasını içerir.
- `lib/staff-accounts.ts`: `staffEmailSchema` ve `staffNameSchema` davet şemasından ayrıldı (davranış aynı).
