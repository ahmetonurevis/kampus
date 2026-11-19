---
etki: minor
---

- Politika belgesi okundu onayı kuralı eklendi (`lib/finance-policy-acknowledgements.ts`, DOM-FIN-127): belge türleri (personel yönetmeliği, KVKK taahhüdü, iş güvenliği, disiplin, diğer), hedef kitle (tüm personel, öğretmen, idari) ve onay kanalları; `policyDocumentInputSchema`, `policyAcknowledgementInputSchema`.
- `planPolicyVersion`: yeni sürüm yalnız geçerli sürümün yerine geçer, önceki sürümün onayları geçersiz sayılır (K-436). `assertPolicyAcknowledgement`: etkin ve hedef kitledeki personel, yayın ile bugün arasındaki onay günü, sürüm başına tek onay (K-437, K-438). `audienceIncludesRole`, `acknowledgementRate`.
