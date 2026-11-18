import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  WORK_PERMIT_BRANCH_MAX,
  WORK_PERMIT_BRANCH_MIN,
  WORK_PERMIT_NOTE_MAX,
  WORK_PERMIT_NUMBER_MAX,
  WORK_PERMIT_REASON_MAX,
  WORK_PERMIT_REASON_MIN,
  WORK_PERMIT_STATUSES,
  WORK_PERMIT_TYPES,
  type WorkPermitStatus,
  type WorkPermitType,
} from '@kampus/school-core/lib/finance-work-permits.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Öğretmen çalışma onayı (DOM-FIN-114; ON-174). Özel okul ve kurs öğretmeninin MEBBİS üzerinden
 * alınan çalışma onayının kurum içi takibidir; Kampüs MEBBİS'e göndermez (IST-143). Kayıt
 * öğretmenin kurum üyeliğine bağlanır (personel tablosu yoktur). Saklanan durum hazırlanıyor,
 * başvuruldu, onaylandı ya da reddedildi; "süresi doldu" geçerlilik bitişinden hesaplanır (K-376).
 * Öğretmen başına tek açık kayıt kısmi tekil indeksle güvencededir (K-375). Onay belgesi platform
 * dosya altyapısındadır (`files`, amaç `document`, bağ türü `teacher_work_permit`). Kayıt silinmez:
 * yanlış kayıt gerekçeyle iptal (arşiv) edilir.
 */
export const teacherWorkPermits = pgTable(
  'teacher_work_permits',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (öğretmen üyeliği)
    membershipId: text('membership_id').notNull(),
    permitType: text('permit_type').$type<WorkPermitType>().notNull(),
    branch: text('branch').notNull(),
    status: text('status').$type<WorkPermitStatus>().notNull(),
    applicationDate: date('application_date', { mode: 'string' }),
    approvalDate: date('approval_date', { mode: 'string' }),
    // kvkk: K (resmî yazı sayısı)
    approvalNumber: text('approval_number'),
    validUntil: date('valid_until', { mode: 'string' }),
    rejectionDate: date('rejection_date', { mode: 'string' }),
    rejectionReason: text('rejection_reason'),
    documentFileId: uuid('document_file_id'),
    note: text('note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    cancelReason: text('cancel_reason'),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'teacher_work_permits_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'teacher_work_permits_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'teacher_work_permits_document_file_fkey',
      columns: [table.institutionId, table.documentFileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    check('teacher_work_permits_type_check', oneOf(table.permitType, WORK_PERMIT_TYPES)),
    check('teacher_work_permits_status_check', oneOf(table.status, WORK_PERMIT_STATUSES)),
    check(
      'teacher_work_permits_branch_check',
      sql`char_length(${table.branch}) between ${n(WORK_PERMIT_BRANCH_MIN)} and ${n(WORK_PERMIT_BRANCH_MAX)}`,
    ),
    // Başvuru günü hazırlanan kayıtta yoktur; başvurulan ve onaylanan kayıtta vardır (reddedilende
    // de; hazırlanırken açılıp doğrudan sonuçlanan kayıt yoktur).
    check(
      'teacher_work_permits_application_check',
      sql`(${table.status} = 'preparing') = (${table.applicationDate} is null)`,
    ),
    // Onay alanları yalnız onaylı kayıtta ve orada zorunlu (geçerlilik bitişi boşsa süresiz).
    check(
      'teacher_work_permits_approval_check',
      sql`((${table.status} = 'approved') = (${table.approvalDate} is not null))
        and ((${table.status} = 'approved') = (${table.approvalNumber} is not null))
        and (${table.status} = 'approved' or ${table.validUntil} is null)
        and (${table.approvalNumber} is null
          or char_length(${table.approvalNumber}) between 1 and ${n(WORK_PERMIT_NUMBER_MAX)})`,
    ),
    check(
      'teacher_work_permits_dates_check',
      sql`(${table.approvalDate} is null or ${table.approvalDate} >= ${table.applicationDate})
        and (${table.validUntil} is null or ${table.validUntil} >= ${table.approvalDate})
        and (${table.rejectionDate} is null or ${table.rejectionDate} >= ${table.applicationDate})`,
    ),
    // Ret günü ve gerekçesi yalnız reddedilen kayıtta ve orada zorunlu.
    check(
      'teacher_work_permits_rejection_check',
      sql`((${table.status} = 'rejected') = (${table.rejectionDate} is not null))
        and ((${table.status} = 'rejected') = (${table.rejectionReason} is not null))
        and (${table.rejectionReason} is null or char_length(${table.rejectionReason})
          between ${n(WORK_PERMIT_REASON_MIN)} and ${n(WORK_PERMIT_REASON_MAX)})`,
    ),
    check(
      'teacher_work_permits_note_check',
      sql`${table.note} is null or char_length(${table.note}) between 1 and ${n(WORK_PERMIT_NOTE_MAX)}`,
    ),
    // İptal (arşiv) gerekçe ve iptal edeni birlikte taşır.
    check(
      'teacher_work_permits_cancel_check',
      sql`((${table.archivedAt} is null) = (${table.cancelReason} is null))
        and ((${table.archivedAt} is null) = (${table.cancelledByUserId} is null))
        and (${table.cancelReason} is null or char_length(${table.cancelReason})
          between ${n(WORK_PERMIT_REASON_MIN)} and ${n(WORK_PERMIT_REASON_MAX)})`,
    ),
    // Öğretmen başına tek açık (hazırlanan ya da başvurulan) kayıt (K-375).
    uniqueIndex('teacher_work_permits_open_key')
      .on(table.institutionId, table.membershipId)
      .where(sql`${table.status} in ('preparing', 'applied') and ${table.archivedAt} is null`),
    index('teacher_work_permits_membership_idx').on(
      table.institutionId,
      table.membershipId,
      table.status,
    ),
    index('teacher_work_permits_document_file_idx').on(table.institutionId, table.documentFileId),
  ],
)
