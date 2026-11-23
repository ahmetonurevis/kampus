import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  HEALTH_REPORT_KINDS,
  STAFF_DOCUMENT_TYPES,
} from '@kampus/school-core/lib/finance-staff-documents.ts'
import {
  STAFF_CHANGE_KINDS,
  STAFF_CHANGE_STATUSES,
} from '@kampus/school-core/lib/finance-staff-self-service.ts'
import { LEAVE_KINDS } from '@kampus/school-core/lib/finance-staff-leave.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'
import { leaveRequestListResponse } from './finance-leave-requests.schemas.ts'
import { personnelFileResponse } from './finance-personnel-files.schemas.ts'
import { staffDocumentDetailResponse } from './finance-staff-documents.schemas.ts'
import { leaveStaffDetailResponse } from './finance-staff-leave.schemas.ts'

/** Personel self-servisi şemaları (DOM-FIN-166; ON-189; K-553…K-555). */

const kind = z
  .enum(STAFF_CHANGE_KINDS)
  .describe(
    '`contact` adres ve telefon, `emergency_contacts` acil durum kişileri, `bank` IBAN ve hesap sahibi, `document` özlük belgesi',
  )
const status = z
  .enum(STAFF_CHANGE_STATUSES)
  .describe(
    '`pending` onay bekliyor, `approved` onaylandı, `rejected` reddedildi, `cancelled` geri çekildi',
  )

const file = personnelFileResponse.shape.data.shape

export const ownStaffProfileResponse = dataResponse(
  z.object({
    membershipId: z.string(),
    name: z.string().describe('Adınız (platform hesabından)'),
    role: z.string(),
    active: z.boolean(),
    file: z
      .object({
        version: z.number().int(),
        updatedAt: z.string(),
        identity: file.identity,
        contact: file.contact,
        education: file.education,
        bank: file.bank,
        emergencyContacts: file.emergencyContacts,
      })
      .nullable()
      .describe('Özlük kartınız, salt okunur; T.C. kimlik no ve IBAN maskeli. Kart yoksa boş'),
    pendingKinds: z.array(kind).describe('Onay bekleyen talebinizin olduğu türler'),
  }),
)

const proposal = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('contact'),
      // kvkk: K
      address: z.string().nullable().optional(),
      // kvkk: K
      phone: z.string().nullable().optional(),
    }),
    z.object({
      kind: z.literal('emergency_contacts'),
      // kvkk: K
      emergencyContacts: file.emergencyContacts.unwrap(),
    }),
    z.object({
      kind: z.literal('bank'),
      ibanMasked: z.string().describe('Maskeli IBAN; tam IBAN hiçbir okumada dönmez'),
      // kvkk: K
      accountHolder: z.string(),
    }),
    z.object({
      kind: z.literal('document'),
      documentType: z.enum(STAFF_DOCUMENT_TYPES),
      healthReportKind: z.enum(HEALTH_REPORT_KINDS).nullable(),
      documentDate: z.string(),
      // kvkk: K (serbest metin)
      note: z.string().nullable(),
      hasFile: z.boolean().describe('Dosya eklenmiş mi; dosya yalnız yöneticinin ucundan açılır'),
    }),
  ])
  .describe('Önerilen değerler; verilmeyen iletişim alanı değişmez, `null` temizler')

const changeRequestSchema = z
  .object({
    id: z.string(),
    // kvkk: K (personel üyeliği)
    membershipId: z.string(),
    name: z.string().describe('Talep eden personel'),
    role: z.string(),
    kind,
    status,
    proposal,
    staffDocumentId: z
      .string()
      .nullable()
      .describe('Onaylanan belge talebinin açtığı özlük belgesi'),
    decidedByName: z.string().nullable(),
    decidedAt: z.string().nullable(),
    // kvkk: K (serbest metin)
    rejectionReason: z.string().nullable().describe('Ret gerekçesi'),
    createdAt: z.string(),
    version: z.number().int().describe('`If-Match` için talep sürümü'),
  })
  .meta({ id: 'StaffChangeRequest' })

export const staffChangeRequestResponse = dataResponse(changeRequestSchema)
export const staffChangeRequestListResponse = z.object({
  data: z.array(changeRequestSchema),
  meta: pageMetaSchema,
})

export const ownChangeRequestListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: status.optional(),
})

export const staffChangeRequestListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  status: status.optional(),
  kind: kind.optional(),
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
})

export const staffChangeRequestParams = z.object({ requestId: z.uuid('Talep geçersiz.') })

const documents = staffDocumentDetailResponse.shape.data.shape

export const ownStaffDocumentsResponse = dataResponse(
  z.object({
    missingTypes: documents.missingTypes,
    documents: documents.documents,
  }),
)

const leave = leaveStaffDetailResponse.shape.data.shape

export const ownLeaveQuery = z.strictObject({
  date: daySchema.optional().describe('Bakiyenin hesaplanacağı gün; varsayılan bugün'),
})

export const ownLeaveResponse = dataResponse(
  z.object({
    date: z.string().describe('Bakiyenin hesaplandığı gün'),
    seniorityStartDate: z.string().nullable().describe('Kıdem başlangıcı; izin profili yoksa boş'),
    entitlement: leave.entitlement,
    records: leave.records,
    requests: leaveRequestListResponse.shape.data.describe('Son 50 izin talebiniz'),
    types: z
      .array(
        z.object({
          code: z.string(),
          label: z.string(),
          kind: z.enum(LEAVE_KINDS),
          paid: z.boolean(),
          deductsFromAnnual: z.boolean(),
        }),
      )
      .describe('Talep açılabilecek etkin izin türleri'),
  }),
)

export const ownLeaveRequestResponse = dataResponse(leaveRequestListResponse.shape.data.element)

export const ownPayslipMonthsResponse = dataResponse(
  z
    .array(
      z.object({
        month: z.string(),
        runId: z.uuid(),
        revision: z.number().int(),
        calculatedAt: z.string(),
      }),
    )
    .describe('Onaylı dönemlerde pusulanız olan aylar, yeniden eskiye'),
)
