import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  ALUMNI_ADDRESS_MAX,
  ALUMNI_COPIES_MAX,
  ALUMNI_DELIVERY_METHODS,
  ALUMNI_DOCUMENT_TYPES,
  ALUMNI_EMAIL_MAX,
  ALUMNI_FEE_MAX_CENTS,
  ALUMNI_FEE_PAYMENT_METHODS,
  ALUMNI_MANUAL_NOTE_MAX,
  ALUMNI_NAME_MAX,
  ALUMNI_REASON_MAX,
  ALUMNI_REQUEST_CHANNELS,
  ALUMNI_REQUEST_STATUSES,
  ALUMNI_REQUESTER_KINDS,
  type AlumniDeliveryMethod,
  type AlumniDocumentContent,
  type AlumniDocumentType,
  type AlumniFeePaymentMethod,
  type AlumniRequestChannel,
  type AlumniRequesterKind,
  type AlumniRequestStatus,
} from '@kampus/school-core/lib/enrollment-alumni-documents.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Mezun ve ayrılan öğrenci belge talebi (DOM-KAY-044; ON-260, K-328…K-331). Talebi ön büro
 * kaydeder; durum alındı → hazırlanıyor → hazır → teslim edildi ya da reddedildi. Her geçiş anını
 * ve kişisini yazar. Hazır olurken yıl bazlı sıralı belge numarası (`document_year`,
 * `document_sequence`) verilir; öğrenim belgesi ve not dökümünde içerik `document_content`'e
 * dondurulur, diploma örneğinde taranmış dosya `diploma_file_id`'dedir. `student_id` ve
 * `guardian_parent_id` `records` kimlikleridir, yabancı anahtar değildir. Ücret talep anında
 * belge başı ücret × adet olarak dondurulur; ödendi işareti teslimle düşer (K-329).
 */
export const alumniDocumentRequests = pgTable(
  'alumni_document_requests',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K
    studentId: text('student_id').notNull(),
    documentType: text('document_type').$type<AlumniDocumentType>().notNull(),
    copies: integer('copies').notNull(),
    channel: text('channel').$type<AlumniRequestChannel>().notNull(),
    requesterKind: text('requester_kind').$type<AlumniRequesterKind>().notNull(),
    // kvkk: K — talep eden veli kaydı
    guardianParentId: text('guardian_parent_id'),
    // kvkk: K — talep edenin adı (kendisi, veli ya da vekil); talep anının kopyası
    requesterName: text('requester_name').notNull(),
    authorizationFileId: uuid('authorization_file_id'),
    deliveryMethod: text('delivery_method').$type<AlumniDeliveryMethod>().notNull(),
    // kvkk: K
    deliveryEmail: text('delivery_email'),
    // kvkk: K
    deliveryAddress: text('delivery_address'),
    feeCents: bigint('fee_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    status: text('status').$type<AlumniRequestStatus>().notNull().default('received'),
    // kvkk: K
    receivedByUserId: text('received_by_user_id').notNull(),
    preparingAt: timestamp('preparing_at', { withTimezone: true }),
    // kvkk: K
    preparingByUserId: text('preparing_by_user_id'),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    // kvkk: K
    readyByUserId: text('ready_by_user_id'),
    documentYear: integer('document_year'),
    documentSequence: integer('document_sequence'),
    // kvkk: K — belgenin dondurulmuş içeriği (ad, numara, ders ortalamaları)
    documentContent: jsonb('document_content').$type<AlumniDocumentContent>(),
    // kvkk: K
    manualNote: text('manual_note'),
    diplomaFileId: uuid('diploma_file_id'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    // kvkk: K — teslimde kimliği kontrol eden personel
    deliveredByUserId: text('delivered_by_user_id'),
    // kvkk: K
    identityCheckNote: text('identity_check_note'),
    paymentMethod: text('payment_method').$type<AlumniFeePaymentMethod>(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    // kvkk: K
    rejectedByUserId: text('rejected_by_user_id'),
    // kvkk: K
    rejectionReason: text('rejection_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'alumni_document_requests_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'alumni_document_requests_authorization_file_fkey',
      columns: [table.institutionId, table.authorizationFileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'alumni_document_requests_diploma_file_fkey',
      columns: [table.institutionId, table.diplomaFileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    check(
      'alumni_document_requests_document_type_check',
      oneOf(table.documentType, ALUMNI_DOCUMENT_TYPES),
    ),
    check(
      'alumni_document_requests_copies_check',
      sql`${table.copies} between 1 and ${n(ALUMNI_COPIES_MAX)}`,
    ),
    check('alumni_document_requests_channel_check', oneOf(table.channel, ALUMNI_REQUEST_CHANNELS)),
    check(
      'alumni_document_requests_requester_kind_check',
      oneOf(table.requesterKind, ALUMNI_REQUESTER_KINDS),
    ),
    check(
      'alumni_document_requests_delivery_method_check',
      oneOf(table.deliveryMethod, ALUMNI_DELIVERY_METHODS),
    ),
    check('alumni_document_requests_status_check', oneOf(table.status, ALUMNI_REQUEST_STATUSES)),
    check(
      'alumni_document_requests_payment_method_check',
      sql`${table.paymentMethod} is null or ${oneOf(table.paymentMethod, ALUMNI_FEE_PAYMENT_METHODS)}`,
    ),
    check('alumni_document_requests_currency_check', sql`${table.currency} = 'TRY'`),
    check(
      'alumni_document_requests_fee_check',
      sql`${table.feeCents} between 0 and ${n(ALUMNI_FEE_MAX_CENTS * ALUMNI_COPIES_MAX)}`,
    ),
    // Talep edene göre gereken bilgi: veli kaydı yalnız velide; vekil dosyasız olamaz.
    check(
      'alumni_document_requests_requester_check',
      sql`(${table.requesterKind} = 'guardian') = (${table.guardianParentId} is not null)
        and (${table.requesterKind} <> 'proxy' or ${table.authorizationFileId} is not null)
        and (${table.requesterKind} <> 'self' or ${table.authorizationFileId} is null)`,
    ),
    check(
      'alumni_document_requests_delivery_check',
      sql`(${table.deliveryMethod} = 'email') = (${table.deliveryEmail} is not null)
        and (${table.deliveryMethod} = 'cargo') = (${table.deliveryAddress} is not null)`,
    ),
    check(
      'alumni_document_requests_text_check',
      sql`char_length(${table.requesterName}) between 1 and ${n(ALUMNI_NAME_MAX)}
        and (${table.deliveryEmail} is null or char_length(${table.deliveryEmail}) <= ${n(ALUMNI_EMAIL_MAX)})
        and (${table.deliveryAddress} is null or char_length(${table.deliveryAddress}) <= ${n(ALUMNI_ADDRESS_MAX)})
        and (${table.manualNote} is null or char_length(${table.manualNote}) <= ${n(ALUMNI_MANUAL_NOTE_MAX)})
        and (${table.identityCheckNote} is null or char_length(${table.identityCheckNote}) between 5 and ${n(ALUMNI_REASON_MAX)})
        and (${table.rejectionReason} is null or char_length(${table.rejectionReason}) between 5 and ${n(ALUMNI_REASON_MAX)})`,
    ),
    // Belge numarası ve içerik hazır olmakla birlikte yazılır; diploma örneği dosya taşır.
    check(
      'alumni_document_requests_document_check',
      sql`(${table.readyAt} is null) = (${table.documentSequence} is null)
        and (${table.documentYear} is null) = (${table.documentSequence} is null)
        and (${table.documentSequence} is null or ${table.documentSequence} >= 1)
        and (${table.readyAt} is null or (${table.documentType} = 'diploma_copy') = (${table.diplomaFileId} is not null))
        and (${table.readyAt} is null or (${table.documentType} = 'diploma_copy') = (${table.documentContent} is null))`,
    ),
    // Durum ve iz birlikte tutarlı (K-330); ücretli teslim ödendi işaretini taşır (K-329).
    check(
      'alumni_document_requests_lifecycle_check',
      sql`(${table.status} = 'received' and ${table.preparingAt} is null and ${table.readyAt} is null and ${table.deliveredAt} is null and ${table.rejectedAt} is null)
        or (${table.status} = 'preparing' and ${table.preparingAt} is not null and ${table.readyAt} is null and ${table.deliveredAt} is null and ${table.rejectedAt} is null)
        or (${table.status} = 'ready' and ${table.readyAt} is not null and ${table.readyByUserId} is not null and ${table.deliveredAt} is null and ${table.rejectedAt} is null)
        or (${table.status} = 'delivered' and ${table.readyAt} is not null and ${table.deliveredAt} is not null and ${table.deliveredByUserId} is not null and ${table.identityCheckNote} is not null and ${table.rejectedAt} is null)
        or (${table.status} = 'rejected' and ${table.rejectedAt} is not null and ${table.rejectedByUserId} is not null and ${table.rejectionReason} is not null and ${table.deliveredAt} is null)`,
    ),
    check(
      'alumni_document_requests_payment_check',
      sql`(${table.paidAt} is null) = (${table.paymentMethod} is null)
        and (${table.paidAt} is null or (${table.status} = 'delivered' and ${table.feeCents} > 0))
        and (${table.status} <> 'delivered' or ${table.feeCents} = 0 or ${table.paidAt} is not null)`,
    ),
    uniqueIndex('alumni_document_requests_number_key')
      .on(table.institutionId, table.documentYear, table.documentSequence)
      .where(sql`${table.documentSequence} is not null`),
    index('alumni_document_requests_status_idx').on(table.institutionId, table.status),
    index('alumni_document_requests_student_idx').on(table.institutionId, table.studentId),
    index('alumni_document_requests_authorization_file_idx')
      .on(table.institutionId, table.authorizationFileId)
      .where(sql`${table.authorizationFileId} is not null`),
    index('alumni_document_requests_diploma_file_idx')
      .on(table.institutionId, table.diplomaFileId)
      .where(sql`${table.diplomaFileId} is not null`),
  ],
)

/**
 * Mezun belge ücretleri (DOM-KAY-044, K-329): kurumun belge türü başına ücreti (kuruş). Satırı
 * olmayan tür ücretsizdir. Değişiklik açık taleplerin dondurulmuş ücretini değiştirmez.
 */
export const alumniDocumentFees = pgTable(
  'alumni_document_fees',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    documentType: text('document_type').$type<AlumniDocumentType>().notNull(),
    feeCents: bigint('fee_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TRY'),
    // kvkk: K
    updatedByUserId: text('updated_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({
      name: 'alumni_document_fees_pkey',
      columns: [table.institutionId, table.documentType],
    }),
    check(
      'alumni_document_fees_document_type_check',
      oneOf(table.documentType, ALUMNI_DOCUMENT_TYPES),
    ),
    check(
      'alumni_document_fees_fee_check',
      sql`${table.feeCents} between 0 and ${n(ALUMNI_FEE_MAX_CENTS)}`,
    ),
    check('alumni_document_fees_currency_check', sql`${table.currency} = 'TRY'`),
  ],
)
