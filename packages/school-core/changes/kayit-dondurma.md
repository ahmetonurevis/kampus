---
etki: minor
---

- Dil okulunda kayıt dondurma kuralları eklendi (ON-067; DOM-DIL-052, DOM-KAY-024, IST-084): `lib/enrollment-freezes.ts` talep, onay, ret, etki ve dönüş planlarını; 18 yaş kuralını, 6 ay sınırını ve kur ortası belge beyanını taşır. Neden yalnız kategoridir (`documented`, `military`, `relocation`, `work_school_schedule`, `other`); serbest metin ve sağlık kategorisi yoktur (K-20). Yetki eylemleri `enrollment.freezeRequest`, `enrollment.freezeDecide`, `enrollment.freezeReturn` eklendi.
- Kayıt durumuna dördüncü değer eklendi (DOM-KAY-026): `frozen` (`Dondurulmuş`), öğrencinin `frozenAt` bayrağından türetilir; listede, yoklamada ve akademik bildirimde yer almaz, finans bildirimi sürer. `ENROLLMENT_STATUSES`, `ENROLLMENT_STATUS_EFFECTS` ve `ENROLLMENT_EVENT_STATUS` yeni değerleri içerir; `frozen` ve `returned` olayları eklendi.
- Ayrılış öğrencinin dondurma bayrağını temizler.
