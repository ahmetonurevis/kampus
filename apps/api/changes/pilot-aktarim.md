---
etki: minor
---

- `POST /api/v1/prospects/student-imports` eklendi (ON-060, IST-007; DOM-KAY-010, -012, -013): öğrenci ve veli CSV ya da Excel (.xlsx) dosyasıyla aktarılır; `dryRun: true` önizlemedir, satır bazında sorun ve bilgi döner, hiçbir şey yazmaz. Onay tek transaction'da hepsi ya da hiçbiri (422 `student_import_invalid`), `Idempotency-Key` zorunlu, yönetici ve taze oturum. Öğrenci, veli, `student_identities` ve `student_guardians` birlikte yazılır; kayıtlı kimlik atlanır, ikinci yükleme mükerrer kayıt açmaz. Dosya saklanmaz; içerik ve kişisel veri loglanmaz, denetime yalnız sayı ve alan adı yazılır.
- `POST /api/v1/finance/installment-imports` eklendi (ON-061, IST-007; DOM-FIN-001, -010, -011, -012; ADR 0010 cevap 3): açık ve ödenmiş taksitler aynı akışla aktarılır (önizleme, onayda 422 `installment_import_invalid`, yönetici ve taze oturum, `Idempotency-Key`). Taksit ve sözleşme tablodan okunur ve tabloya yazılır. Ödenmiş taksit tahsilat satırı yazmaz: kasa ve dönem tahsilatı değişmez.
- Bağımlılık: `read-excel-file@9.3.14` (`.xlsx` okuma, yalnız API), `fflate@0.8.3` (açılmış boyut sınırı).
