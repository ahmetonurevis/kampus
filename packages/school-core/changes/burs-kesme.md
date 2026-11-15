---
etki: minor
---

- Burs kesilmesi ve gerçek dışı beyanda iptal ile geri isteme eklendi (ON-283; IST-105; DOM-FIN-025; K-264…K-267): `lib/finance-scholarship-revocation.ts` (`quoteScholarshipEnd`, `endScholarship`, `scholarshipShareSchedule`, `scholarshipEndNotice`). Burs payı öğrenim taksitlerine net ile aynı oranda yayılır, tam bursta Eylül–Haziran on aya. Kesme ileriye etkilidir: kesme gününden sonra vadesi gelen pay sözleşmeye bağlı ayrı öğrenim taksiti olur, önceki taksitler değişmez. İptal bugüne kadar uygulanan payı vade gününden bugüne kanuni faiziyle, sözleşme dışı iki alacak (anapara, faiz; ödeme süresi 30 gün) olarak geri ister ve sonraki taksitlerde bursu kaldırır.
- Kanuni faiz tablosu ve basit faiz hesabı eklendi: `lib/finance-legal-interest.ts` (`LEGAL_INTEREST_RATES`, `legalInterest`; yıl 365 gün, oran değişen aralık bölünür, kuruş aşağı).
- `amendContract` bağlamına `scholarshipEnded` eklendi: bursu kesilen sözleşmeye ek protokol 409 `contract_scholarship_ended`.
- Burs kararı bildirimi `scholarship_ended` (`SCHOLARSHIP_NOTIFICATION_TYPES`) ve fon payı bırakma nedenleri `scholarship_terminated`, `scholarship_revoked` eklendi.
