---
etki: minor
---

- Cari ekstre ayrılışı ve iadeyi yazar (ON-093; IST-107, DOM-FIN-054, DOM-FIN-040): `studentStatement` isteğe bağlı ayrılış listesi (`StatementWithdrawal`) alır. Ayrılışta iptal edilen taksite alınan ve dağıtılmamış tutar artık iade alacağı (`unappliedCents`) sayılmaz; tahsilat satırında alacak yazılır, ayrılış gününe `withdrawal_settlement`, iade ödenince `refund_payment` satırı düşer. Yeni `refundDueCents` ödenmemiş iadedir; son bakiye `openCents − refundDueCents`. Ekran, PDF ve mobil notları tek kaynaktan gelir: `statementNotes`.
