---
etki: minor
---

Denetim girdisi işlemi yapan kullanıcıyı oturumdan alır (OG-037; IST-014).

- `Session` isteğe bağlı `userId` alanı kazandı (`kvkk: K`). `runWorkflow` denetim girdisinin `user_id` alanına bu kimliği yazar; oturum kimlik taşımıyorsa çevrimdışı demo değerleri aynen korunur (öğretmen/öğrenci kaydı, veli için `DEMO_PARENT_ID`, idari roller için `demo-<rol>`).
- API işlem ortamı (`environment`) core oturumuna `ctx.actor.userId` verir; `audit_log.actor_user_id` zaten her yazma yolunda aktörle dolar.
- `TODO(core-audit-user)` kaldırıldı.
