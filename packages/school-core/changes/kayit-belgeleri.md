---
etki: minor
---

- Kayıt belgeleri eklendi (DOM-KAY-045, ON-344): `lib/enrollment-documents.ts` kesin kayıtta aday belgelerinin akıbetini verir (`planEnrollmentDocuments`: kabul edilmiş belge öğrenciye bağlanır, reddedilen 30 gün sonra imhaya, rızasız özel nitelikli belge hemen imhaya; K-384, K-385), bağlı belgenin imha bekletmesini (`enrollmentDocumentHeld`, K-386) ve öğrencinin eksik kayıt belgelerini (`enrollmentDocumentGaps`) hesaplar.
