import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { ENROLLMENT_FUNNEL_ROLES } from '@kampus/school-core/lib/enrollment-funnel.ts'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { getEnrollmentFunnel } from '../services/enrollment-funnel.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  enrollmentFunnelQuerySchema,
  enrollmentFunnelResponseSchema,
} from './enrollment-funnel.schemas.ts'

/**
 * Kayıt hunisi raporu (docs/domain/kayit-ve-crm.md DOM-KAY-040; IST-117). Yalnız yönetici ve ön
 * büro (core `ENROLLMENT_FUNNEL_ROLES`), modül `crm`. Hesap core `enrollmentFunnel`'dadır; servis
 * kurumun adaylarından yalnız hunide okunan alanları yükler.
 */
export function registerEnrollmentFunnelRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get(
    '/api/v1/prospects/funnel',
    {
      preValidation: [app.requireModule('crm'), app.requireRole(ENROLLMENT_FUNNEL_ROLES)],
      schema: {
        operationId: 'getProspectFunnel',
        tags: ['prospects'],
        summary: 'Kayıt hunisi',
        description:
          'Aday → görüşme → deneme dersi (yalnız dil okulu) → kesin kayıt dönüşümü; toplam, kaynak ve danışman kırılımıyla (core `enrollmentFunnel`, DOM-KAY-040, IST-117). Kohort adayın açılış günüdür (`dateFrom`/`dateTo`, Europe/Istanbul, iki uç dahil; verilmezse bütün adaylar). Huni birikimlidir: ileri adıma ulaşan aday önceki adımları geçmiş sayılır. Oranlar yüzde, bir ondalık; payda 0 ise `null`. Danışman adayı açan personeldir; adı yalnız kurum üyesi için döner. Arşivlenen aday sayılmaz. Yanıt aday adı, iletişim bilgisi ve aday kimliği taşımaz. Bitiş başlangıçtan önceyse ya da bilinmeyen parametre varsa 400. Roller: `yonetici`, `onburo` (diğerleri 403); `crm` modülü kapalıysa 403 `module_disabled`.',
        querystring: enrollmentFunnelQuerySchema,
        response: {
          200: enrollmentFunnelResponseSchema,
          ...authenticatedErrors,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => ({ data: await getEnrollmentFunnel(contextOf(request), request.query) }),
  )
}
