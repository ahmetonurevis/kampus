---
etki: minor
---

- Kaza ve yaralanma tutanağı kuralı eklendi (`lib/finance-incidents.ts`, DOM-FIN-146, ON-162): yaralanan öğrenci ya da personel, olay anı (gelecekte ve 30 günden eski olamaz), yer, tür, açıklama, yaralanma bölgesi ve şiddeti, tanıklar, ilk müdahale, sevk ve sorumlu personel (`incidentReportInputSchema`, `planIncidentReport`). Taslak düzeltilir (`planIncidentReportUpdate`), kesinleşen tutanak değişmez; düzeltme ek nottur (`assertIncidentAddendum`). Ağır yaralanan öğrencinin tutanağı veli bildirimi kaydı olmadan kesinleşmez (`assertIncidentFinalize`; K-493). Veli bildirimi yalnız kayıttır (`planIncidentNotification`).
- Erişim matrisi `incidentAccess` (K-494): yönetici her şeyi; açan personel kendi tutanağını, sağlık grubunu yalnız taslakta görür; ek not ve PDF yöneticide. Veli kendi çocuğunun kesinleşmiş tutanağının özetini görür (`guardianIncidentSummary`; K-495).
