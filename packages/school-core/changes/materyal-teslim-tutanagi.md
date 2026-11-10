---
etki: minor
---

- Materyal seti teslim tutanağı ve toplu teslim listesi PDF'i eklendi (ON-338; DOM-FIN-080). Yeni uç `GET /api/v1/finance/material-deliveries/:deliveryId` iptal edilmiş dahil teslimi verir; teslim yanıtları setin eğitim yılını (`academicYear`), öğrenci numarasını (`studentNumber`), sınıf ya da kur grubunu (`className`) ve ücret kalemi işaretini (`hasMaterialFee`; tutar ve ödeme durumu değil, K-218) taşır. Öğrenci listesi satırı son iptal edilen teslimi (`cancelledDelivery`) taşır; `className` kura bağlı sette kur grubu, sınıfsız öğrencide etkin kur gruplarıdır (K-220). Web her teslim için "Tutanak PDF", iptal edilmiş teslim için "İptal tutanağı" ve set için ekrandaki süzgeçle "Teslim listesi PDF" verir (boş imza sütunu, K-219).
