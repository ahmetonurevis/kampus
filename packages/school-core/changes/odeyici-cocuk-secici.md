---
etki: minor
---

- Ödeyicisi olunan çocuklar (ON-313; K-04, DOM-FIN-052, DOM-ILT-074): `lib/finance-payer-children.ts` `payerChildren` velinin ödeyici kapsamındaki (`scope.payerStudentIds`) öğrencileri yalnız ad ve güncel sınıf adıyla, Türkçe ada göre sıralı döner. API `GET /api/v1/finance/payer-children` (veli, modül `finance`) bunu kullanır; web ve mobil finans sayfalarının çocuk seçicisi velayetsiz ödeyici velinin çocuğunu da listeler, akademik sayfalar listelemez.
