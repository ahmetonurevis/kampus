import { sql } from 'drizzle-orm'
import {
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
  STAFF_CHANGE_KINDS,
  STAFF_CHANGE_REASON_MAX,
  STAFF_CHANGE_REASON_MIN,
  STAFF_CHANGE_STATUSES,
  type StaffChangeKind,
  type StaffChangeStatus,
  type StoredStaffChangePayload,
} from '@kampus/school-core/lib/finance-staff-self-service.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'
import { staffDocuments } from './finance-staff-documents.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Personel self-servisi değişiklik talebi (DOM-FIN-166; ON-189; K-553…K-555). Personel kendi
 * özlük kartının adres/telefon, acil durum ve banka bilgisi için ya da yeni özlük belgesi için
 * talep açar; yönetici onaylar (kart ya da belge aynı transaction'da yazılır) veya gerekçeyle
 * reddeder; personel bekleyen talebini geri çeker. Personel tablosu yoktur, talep üyeliğe bağlanır.
 * IBAN uygulama düzeyinde şifrelidir (kurum, tablo, kolon ve talep kimliğine bağlı); yükte yoktur.
 * Belge dışındaki türde personel başına tek bekleyen talep olur (kısmi tekil indeks).
 */
export const staffChangeRequests = pgTable(
  'staff_change_requests',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id').notNull(),
    kind: text('kind').$type<StaffChangeKind>().notNull(),
    status: text('status').$type<StaffChangeStatus>().notNull(),
    // kvkk: K — türe göre önerilen değerler (adres, telefon, acil durum kişileri, hesap sahibi,
    // belge türü ve tarihi, not); IBAN yoktur.
    payload: jsonb('payload').$type<StoredStaffChangePayload>().notNull(),
    // kvkk: Ç — şifreli IBAN: base64(IV ‖ GCM etiketi ‖ şifreli metin); düz metin yok
    ibanCiphertext: text('iban_ciphertext'),
    // Kişisel veri değil: yalnız anahtar sürümü.
    ibanKeyVersion: integer('iban_key_version'),
    // kvkk: Ö (sağlık raporu ve adli sicil olabilir; açılışı denetimde)
    fileId: uuid('file_id'),
    // Onaylanan belge talebinin açtığı özlük belgesi.
    staffDocumentId: uuid('staff_document_id'),
    // kvkk: K
    requestedByUserId: text('requested_by_user_id').notNull(),
    // kvkk: K
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // kvkk: K (serbest metin) — ret gerekçesi
    rejectionReason: text('rejection_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'staff_change_requests_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'staff_change_requests_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_change_requests_file_fkey',
      columns: [table.institutionId, table.fileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_change_requests_document_fkey',
      columns: [table.institutionId, table.staffDocumentId],
      foreignColumns: [staffDocuments.institutionId, staffDocuments.id],
    }).onDelete('restrict'),
    index('staff_change_requests_member_idx').on(
      table.institutionId,
      table.membershipId,
      table.createdAt,
    ),
    index('staff_change_requests_status_idx').on(
      table.institutionId,
      table.status,
      table.createdAt,
    ),
    index('staff_change_requests_file_idx').on(table.institutionId, table.fileId),
    index('staff_change_requests_document_idx').on(table.institutionId, table.staffDocumentId),
    // Belge dışındaki türde personelin tek bekleyen talebi (kurum kilidi altında core da denetler).
    uniqueIndex('staff_change_requests_pending_key')
      .on(table.institutionId, table.membershipId, table.kind)
      .where(
        sql`${table.status} = 'pending' and ${table.kind} <> 'document' and ${table.archivedAt} is null`,
      ),
    check('staff_change_requests_kind_check', oneOf(table.kind, STAFF_CHANGE_KINDS)),
    check('staff_change_requests_status_check', oneOf(table.status, STAFF_CHANGE_STATUSES)),
    check(
      'staff_change_requests_payload_check',
      sql`jsonb_typeof(${table.payload}) = 'object' and ${table.payload}->>'kind' = ${table.kind}`,
    ),
    // IBAN yalnız banka talebinde ve anahtar sürümüyle birlikte bulunur.
    check(
      'staff_change_requests_iban_check',
      sql`(${table.ibanCiphertext} is null) = (${table.ibanKeyVersion} is null)
        and (${table.ibanCiphertext} is not null) = (${table.kind} = 'bank')
        and (${table.ibanKeyVersion} is null or ${table.ibanKeyVersion} > 0)`,
    ),
    check(
      'staff_change_requests_document_check',
      sql`(${table.kind} = 'document' or (${table.fileId} is null and ${table.staffDocumentId} is null))
        and (${table.staffDocumentId} is null or ${table.status} = 'approved')`,
    ),
    // Karar veren ve zamanı yalnız karar verilmiş (onay, ret) talepte; gerekçe yalnız retçe.
    check(
      'staff_change_requests_decision_check',
      sql`(${table.decidedAt} is null) = (${table.decidedByUserId} is null)
        and (${table.decidedAt} is not null) = (${table.status} in ('approved', 'rejected'))
        and (${table.rejectionReason} is not null) = (${table.status} = 'rejected')
        and (${table.rejectionReason} is null or char_length(${table.rejectionReason})
          between ${n(STAFF_CHANGE_REASON_MIN)} and ${n(STAFF_CHANGE_REASON_MAX)})`,
    ),
  ],
)
