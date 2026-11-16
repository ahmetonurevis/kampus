---
etki: minor
---

- Bağış kampanyası, bağışçı ve makbuz uçları eklendi (ON-258; DOM-FIN-097): `/api/v1/finance/donation-campaigns…` (liste, aç, düzelt, `open`, `close`, bağış listesi ve CSV, bağış kaydı), `/api/v1/finance/donations/:donationId/cancel` ve `…/receipt`, `/api/v1/finance/donors…`, `/api/v1/finance/donation-settings`; tablolar `donation_campaigns`, `donors`, `donations`, `donation_settings` (migration `0104_create_donations`). Yalnız yönetici; bağış kaydı ve iptali `Idempotency-Key` ister.
