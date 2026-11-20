import { z } from 'zod'

import {
  EDUCATION_LEVELS,
  PERSONNEL_FILE_GROUPS,
  readablePersonnelFileGroups,
  type PersonnelFileGroup,
} from '@kampus/school-core/lib/finance-personnel-files.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/**
 * Personel özlük kartı şemaları (DOM-FIN-140; ON-172). Grup anahtarları (`identity`, `contact`,
 * `education`, `bank`, `emergencyContacts`) yalnız rolün okuyabildiği gruplarda bulunur (K-475):
 * rota yanıtı `personnelFileResponseFor(role)` ile süzer, şemada olmayan grup istemciye gitmez.
 * T.C. kimlik no ve IBAN yalnız maskeli alanlardadır (K-476).
 */

const groupSchema = z.enum(PERSONNEL_FILE_GROUPS)

const identityView = z
  .object({
    nationalIdMasked: z
      .string()
      .nullable()
      .describe('Maskeli T.C. kimlik no (`*******1234`); tam hâli ayrı uçtan'),
    birthDate: z.string().nullable().describe('Doğum günü (YYYY-MM-DD)'),
  })
  .describe('Kimlik grubu; yalnız okuyabilen rolde bulunur')
const contactView = z
  .object({
    address: z.string().nullable(),
    phone: z.string().nullable().describe('Kişisel telefon'),
    email: z.string().nullable().describe('Kişisel e-posta'),
  })
  .describe('Kişisel iletişim grubu; yalnız okuyabilen rolde bulunur')
const educationView = z
  .array(
    z.object({
      level: z.enum(EDUCATION_LEVELS),
      school: z.string(),
      department: z.string().nullable(),
      graduationYear: z.number().int().nullable().describe('Boşsa öğrenim sürüyor'),
    }),
  )
  .describe('Eğitim geçmişi; yalnız okuyabilen rolde bulunur')
const bankView = z
  .object({
    ibanMasked: z
      .string()
      .nullable()
      .describe('Maskeli IBAN (`TR**…1326`); tam IBAN hiçbir okumada dönmez'),
    accountHolder: z.string().nullable(),
  })
  .describe('Banka grubu; yalnız yönetici ve muhasebede bulunur')
const emergencyView = z
  .array(z.object({ name: z.string(), relation: z.string(), phone: z.string() }))
  .describe('Acil durum kişileri; yalnız okuyabilen rolde bulunur')
const certificatesView = z
  .object({
    count: z.number().int().describe('Yerine geçilmemiş sertifika/kurs belgesi sayısı'),
    expiredCount: z.number().int().describe('Süresi geçmiş olanlar'),
    latestDate: z.string().nullable().describe('En yeni belge günü'),
  })
  .describe('Özlük belgelerinden sertifika özeti (DOM-FIN-113); eğitim grubuyla birlikte bulunur')

const baseFile = {
  membershipId: z.string(),
  name: z.string().describe('Personelin adı (platform hesabından)'),
  role: z.string().describe('Personelin rolü'),
  active: z.boolean().describe('Üyelik etkin mi (pasifse ayrılmış)'),
  version: z.number().int().describe('Kart sürümü; düzeltmede If-Match'),
  updatedAt: z.string(),
  access: z
    .partialRecord(groupSchema, z.enum(['read', 'write']))
    .describe('Okuyanın grup erişimi; okuyamadığı grup yoktur'),
  canRevealNationalId: z.boolean().describe('Tam T.C. kimlik no ucunu çağırabilir mi'),
}

const personnelFileSchema = z
  .object({
    ...baseFile,
    identity: identityView.optional(),
    contact: contactView.optional(),
    education: educationView.optional(),
    certificates: certificatesView.optional(),
    bank: bankView.optional(),
    emergencyContacts: emergencyView.optional(),
  })
  .meta({ id: 'PersonnelFile' })

export const personnelFileResponse = dataResponse(personnelFileSchema)

/**
 * Rolün yanıt şeması (K-475): okunamayan grubun anahtarı şemada yoktur, `parse` onu atar.
 * Sertifika özeti eğitim grubuna bağlıdır.
 */
export function personnelFileResponseFor(
  role: string,
): z.ZodType<z.output<typeof personnelFileResponse>> {
  const readable = new Set(readablePersonnelFileGroups(role))
  const hidden: Partial<Record<PersonnelFileGroup | 'certificates', true>> = {}
  for (const group of PERSONNEL_FILE_GROUPS) if (!readable.has(group)) hidden[group] = true
  if (!readable.has('education')) hidden.certificates = true
  return dataResponse(personnelFileSchema.omit(hidden))
}

const staffRow = z.object({
  membershipId: z.string(),
  name: z.string(),
  role: z.string(),
  active: z.boolean(),
  hasFile: z.boolean().describe('Özlük kartı açılmış mı'),
  version: z.number().int().nullable().describe('Kart sürümü; kart yoksa boş'),
  updatedAt: z.string().nullable(),
  filledGroups: z
    .array(groupSchema)
    .describe('Dolu gruplar; yalnız okuyanın görebildiği gruplar sayılır'),
})
export const personnelFileListResponse = z.object({
  data: z.array(staffRow),
  meta: pageMetaSchema,
})

export const personnelFileListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  q: z.string().trim().min(2).max(100).optional().describe('Personel adında arama'),
  status: z
    .enum(['active', 'passive'])
    .optional()
    .describe('`active` etkin, `passive` pasifleştirilmiş (ayrılan) personel'),
  file: z
    .enum(['with', 'without'])
    .optional()
    .describe('`with` kartı olan, `without` kartı olmayan personel'),
})

export const personnelFileParams = z.object({
  membershipId: z.string().trim().min(1).max(100).describe('Personelin kurum üyeliği'),
})

export const personnelNationalIdResponse = dataResponse(
  z.object({
    nationalId: z.string().nullable().describe('Tam T.C. kimlik no; kartta yoksa boş'),
  }),
)
