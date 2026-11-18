---
etki: minor
---

- Personel özlük belgeleri kuralı eklendi (`lib/finance-staff-documents.ts`, DOM-FIN-113): diploma, sağlık raporu (işe giriş/periyodik), adli sicil kaydı, sertifika, kimlik fotokopisi ve diğer türleri; tür başına kurum ayarı (zorunlu, geçerlilik süresi ay, özel nitelikli) ve varsayılanları (`DEFAULT_STAFF_DOCUMENT_SETTINGS`, `resolveStaffDocumentSettings`, `staffDocumentSettingsUpdateSchema`). Adli sicil ve sağlık raporunun özel nitelikli işareti kaldırılamaz.
- Yeni belge kuralı `planStaffDocument`: bitiş türden (`staffDocumentValidUntil`) ya da elle; tekil türde yeni belge eskisinin yerine kendiliğinden, diploma/sertifika/diğerde seçilince geçer; özel nitelikli türü yalnız yönetici kaydeder ve bu türe not yazılmaz.
- Geçerlilik takibi: `staffDocumentStatus` (geçerli, yaklaşıyor, süresi geçti, yerine geçildi; kalan gün), `missingStaffDocumentTypes`, `isStaffDocumentRestricted`.
