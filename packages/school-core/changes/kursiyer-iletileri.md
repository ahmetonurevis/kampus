---
etki: patch
---

- Ayrılış iletileri dil okulunda kayıtlı kişiyi "kursiyer" diye yazdı (ON-326, DOM-KAY-012, ADR 0008 karar 1): `quoteWithdrawal` ve `withdrawStudent` `student_not_found`, `withdrawal_contract_missing` ve `student_already_withdrawn` iletilerini ve etüt iptal gerekçesini bağlamdaki kurum türüyle yazar; `payerNameOf` ve `refundPayerName` isteğe bağlı tür alır, verilmezse okul metni. Hata kodları değişmedi, okulda metin aynı kaldı. Web kesin kayıt rıza notları, veli hesabı `member_exists` iletisi ve sonuç metni de türe göre yazılır; kursiyerin kendisi ödeyiciyse sonuç metni veli demez.
