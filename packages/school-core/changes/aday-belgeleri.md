---
etki: minor
---

- Aday belgeleri eklendi (DOM-KAY-043, ON-263): `lib/prospect-documents.ts` belge türü listesini (kimlik, karne, sağlık raporu, fotoğraf, diğer; zorunlu, aşama, özel nitelikli işareti), kurumun varsayılan türlerini (`defaultProspectDocumentTypes`, K-320), belge ekleme, inceleme (kabul / gerekçeli ret) ve rıza şemalarını taşır.
- Eksik belge kuralı `prospectDocumentGaps`: ön başvuru belgesi aday açıkken, kesin kayıt belgesi `Teklif verildi` aşamasında ve kesin kayıttan sonra istenir; reddedilen ya da dosyası imha edilen belge eksiktir (K-321).
- Özel nitelikli belge (sağlık raporu) yalnız açık rıza kaydıyla yüklenir, yalnız yönetici açar ve inceler (`assertSpecialDocumentConsent`, `canOpenProspectDocument`, `documentConsentGrantor`; K-322). İmha süresi `PROSPECT_DOCUMENT_RETENTION_DAYS` 30 gün (K-323).
