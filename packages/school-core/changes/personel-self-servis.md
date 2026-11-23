---
etki: minor
---

- Personel self-servisi kuralı eklendi (`lib/finance-staff-self-service.ts`, DOM-FIN-166): değişiklik talebi şeması (adres ve telefon, acil durum kişileri, IBAN ve hesap sahibi, özlük belgesi), ret gerekçesi ve personelin kendi izin talebi şeması (`myLeaveRequestInputSchema`; personel ve yedek alınmaz).
- `planStaffChangeRequest`: talep eden etkin personeldir; belge dışındaki türde tek bekleyen talep (409), belge talebi en çok on; kartta kayıtlı değer 422; hesap sahibi personelin kendi adı olmalı (K-554); belge tarihi bugünden sonra olamaz, özel nitelikli belgeye not yazılmaz (K-553).
- `splitStaffChange`, `staffChangeUpdate`, `staffChangeFields`, `staffChangeProposal`: yük IBAN taşımaz, onayda özlük kartına uygulanacak güncelleme üretilir, denetime alan adları yazılır, öneri görünümünde IBAN maskelidir.
