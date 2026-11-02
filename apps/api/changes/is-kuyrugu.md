---
etki: minor
---

Arka plan iş kuyruğu ve zamanlanmış işler (OG-094; ADR 0002, ADR 0003, DOM-ILT-039).

- `pg-boss@12.38.0` ile `src/jobs/`: kuyruk sunucu sürecinde açılır, Fastify `onClose` ile durur; kendi `pgboss` şemasını kurar ve yükseltir (Drizzle migration'ı yok). Yeni ortam değişkeni `JOBS_ENABLED` (`true`/`false`; verilmezse geliştirme ve üretimde açık, testte kapalı). Kuyruk kapalıyken açılıştaki `Idempotency-Key` temizliği sürer.
- Zamanlama Europe/Istanbul; çok örnekte tek tetikleme. Dağıtım işi kurum başına `{ institutionId }` yüklü tek iş koyar (`singletonKey` + `singletonSeconds`).
- İşler: `idempotency.purge` (her gün 03:30), `files.purge-unattached` (her saat :17; 24 saatte bağlanmayan yükleme silinir), `permission-forms.remind` (her gün 08:00; son güne iki gün kala ve son gün karar bekleyenlere `permission_form_reminder`, `dedupeKey` ile tek bildirim, `communication` kapalıysa iş yok).
- `purgeUnattachedFiles` ve `listStaleUnattachedFiles` artık kurum kimliği alır (kurum kapsamlı tarama). Uç ve OpenAPI değişmedi.
- Dayanıklılık: kuyruk açılamazsa API kuyruksuz açılır (hata yalnız `code`/`message` ile loglanır); zamanlama yalnız açık `RETIRED_JOBS` listesindekiler için silinir; işleyici hataları ve bozuk yükler hata nesnesi sızdırmadan işlenir (bozuk yük yeniden denenmez); izin formu hatırlatması İstanbul saatiyle 07:00'den önce çalışmaz.
