import { z } from 'zod'

import {
  BUDGET_ITEM_KINDS,
  BUDGET_PERIOD_STATUSES,
} from '@kampus/school-core/lib/finance-budget.ts'
import {
  BUDGET_DRAFT_EVENTS,
  BUDGET_DRAFT_STATUSES,
} from '@kampus/school-core/lib/finance-budget-drafts.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Bütçe taslağı ve bütçe sorumlusu şemaları (DOM-FIN-093; ON-243). Tutarlar kuruş. */

const cents = (description: string) => z.number().int().describe(description)
const optionalCents = (description: string) => z.number().int().nullable().describe(description)

const ownerSchema = z
  .object({
    membershipId: z.string().describe('Sorumlunun kurum üyeliği'),
    name: z.string().nullable().describe('Sorumlunun adı'),
  })
  .nullable()
  .describe('Merkezin bütçe sorumlusu; yoksa taslağı yalnız yönetici hazırlar (K-257)')

const actionsSchema = z
  .object({
    edit: z.boolean(),
    submit: z.boolean(),
    approve: z.boolean(),
    requestRevision: z.boolean(),
    reject: z.boolean(),
    reopen: z.boolean(),
  })
  .describe('Oturumdaki kullanıcının bu taslakta yapabileceği işlemler (ekran düğmeleri)')

const draftSchema = z.object({
  id: z.string(),
  period: z.object({
    id: z.string(),
    name: z.string(),
    status: z.enum(BUDGET_PERIOD_STATUSES),
    startDate: z.string(),
    endDate: z.string(),
  }),
  costCenter: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    path: z.string().describe('Kökten merkeze kod yolu'),
    isActive: z.boolean(),
  }),
  owner: ownerSchema,
  status: z.enum(BUDGET_DRAFT_STATUSES),
  revision: z.number().int().describe('Son gönderimin sürüm numarası; gönderilmemişse 0'),
  approvedRevision: z.number().int().nullable().describe('Son onaylanan sürüm'),
  approvedAt: z.string().nullable(),
  approvedByName: z.string().nullable(),
  createdByName: z.string().nullable(),
  submittedAt: z.string().nullable(),
  submittedByName: z.string().nullable(),
  decisionNote: z
    .string()
    .nullable()
    .describe('Son kararın notu: revizyon isteği ya da ret gerekçesi, onay notu'),
  incomeCents: cents('Taslağın gelir kalemleri toplamı'),
  expenseCents: cents('Taslağın gider kalemleri toplamı'),
  lineCount: z.number().int(),
  actions: actionsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const lineSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  itemKind: z.enum(BUDGET_ITEM_KINDS),
  itemActive: z.boolean().describe('Kalem pasifleştiyse `false`; taslakta kalabilir'),
  amountCents: cents('Planlanan tutar'),
  justification: z.string().nullable(),
})

const eventSchema = z.object({
  id: z.string(),
  event: z.enum(BUDGET_DRAFT_EVENTS),
  fromStatus: z.enum(BUDGET_DRAFT_STATUSES).nullable(),
  toStatus: z.enum(BUDGET_DRAFT_STATUSES),
  revision: z.number().int().describe('Adımın sürüm numarası'),
  note: z.string().nullable(),
  actorName: z.string().nullable(),
  occurredAt: z.string(),
  changes: z
    .array(
      z.object({
        itemId: z.string(),
        itemCode: z.string(),
        itemName: z.string(),
        beforeCents: optionalCents('Önceki sürümdeki tutar; yeni kalemde boş'),
        afterCents: optionalCents('Bu sürümdeki tutar; çıkarılan kalemde boş'),
      }),
    )
    .nullable()
    .describe('Yalnız gönderimde: önceki sürüme (ilk gönderimde onaylı bütçeye) göre değişenler'),
})

export const budgetDraftResponse = dataResponse(
  draftSchema.extend({
    lines: z.array(lineSchema),
    events: z.array(eventSchema).describe('Revizyon geçmişi, eskiden yeniye'),
  }),
)
export const budgetDraftListResponse = z.object({
  data: z.array(draftSchema),
  meta: pageMetaSchema,
})
export const budgetDraftParams = z.object({ draftId: z.uuid('Taslak geçersiz.') })
export const budgetDraftListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  periodId: z.uuid().optional().describe('Bütçe dönemi'),
  costCenterId: z.uuid().optional().describe('Maliyet merkezi (birim)'),
  status: z.enum(BUDGET_DRAFT_STATUSES).optional().describe('Durum'),
})

const totalsSchema = z.object({
  draftCents: z.number().int(),
  approvedCents: z.number().int(),
  previousPlanCents: z.number().int(),
  previousActualCents: z.number().int().nullable(),
})

export const budgetDraftComparisonResponse = dataResponse(
  z.object({
    draftId: z.string(),
    basis: z.literal('accrual').describe('Önceki dönem gerçekleşeni tahakkuk esaslıdır'),
    previousPeriod: z
      .object({ id: z.string(), name: z.string(), startDate: z.string(), endDate: z.string() })
      .nullable()
      .describe('Bu dönemden önce biten son açık ya da kapalı dönem (K-259); yoksa boş'),
    rows: z.array(
      z.object({
        itemId: z.string(),
        itemCode: z.string(),
        itemName: z.string(),
        itemKind: z.enum(BUDGET_ITEM_KINDS),
        draftCents: optionalCents('Taslaktaki tutar; kalem taslakta yoksa boş'),
        justification: z.string().nullable(),
        approvedCents: optionalCents('Bu dönemin onaylı bütçesi; satır yoksa boş'),
        previousPlanCents: optionalCents('Önceki dönemin planı'),
        previousActualCents: optionalCents('Önceki dönemin gerçekleşeni; hesaplanmıyorsa boş'),
        changeFromPreviousCents: optionalCents('Taslak − önceki dönem gerçekleşeni'),
      }),
    ),
    totals: z.object({ income: totalsSchema, expense: totalsSchema }),
  }),
)

export const budgetDraftOptionsResponse = dataResponse(
  z.object({
    periods: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        status: z.enum(BUDGET_PERIOD_STATUSES),
        startDate: z.string(),
        endDate: z.string(),
      }),
    ),
    centers: z.array(
      z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        path: z.string(),
        owner: ownerSchema,
        canPrepare: z.boolean().describe('Oturumdaki kullanıcı bu merkezin taslağını hazırlar'),
      }),
    ),
    items: z.array(
      z.object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        kind: z.enum(BUDGET_ITEM_KINDS),
      }),
    ),
  }),
)

export const budgetOwnerParams = z.object({ costCenterId: z.uuid('Maliyet merkezi geçersiz.') })
export const budgetOwnerResponse = dataResponse(
  z.object({ costCenterId: z.string(), owner: ownerSchema }),
)
