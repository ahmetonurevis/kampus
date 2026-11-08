import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  SEASON_WATCH_ROLES,
  seasonWatchQuerySchema,
} from '@kampus/school-core/lib/prospect-season-watch.ts'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { getProspectSeasonWatch } from '../services/prospect-season-watch.ts'
import { authenticatedErrors } from './common.schemas.ts'
import { seasonWatchResponseSchema } from './prospect-season-watch.schemas.ts'

/**
 * Kayıt sezonu nöbeti (docs/domain/kayit-ve-crm.md DOM-KAY-037; IST-079, IST-091; ON-077). Yalnız
 * yönetici ve ön büro (core `SEASON_WATCH_ROLES`, K-179), modül `crm`. Hesap core
 * `prospectSeasonWatch`'tadır; hiçbir şey yazmaz.
 */
export function registerProspectSeasonWatchRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get(
    '/api/v1/prospects/season-watch',
    {
      preValidation: [app.requireModule('crm'), app.requireRole(SEASON_WATCH_ROLES)],
      schema: {
        operationId: 'getProspectSeasonWatch',
        tags: ['prospects'],
        summary: 'Kayıt sezonu nöbeti: görüşmeler, deneme dersleri, geciken takipler',
        description:
          'Açık adayların bugün ve yakın günlerde ilgilenilmesi gerekenleri (DOM-KAY-037). Pencere bugünden başlar, bugün dahil `days` gün (1–14, varsayılan 7; Europe/Istanbul). `meetings`: penceredeki tanışma görüşmeleri, saat sırasıyla (bitişi geçen `held`). `trials`: yalnız dil okulunda penceredeki deneme dersleri; gün dersin güncel kaydından, iptal edilen ya da programdan kalkan derse bağlı deneme yok. `followUps`: şu andan sonra başlayan görüşmesi ya da denemesi olmayan açık aday, ilk tutan nedenle bir kez (`first_contact`: açılışın ertesi gününe giren `Yeni aday`; `meeting_outcome`/`trial_outcome`: önceki bir gün yapılmış, aşaması hâlâ `Görüşme planlandı` ve sonrasında not yok; `stale`: son işlem 7 gün ya da daha eski); en çok gecikenler önce. Her bölüm toplamla birlikte en çok 50 satır döner. Satır aday kimliği, adı, aşaması ve kampüsünü taşır; telefon, e-posta, veli, not, ilgi ve kaynak dönmez. Arşivlenen aday sayılmaz. Bilinmeyen parametre ya da aralık dışı `days` 400. Roller: `yonetici`, `onburo` (diğerleri 403); `crm` modülü kapalıysa 403 `module_disabled`.',
        querystring: seasonWatchQuerySchema,
        response: {
          200: seasonWatchResponseSchema,
          ...authenticatedErrors,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => ({ data: await getProspectSeasonWatch(contextOf(request), request.query) }),
  )
}
