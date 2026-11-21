---
etki: minor
---

- Sözleşme bildirim türleri eklendi (ON-044, IST-092; DOM-FIN-010, DOM-ILT-023): `lib/finance-notifications.ts` `CONTRACT_NOTIFICATION_TYPES` (`contract_approval_requested`, `contract_approved`; hizmet bildirimi, `finance` modülü, veri yalnız `contractId`) ve kitleyi yaş yerine ödeyiciden seçen `contractPayerIsGuardian`. Türler `modules/notification-types.ts` Onur bloğunda birleşir. Ödeyici bağının (`payer`) açtığı tür listesi (`PAYER_NOTIFICATION_KINDS`) değişmedi: sözleşme bildirimlerini velayetli veli görür, velayeti olmayan ödeyici veli görmez.
