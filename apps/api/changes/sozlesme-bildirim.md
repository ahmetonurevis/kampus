---
etki: minor
---

- `POST /api/v1/finance/contracts/:contractId/signatory` aynı transaction'da `contract_approval_requested`, `…/approve` aynı transaction'da `contract_approved` yazar (ON-044, IST-092; `services/finance-contracts.ts`). İstek imza yetkilisi işlenince gider, çünkü ödeyici onayı ancak o zaman verilebilir; ek protokol yeni sürüm olduğu için imzalanınca yeni istek alır. Kitle sözleşmenin ödeyicisidir (`contractPayerIsGuardian`, `notify` açık kitlesi `recipients.minor`): veli ödeyicide veli, kendi ödeyicisi yetişkin kursiyerde kendisi. `dedupeKey` sözleşme sürümüdür: imza yetkilisi düzeltmesi ve `Idempotency-Key` tekrarı ikinci bildirim yazmaz; işlem geri alınırsa bildirim de kalmaz; iletişim modülü kapalıyken işlem sürer, bildirim yazılmaz. Veri yalnız sözleşme kimliğidir; başlıkta tutar ve imza yetkilisi yoktur. Bildirim türü listesi değiştiği için `openapi.json` ve api-client şeması yeniden üretildi.
