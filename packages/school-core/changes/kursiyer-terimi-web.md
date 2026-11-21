---
etki: minor
---

- Kayıt ve finans web ekranları dil okulu ve kursta kayıtlı kişiyi "kursiyer" diye yazdı (ON-324, DOM-KAY-012, ADR 0008 karar 1): ayrılış, tahsilat, taksit, sözleşme, burs, referans, paket satışı ve raporu, gün sonu, mutabakat, taksit ve öğrenci aktarımı, veli ödeme çerçevesi, kesin kayıt, aday listesi ve formu, veli hesabı ekranlarında tablo sütunu, alan etiketi, boş durum, bildirim ve erişilebilir ad; okulda metin değişmedi. Ekler kurum türüne göre yazılır: yeni `lib/enrollment-learner.ts` `learnerWords(type)` başlık, yalın, çoğul, tamlayan, yönelme ve belirtme biçimlerini verir; PDF şablonlarının `learnerTerm`'ü bu kaynaktan okur. Paket satışı yalnız dil okulunda olduğu için form iletisi "Kursiyer seçin." oldu.
