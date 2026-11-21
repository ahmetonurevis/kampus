import { z } from 'zod'

import { OPENING_CHANGE_KINDS } from '@kampus/school-core/lib/finance-opening-watch.ts'

import { dataResponse } from './common.schemas.ts'

/** Açılış nöbeti yanıtı (DOM-FIN-061). Tutarlar kuruş, günler Europe/Istanbul `YYYY-MM-DD`. */

const studentFields = {
  studentId: z.string(),
  studentName: z.string().describe('Öğrenci ya da kursiyer adı; kayıt yoksa "—"'),
}

const installmentRow = z.object({
  invoiceId: z.string(),
  ...studentFields,
  className: z.string().nullable(),
  contractId: z.string().nullable(),
  installment: z.number().int(),
  dueDate: z.string(),
  amountCents: z.number().int(),
  remainingCents: z.number().int().describe('Kısmi ödeme düşülmüş kalan (DOM-FIN-030)'),
  status: z.enum(['overdue', 'due_soon']),
  overdueDays: z.number().int().describe('Vadeden sonraki ilk günden sayılan gecikme; yoksa 0'),
})

const contractRow = z.object({
  contractId: z.string(),
  ...studentFields,
  className: z.string().nullable(),
  status: z.enum(['awaiting_signatory', 'awaiting_approval']),
  revision: z.number().int(),
  contractAt: z.string(),
})

const changeRow = z.object({
  kind: z.enum(OPENING_CHANGE_KINDS),
  date: z.string(),
  ...studentFields,
  fromClassName: z.string().nullable(),
  toClassName: z.string().nullable(),
  withoutRenewal: z.boolean().describe('Ayrılışta: seçilen yıla yenileme hiç planlanmamış'),
})

const refundRow = z.object({
  withdrawalId: z.string(),
  ...studentFields,
  withdrawalDate: z.string(),
  refundCents: z.number().int(),
  refundDueDate: z.string(),
  overdueDays: z.number().int(),
})

export const openingWatchResponseSchema = dataResponse(
  z.object({
    academicYear: z.number().int(),
    today: z.string(),
    from: z.string(),
    to: z.string(),
    anchorDate: z.string().describe('Pencerenin dayandığı yıl ya da dönem başlangıç günü'),
    termId: z.string().nullable(),
    terms: z
      .array(
        z.object({ id: z.string(), name: z.string(), startDate: z.string(), endDate: z.string() }),
      )
      .describe('Seçilen yılın dönemleri (başlangıç sırasıyla)'),
    renewalModule: z.boolean().describe('Yenileme modülü açık mı; kapalıysa geçiş olayı yoktur'),
    firstInstallments: z.object({
      overdueCount: z.number().int(),
      overdueCents: z.number().int(),
      dueSoonCount: z.number().int(),
      dueSoonCents: z.number().int(),
      rows: z.array(installmentRow),
    }),
    unapprovedContracts: z.object({
      awaitingSignatoryCount: z.number().int(),
      awaitingApprovalCount: z.number().int(),
      rows: z.array(contractRow),
    }),
    enrollmentChanges: z.object({
      counts: z.object(
        Object.fromEntries(OPENING_CHANGE_KINDS.map((kind) => [kind, z.number().int()])) as Record<
          (typeof OPENING_CHANGE_KINDS)[number],
          z.ZodNumber
        >,
      ),
      withdrawnWithoutRenewal: z.number().int(),
      rows: z.array(changeRow),
    }),
    refunds: z.object({
      pendingCount: z.number().int(),
      pendingCents: z.number().int(),
      overdueCount: z.number().int(),
      overdueCents: z.number().int(),
      rows: z.array(refundRow),
    }),
  }),
)
