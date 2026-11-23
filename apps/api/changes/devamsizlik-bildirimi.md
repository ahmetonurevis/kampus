---
etki: minor
---

Yoklamada "gelmedi" işaretlenen öğrenci için anlık uygulama içi bildirim (OG-043, IST-072; `docs/domain/iletisim-ve-veli.md` DOM-ILT-052). Core tarafı `packages/school-core/changes/devamsizlik-bildirimi.md`'dedir.

- `POST /api/v1/classes/:classId/attendance` öğrenci "gelmedi" durumuna geçince, yoklamayla aynı transaction'da (`after`) `notify` ile `absence_recorded` yazar: 18 yaş altında velilere, dil okulunda yetişkin kursiyerde kendisine. Yoklama reddedilirse bildirim de yoktur. Aynı durumu yeniden kaydetmek yinelemez; "gelmedi" düzeltilirse ayrı `absence_corrected` bildirimi yazılır (önceki bildirim kalır; yalnız ilk bildirim gerçekten yazılmışsa). İletişim ya da akademik modül kapalıysa yazılmaz, sonradan kapanırsa listeden düşer.
- İletişim kısıtlı ya da velayeti olmayan veli bildirimi okuma kapsamında görmez (mevcut `guardedActorLinks`). Bildirim yalnız yoklama kimliğini taşır.
- `GET /api/v1/notifications` yanıtındaki `kind` listesine iki tür eklendi. `notify.ts` `dedupedNotificationId` dışa açıldı. OpenAPI ve `api-client` şeması yeniden üretildi.
