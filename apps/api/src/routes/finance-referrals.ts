import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  REFERRAL_CANCEL_REASONS,
  REFERRAL_REWARD_STATUSES,
} from '@kampus/school-core/lib/finance-referrals.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { listReferralRewardsFor } from '../services/finance-referrals.ts'
import { commandErrors } from './commands.schemas.ts'
import { pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Referans indirimi hakkı listesi (docs/domain/finans.md DOM-FIN-024; ON-139). Modül `finance`. Hak
 * kesin kayıtta açılır, tahsilatta doğar, kesin kayıt ya da yenilemede `referralRewardId` ile
 * kullanılır; ayrı yazma ucu yoktur. Personel kurumun hakkını, veli ve öğrenci kendi kapsamını görür.
 */

const rewardSchema = z.object({
  id: z.string(),
  academicYear: z.number().int().describe('Referansla gelen kaydın eğitim yılı'),
  status: z.enum(REFERRAL_REWARD_STATUSES),
  referrerStudentId: z.string().describe('Referans veren öğrenci'),
  referrerStudentName: z.string().nullable(),
  percentBasisPoints: z
    .number()
    .int()
    .nullable()
    .describe('Kayıt yılı tarifesindeki oran, on binde birlik'),
  amountCents: z.number().int().nullable().describe('Kayıt yılı tarifesindeki tutar, kuruş'),
  earnedAt: z.string().nullable().describe('İlk taksitin ödenmesiyle hakkın doğduğu an'),
  usedAt: z.string().nullable(),
  usedAmountCents: z.number().int().nullable().describe('Sözleşmeye uygulanan tutar, kuruş'),
  cancelledAt: z.string().nullable(),
  prospectId: z.string().nullable().describe('Aday; yalnız personele döner'),
  referredStudentId: z.string().nullable().describe('Referansla gelen öğrenci; yalnız personele'),
  referredStudentName: z.string().nullable().describe('Yalnız personele döner'),
  referrerParentId: z.string().nullable().describe('Hakkın sahibi veli; yalnız personele'),
  cancelReason: z
    .enum(REFERRAL_CANCEL_REASONS)
    .nullable()
    .describe('İptal gerekçesi; yalnız personele döner'),
})

export function registerFinanceReferralRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get(
    '/api/v1/finance/referral-rewards',
    {
      preValidation: [
        app.authenticate,
        app.requireModule('finance'),
        app.requireRole(['yonetici', 'onburo', 'veli', 'ogrenci']),
      ],
      schema: {
        operationId: 'listReferralRewards',
        tags: ['finance-referrals'],
        summary: 'Referans indirimi haklarını listele',
        description:
          'Yeni hak önce (DOM-FIN-024). `status`, `parentId` (hak sahibi veli) ve `familyOfStudentId` (öğrencinin velisinin hakları) süzer. Roller: `yonetici` ve `onburo` kurum geneli; `veli` ve `ogrenci` yalnız finans kapsamındaki öğrencinin hakkını görür, yanıtta aday ve referansla gelen öğrenci bulunmaz, doğmamış hak listelenmez.',
        querystring: z.strictObject({
          ...pageQuerySchema.shape,
          status: z.enum(REFERRAL_REWARD_STATUSES).optional(),
          parentId: z.string().min(1).max(100).optional(),
          familyOfStudentId: z.string().min(1).max(100).optional(),
        }),
        response: {
          200: z.object({ data: z.array(rewardSchema), meta: pageMetaSchema }),
          ...commandErrors,
        },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listReferralRewardsFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )
}
