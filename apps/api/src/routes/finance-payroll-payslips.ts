import type { FastifyInstance, FastifyRequest, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  PAYROLL_PAYSLIP_ROLES,
  payrollPayslipQuerySchema,
} from '@kampus/school-core/lib/finance-payroll-payslips.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { payrollPayslipsFor } from '../services/finance-payroll-payslips.ts'
import { commandErrors } from './commands.schemas.ts'
import { payrollPayslipsResponse } from './finance-payroll-payslips.schemas.ts'
import { payrollMonthParams } from './finance-payroll-runs.schemas.ts'

/**
 * Ücret hesap pusulası ucu (docs/domain/finans.md DOM-FIN-119; ON-201). PDF web'de üretilir; uç
 * pusula verisini döner. Modül `finance`; yalnız yönetici (K-408). Her çağrı PDF üretimidir: taze
 * oturum ister, kullanıcı başına 10/dk, pusula başına denetim kaydı yazar.
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-408). Modül `finance`.'
const EXPORTS_PER_MINUTE = 10

export function registerFinancePayrollPayslipRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(PAYROLL_PAYSLIP_ROLES),
    async function (request, reply) {
      await app.requireFreshSession.call(app, request, reply)
    },
  ]

  typed.get(
    '/api/v1/finance/payroll-runs/:month/payslips',
    {
      config: {
        rateLimit: {
          max: EXPORTS_PER_MINUTE,
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            `payroll-payslip-export:${request.auth?.userId ?? request.ip}`,
        },
      },
      preValidation: guarded,
      schema: {
        operationId: 'getPayrollPayslips',
        tags: ['finance-payroll-runs'],
        summary: 'Ücret hesap pusulası verisi (PDF)',
        description: `Ayın etkin **kayıtlı** bordro hesabından ücret hesap pusulası verisi (DOM-FIN-119, K-406); canlı önizleme hesabından pusula üretilmez. \`membershipId\` verilirse tek pusula, verilmezse hesaptaki bütün personel (toplu PDF'te her biri ayrı sayfa), ada göre. Ay için kayıtlı hesap yoksa, personel kayıtlı hesapta değilse ya da başka kurumdaysa 404. Pusula: personel, görev, ay içi giriş/çıkış, çalışma/prim günü, eksik gün (nedeni yok), brüt kalemler, SGK ve işsizlik işçi payları, GV matrahı, önceki ve bu ay dahil kümülatif matrah, hesaplanan GV, asgari ücret GV ve DV istisnaları, DV, net, net düzeltme, bu ay kesilen kesintiler (avans, icra, BES; kaynak kimliği yok) ve ödenecek net; işveren payları ve maliyeti, sağlık raporu günü ve uyarılar yoktur (K-407). \`locked\` dönemin onaylı olup olmadığıdır; onaysız ayda pusula "dönem onaylanmadı" ibaresi taşır. Her çağrı taze oturum ister (eskiyse 403 \`reauthentication_required\`), kullanıcı başına 10/dk, pusula başına \`finance.payroll_payslip.export\` denetim kaydı yazar (satır kimliği, yalnız alan adları; K-408). Tutarlar mali müşavir doğrulaması bekler (ADR 0011). ${MANAGER}`,
        params: payrollMonthParams,
        querystring: payrollPayslipQuerySchema,
        response: { 200: payrollPayslipsResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await payrollPayslipsFor(
        contextOf(request),
        request.params.month,
        request.query.membershipId,
      ),
    }),
  )
}
