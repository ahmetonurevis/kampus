---
etki: minor
---

İzin formu uçları etkinlik ayrıntısı ve iptal aldı (OG-254; DOM-ILT-032). `POST` ve `PATCH /api/v1/permission-forms` isteğe bağlı `eventDate`, `eventTime`, `location`, `transport` ve `fee` (kuruş) alır; geçmiş etkinlik günü 422 `permission_form_event_in_past`. Gün, saat, yer, ulaşım ya da ücret değişince `detailsRevision` artar, alınmış kararlar silinmeden düşer (`current: false`) ve kararı düşenlere aynı işlemde `permission_form_reconsent` bildirimi yazılır. Yeni `POST /api/v1/permission-forms/:formId/cancel` formu kapatır, `cancelledAt` işaretler ve izin vermiş ya da bekleyen öğrencilerin kararı veren tarafına `permission_form_cancelled` yazar; ikinci iptal 409 `permission_form_cancelled`. Migration yok. Son günü geçmiş açık formda izni düşürecek değişiklik 422 `permission_form_deadline_passed`; son gün etkinlik gününden sonra olamaz (422 `permission_form_deadline_after_event`, DOM-ILT-044).
