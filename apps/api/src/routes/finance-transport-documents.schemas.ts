import { z } from 'zod'

import {
  DRIVING_LICENSE_CLASSES,
  TRANSPORT_DOCUMENT_STATUSES,
  TRANSPORT_DOCUMENT_SUBJECTS,
  TRANSPORT_DOCUMENT_TYPES,
} from '@kampus/school-core/lib/finance-transport-documents.ts'
import { TRANSPORT_DIRECTIONS } from '@kampus/school-core/lib/finance-transport.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Servis belgesi şemaları (DOM-FIN-147; ON-147). Özel nitelikli kişi belgesi gizlenir (K-497). */

const subject = z
  .enum(TRANSPORT_DOCUMENT_SUBJECTS)
  .describe('`vehicle` araç, `driver` aracın kayıtlı sürücüsü, `staff` kurum üyesi personel')
const documentType = z
  .enum(TRANSPORT_DOCUMENT_TYPES)
  .describe(
    '`inspection`, `traffic_insurance`, `seat_insurance`, `school_bus_permit`, `driving_license`, `src_certificate`, `psychotechnical`, `criminal_record`, `other`',
  )

const documentSchema = z.object({
  id: z.string(),
  subject,
  vehicleId: z.string().nullable().describe('Araç ve sürücü belgesinde araç'),
  vehiclePlate: z
    .string()
    .nullable()
    .describe('Aracın plakası (`34ABC123`); arşivli araçta ya da personel belgesinde `null`'),
  membershipId: z.string().nullable().describe('Personel belgesinde kurum üyeliği'),
  // kvkk: K (sürücü ya da personel adı)
  subjectName: z
    .string()
    .nullable()
    .describe('Sürücü belgesinde kayıt anındaki sürücü adı, personel belgesinde personelin adı'),
  counted: z
    .boolean()
    .describe(
      'Uyarıya ve uygunluğa sayılıyor mu: önceki sürücünün, pasif personelin ya da yerine geçilen belgede `false`',
    ),
  documentType,
  documentNumber: z.string().nullable().describe('Araç belgesinde belge ya da poliçe numarası'),
  licenseClass: z.enum(DRIVING_LICENSE_CLASSES).nullable().describe('Ehliyette sınıf'),
  startDate: z.string().describe('Belge tarihi ya da başlangıç (YYYY-MM-DD)'),
  endDate: z.string().nullable().describe('Geçerlilik bitişi (dahil); boşsa süresiz'),
  status: z
    .enum(TRANSPORT_DOCUMENT_STATUSES)
    .describe(
      'Bugüne göre: `valid`, `expiring` (bitişi uyarı penceresinde), `expired`, `superseded` (yerine yenisi geçti)',
    ),
  daysLeft: z
    .number()
    .int()
    .nullable()
    .describe('Bitişe kalan gün (bugün biten 0, geçen eksi); süresizde `null`'),
  sensitive: z.boolean().describe('Özel nitelikli tür (adli sicil, psikoteknik)'),
  restricted: z
    .boolean()
    .describe(
      'Gizli görünüm (K-497): yönetici dışında özel nitelikli belgede dosya bilgisi `null`',
    ),
  hasFile: z.boolean().nullable().describe('Dosya eklenmiş mi; gizli görünümde `null`'),
  file: z
    .object({ name: z.string(), byteSize: z.number().int() })
    .nullable()
    .describe('Dosyanın adı ve boyutu; dosya yoksa ya da gizli görünümde `null`'),
  replacesId: z.string().nullable().describe('Bu belgenin yerine geçtiği belge'),
  supersededAt: z.string().nullable().describe('Yerine yeni belge geçtiği an'),
  createdAt: z.string(),
})

export const transportDocumentListResponse = z.object({
  data: z.array(documentSchema),
  meta: pageMetaSchema,
})

export const transportDocumentCreateResponse = dataResponse(
  z.object({
    document: documentSchema,
    superseded: documentSchema.nullable().describe('Yerine geçilen (artık geçmiş) belge'),
  }),
)

const typeList = z.array(documentType)

export const transportDocumentAlertsResponse = dataResponse(
  z.object({
    warningDays: z.number().int().describe('Kurumun uyarı penceresi (gün)'),
    expiredCount: z.number().int().describe('Süresi geçen sayılan belge'),
    expiringCount: z.number().int().describe('Uyarı penceresinde biten sayılan belge'),
    unfitVehicleCount: z.number().int().describe('Uygun olmayan (zorunlu belgesi geçmiş) araç'),
    missingVehicleCount: z
      .number()
      .int()
      .describe('Araç ya da sürücüsünde zorunlu belgesi eksik araç'),
    vehicles: z
      .array(
        z.object({
          vehicleId: z.string(),
          plate: z.string(),
          fit: z
            .boolean()
            .describe(
              '`false`: araç ya da şimdiki sürücüsünde zorunlu belgenin süresi geçmiş (K-498)',
            ),
          expiredTypes: typeList.describe('Süresi geçmiş zorunlu türler'),
          expiringTypes: typeList.describe('Bitişi yaklaşan zorunlu türler'),
          missingVehicleTypes: typeList.describe('Aracın eksik zorunlu türleri'),
          missingDriverTypes: typeList.describe('Şimdiki sürücünün eksik zorunlu türleri'),
          routes: z
            .array(
              z.object({
                id: z.string(),
                name: z.string(),
                direction: z.enum(TRANSPORT_DIRECTIONS),
              }),
            )
            .describe('Aracın etkin güzergâhları'),
        }),
      )
      .describe('Arşivlenmemiş araçlar, plakaya göre'),
  }),
)

export const transportDocumentSettingsResponse = dataResponse(
  z.object({
    warningDays: z.number().int().describe('Uyarı penceresi (gün, 1–180; varsayılan 30)'),
    version: z.number().int().describe('`If-Match` ayar sürümü; hiç kaydedilmediyse 1'),
  }),
)

export const transportDocumentFileUrlResponse = dataResponse(
  z.object({
    url: z.string().describe('Kısa ömürlü imzalı GET bağlantısı'),
    expiresAt: z.string().describe('Bağlantının geçerlilik sonu'),
  }),
)

export const transportDocumentListQuery = z.strictObject({
  ...pageQuerySchema.shape,
  subject: subject.optional(),
  vehicleId: z.uuid('Araç geçersiz.').optional().describe('Aracın ve sürücüsünün belgeleri'),
  membershipId: z.string().trim().min(1).max(100).optional().describe('Personelin belgeleri'),
  documentType: documentType.optional(),
  due: z
    .enum(['expired', 'expiring', 'attention', 'valid'])
    .optional()
    .describe(
      '`expired` süresi geçen, `expiring` uyarı penceresinde biten, `attention` ikisi, `valid` geçerli ya da süresiz (yalnız sayılan belgeler)',
    ),
  history: z
    .enum(['true', 'false'])
    .optional()
    .describe('`true` ise yerine geçilen belgeler de döner'),
})

export const transportDocumentParams = z.object({ documentId: z.uuid('Belge geçersiz.') })
