---
etki: minor
---

Kayıp aday nedeni ve rakip analizi (`docs/domain/kayit-ve-crm.md` DOM-KAY-005, IST-117, ON-140). API tarafı `apps/api/changes/kayip-aday-kirilimi.md`'dedir.

- `changeProspectStageSchema` isteğe bağlı `lostToInstitution` alır (`PROSPECT_LOST_INSTITUTION_MAX`, 120 karakter; yalnız `Vazgeçti`, `// kvkk: K`). Boş metin yazılmaz, aday yeniden açılınca neden gibi silinir. Öğretmen kapsamında gizlidir.
- `prospectLossBreakdown` eklendi: neden ve kurum başına sayı. Boşluk ve büyük/küçük harf farkı aynı kurum sayılır, en çok 50 kurum adıyla döner, kalanı `otherInstitutions`'ta toplanır.
