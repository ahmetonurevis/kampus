import type { FastifyInstance, FastifyRequest, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { TRANSPORT_ROSTER_ROLES } from '@kampus/school-core/lib/finance-transport-roster.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { assertSchoolLifeModule } from '../services/finance-transport.ts'
import { transportRosterFor } from '../services/finance-transport-roster.ts'
import { commandErrors } from './commands.schemas.ts'
import { routeParams } from './finance-transport.schemas.ts'
import {
  transportRosterQuery,
  transportRosterResponse,
} from './finance-transport-roster.schemas.ts'

/**
 * Servis listesi ucu (docs/domain/finans.md DOM-FIN-148; ON-148; IST-028). Modüller `finance` ve
 * `transport`; yönetici ve ön büro okur, tam telefonlu `driver` amacı yalnız yönetici (K-500).
 * Öğrenci ve veli iletişimi taşıdığı için taze oturum ister, kullanıcı başına 10/dk; her okuma
 * denetime düşer. Sıra: 401 → 403 modül → 403 rol → taze oturum → 400 → 403 amaç → işlem.
 */

const ROSTER_PER_MINUTE = 10

export function registerFinanceTransportRosterRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const schoolLife: preValidationAsyncHookHandler = async (request) =>
    assertSchoolLifeModule(contextOf(request), 'transport')

  typed.get(
    '/api/v1/finance/transport/routes/:routeId/roster',
    {
      config: {
        rateLimit: {
          max: ROSTER_PER_MINUTE,
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            `transport-roster:${request.auth?.userId ?? request.ip}`,
        },
      },
      preValidation: [
        app.authenticate,
        app.requireModule('finance'),
        schoolLife,
        app.requireRole(TRANSPORT_ROSTER_ROLES),
        app.requireFreshSession,
      ],
      schema: {
        operationId: 'getTransportRoster',
        tags: ['finance-transport'],
        summary: 'Servis listesi (PDF verisi)',
        description:
          "Güzergâhın (araç × yön) etkin atamaları durak sırasıyla; durakta öğrenciler ada göre: ad, sınıf, durak ve saat, acil iletişim (velayetli ve iletişim kısıtı olmayan veli bağları, bağ yoksa öğrenci kaydındaki veli; en çok iki kişi; ad, yakınlık, telefon). Ayrılan, mezun ve arşivli öğrenci listede yok (K-499, K-501). Sağlık ve alerji bilgisi dönmez. `purpose=office` (varsayılan) veli telefonu maskeli; `purpose=driver` sürücüye verilecek liste, veli telefonu tam, yalnız `yonetici` (ön büroya 403 `transport_roster_driver_forbidden`) (K-500). Sürücü telefonu her amaçta maskeli (K-481). Web PDF'i bu veriden üretir. Taze oturum ister (eskiyse 403 `reauthentication_required`), kullanıcı başına 10/dk; her okuma denetime düşer: `office` `finance.transport.roster_export`, `driver` `finance.transport.roster_driver_export` (alan adları ve satır sayısı; telefon ve öğrenci kimliği yazılmaz). Olmayan, arşivli ya da başka kurumun güzergâhı 404. Rol: `yonetici`, `onburo`; modüller `finance` ve `transport` (kapalıysa 403).",
        params: routeParams,
        querystring: transportRosterQuery,
        response: { 200: transportRosterResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await transportRosterFor(
        contextOf(request),
        request.params.routeId,
        request.query.purpose,
      ),
    }),
  )
}
