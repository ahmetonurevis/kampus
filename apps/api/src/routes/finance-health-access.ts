import type { FastifyInstance, FastifyRequest, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  HEALTH_ACCESS_LOG_ROLES,
  HEALTH_ACCESS_NOTE_HEADER,
  HEALTH_ACCESS_REASON_HEADER,
  healthAccessReasonRequired,
  parseHealthAccessReasonHeaders,
  type HealthAccessReason,
} from '@kampus/school-core/lib/finance-health-access.ts'

import { AppError } from '../errors.ts'
import { authOf, contextOf } from '../plugins/authenticate.ts'
import { listHealthAccessLogFor } from '../services/finance-health-access.ts'
import { commandErrors } from './commands.schemas.ts'
import { healthAccessLogQuery, healthAccessLogResponse } from './finance-health-access.schemas.ts'

/**
 * Sağlık verisi okuma gerekçesi (docs/domain/finans.md DOM-FIN-156; ON-164; K-523…K-525).
 *
 * Sağlık ayrıntısı dönen okuma ucu üç parça kullanır: `schema.headers` için
 * `healthAccessHeadersSchema(required)`, `preValidation` sonuna `requireHealthAccessReason()` ve
 * işleyicide `healthAccessReasonOf(request)` → servisin `recordHealthRead` çağrısı. Kanca kimlik ve
 * rol denetiminden sonra, Zod doğrulamasından önce çalışır: personel rolünde gerekçe yoksa 400
 * `health_access_reason_required`, geçersizse 400 `health_access_reason_invalid` (alan yolları
 * başlık adıdır); veli ve öğrenci için gerekçe sorulmaz ve `null` döner. Gerekçe başlıkta taşınır;
 * istek logu (`app.ts` `req` serileştiricisi) yalnız yöntem, sorgusuz adres ve maskeli IP yazar.
 */

const reasons = new WeakMap<FastifyRequest, HealthAccessReason | null>()

export function requireHealthAccessReason(): preValidationAsyncHookHandler {
  return async function (request) {
    if (!healthAccessReasonRequired(authOf(request).role)) {
      reasons.set(request, null)
      return
    }
    const parsed = parseHealthAccessReasonHeaders({
      code: request.headers[HEALTH_ACCESS_REASON_HEADER],
      note: request.headers[HEALTH_ACCESS_NOTE_HEADER],
    })
    if (!parsed.ok) throw new AppError(400, parsed.code, parsed.message, { issues: parsed.issues })
    reasons.set(request, parsed.reason)
  }
}

/** Kancanın çözdüğü gerekçe; gerekçe sorulmayan rolde `null`. Kanca bağlanmadıysa hata. */
export function healthAccessReasonOf(request: FastifyRequest): HealthAccessReason | null {
  const reason = reasons.get(request)
  if (reason === undefined) throw new Error('requireHealthAccessReason hook did not run')
  return reason
}

export function registerFinanceHealthAccessRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  typed.get(
    '/api/v1/finance/health-access-logs',
    {
      preValidation: [
        app.authenticate,
        app.requireModule('finance'),
        app.requireRole(HEALTH_ACCESS_LOG_ROLES),
      ],
      schema: {
        operationId: 'listHealthAccessLogs',
        tags: ['finance-health-access'],
        summary: 'Sağlık verisi erişim günlüğü',
        description:
          'Gerekçeyle açılan sağlık okumaları (kaza tutanağı, revir ziyareti, ilaç talebi ve uygulama listesi), en yeni önce: kim, ne zaman, hangi kaydı, hangi gerekçeyle. Süzgeç okuyan üyelik, öğrenci, gerekçe kodu ve okuma günü aralığı (Europe/Istanbul). Sağlık değeri dönmez; "diğer" gerekçenin açıklaması döner. Günlük okuması denetlenmez. Rol: yalnız `yonetici` (DOM-YTK-053). Modül `finance`.',
        querystring: healthAccessLogQuery,
        response: { 200: healthAccessLogResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, actorMembershipId, studentId, reasonCode, from, to } = request.query
      const { items, total } = await listHealthAccessLogFor(contextOf(request), {
        page,
        pageSize,
        actorMembershipId,
        studentId,
        reasonCode,
        from,
        to,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )
}
