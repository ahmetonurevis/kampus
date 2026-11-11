---
etki: minor
---

Uygulama içi bildirim merkezi (F6a, OG-003; IST-065'in ilk parçası; `docs/domain/iletisim-ve-veli.md` DOM-ILT-020, DOM-ILT-022, DOM-ILT-023, DOM-ILT-073; DOM-BEC-045).

- Yeni uçlar eklendi: `GET /api/v1/notifications` (imleçli: `cursor`, `limit` ≤ 100, `unread`; `meta.nextCursor`, toplam yok), `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/:notificationId/read` ve `POST /api/v1/notifications/read-all` (`Idempotency-Key` isteğe bağlı, `If-Match` 400). Modül `communication`; kapalıysa 403 `module_disabled`. Öğrenci kendi, veli bağlı çocuğunun veli bildirimini görür; görülemeyen bildirim 404, bozuk imleç 400 (DOM-ILT-073). Okundu kullanıcıya özeldir.
- Okuma uçları kimlik, modül ve rol denetimini sorgu doğrulamasından önce (`preValidation`) yapar; oturumsuz geçersiz sorgu 401, modül kapalıyken 403 `module_disabled` alır.
- Kayıtlar `records` tabanlıdır (`notifications`, `notificationReads`; migration yok) ve genel koleksiyon okumasına kapalıdır. Log ve denetime yalnız alan adları girer (DOM-ILT-023).
- Puanı kesinleştirip geri bildirimi açan yazma (ilk puan, uyuşan ikinci puan ya da uyuşmazlıkta koordinatör son puanı: `POST /task-submissions/:submissionId/scores`, `/second-scores`, `/final-scores`) aynı transaction'da öğrenciye ve 18 yaş altında veliye `feedback_released` bildirimi yazar (DOM-BEC-045); yazma başarısızsa bildirim de geri alınır. Bildirim kaydının denetim satırı ayrı `notification.create` eylemiyle (`runCommand` `auditAction`) düşer, puanın tek `task_submission.score`/`second_score`/`final_score` satırı kalır.
- Kesin kayıt `enrollment_completed` bildirimini henüz üretmiyor; tür core'da kayıtlıdır (`TODO(onur-istek)`: kesin kayıt bildirimi). Sayım ifade indeksi gelene kadar kurumun bildirim satırlarını tarar (`TODO(F6-bildirim-indeksi)`).
- OpenAPI ve `api-client` şeması yeniden üretildi.
