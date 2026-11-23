import { z } from 'zod'

import { CONTRACT_STATUS_LABELS } from '@kampus/school-core/lib/contract-status.ts'
import type { ContractStatus } from '@kampus/school-core/lib/contract-status.ts'

import { contractRecordSchema } from '../db/contract-store.ts'
import { dataResponse } from './common.schemas.ts'

const CONTRACT_STATUSES = Object.keys(CONTRACT_STATUS_LABELS) as [
  ContractStatus,
  ...ContractStatus[],
]

export const ownContractsParamsSchema = z.object({
  studentId: z.string().min(1).max(200).describe('Kursiyerin öğrenci kimliği (oturumdaki kendisi)'),
})

/**
 * Kursiyerin sözleşme sürümü (IST-082, DOM-FIN-059): sözleşme kaydı veli koleksiyon okumasındakiyle
 * aynıdır (belge PDF'i bundan üretilir); durum ve plan özeti sunucuda hesaplanır.
 */
const ownContractSchema = z.object({
  contract: contractRecordSchema.describe('Sözleşme sürümünün kaydı (core sözleşme kaydı)'),
  status: z
    .enum(CONTRACT_STATUSES)
    .describe('Türetilmiş durum (core `contractStatus`; DOM-FIN-010, -051)'),
  plan: z
    .object({
      installmentCount: z.number().int().describe('Plan satırı sayısı (Ek 1)'),
      totalCents: z.number().int().describe('Plan toplamı (kuruş)'),
      paidCount: z.number().int().describe('Tamamı ödenmiş satır sayısı'),
      nextDue: z
        .object({
          date: z.string().describe('Vade günü (YYYY-MM-DD, Europe/Istanbul)'),
          amountCents: z.number().int(),
        })
        .nullable()
        .describe('Yürürlükteki sürümde vadesi en yakın ödenmemiş taksit'),
    })
    .describe('Ödeme planı özeti (core `contractPlanSummary`)'),
})

export const ownContractsResponseSchema = dataResponse(z.array(ownContractSchema))
