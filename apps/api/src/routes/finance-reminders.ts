import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { remindInstallmentCommand } from '../services/installment-reminders.ts'
import { idempotencyOf, sendCommand } from './command-support.ts'
import { rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'
import { emptyCommandBodySchema } from './workflows.schemas.ts'

/**
 * Taksit hatırlatma ucu (docs/domain/finans.md DOM-FIN-035; ON-113). Modül `finance`. Taksiti tahsil
 * eden personel hatırlatır: roller core `invoice.pay` rolleridir. Komut taksitin okunan sürümüne
 * bağlı değildir (yalnız son hatırlatma anını yazar), `If-Match` kabul etmez.
 */

const params = z.object({
  invoiceId: z.string().min(1).max(200).describe('Taksit kimliği'),
})
const responseSchema = z.object({
  data: commandResponseSchema.shape.data.extend({
    reminder: z
      .enum(['sent', 'already_sent'])
      .describe('`already_sent`: bugün zaten hatırlatıldı, yeni bildirim yazılmadı'),
  }),
})

export function registerFinanceReminderRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.post(
    '/api/v1/finance/invoices/:invoiceId/remind',
    {
      preValidation: [
        app.authenticate,
        app.requireModule('finance'),
        app.requireRole(WRITE_ACTION_ROLES['invoice.pay']),
        rejectIfMatch(),
      ],
      schema: {
        operationId: 'remindInstallment',
        tags: ['finance-reminders'],
        summary: 'Gecikmiş taksiti elle hatırlat',
        description:
          'Gecikmiş taksitte veliye (yetişkin kursiyerde kendisine) `installment_overdue` bildirimi yazar ve taksitin `reminderAt` alanını günceller (DOM-FIN-035). Aynı taksite günde en çok bir hatırlatma gider: bugün elle hatırlatıldıysa ya da tarama bugün gönderdiyse yeni bildirim yazılmaz, yanıt 200 `reminder: already_sent`. Tam ödenmiş taksit 422 `invoice_already_paid`, vadesi geçmemiş taksit 422 `invoice_not_overdue`, arşivlenmiş öğrenci 422 `invoice_student_archived`, bildirim merkezi kapalıysa 422 `notifications_disabled`. Başka kurumun taksiti 404. `Idempotency-Key` isteğe bağlı. Roller: `yonetici`, `onburo`.',
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params,
        body: emptyCommandBodySchema.strict().optional(),
        response: { 200: responseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await remindInstallmentCommand(
          contextOf(request),
          request.params.invoiceId,
          idempotencyOf(request, false),
        ),
        responseSchema,
      ),
  )
}
