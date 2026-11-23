import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  EARLY_DISMISSAL_ACTIVE_STATUSES,
  EARLY_DISMISSAL_DECISION_MAX,
  EARLY_DISMISSAL_NOTE_MAX,
  EARLY_DISMISSAL_PICKUP_KINDS,
  EARLY_DISMISSAL_REASONS,
  EARLY_DISMISSAL_SOURCES,
  EARLY_DISMISSAL_STATUSES,
  PICKUP_NAME_MAX,
  PICKUP_RELATIONSHIPS,
  type EarlyDismissalPickupKind,
  type EarlyDismissalReason,
  type EarlyDismissalSource,
  type EarlyDismissalStatus,
  type PickupRelationship,
} from '@kampus/school-core/lib/finance-early-dismissals.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { studentGuardians } from './student-guardians.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Erken çıkış ve izinli ayrılış (DOM-FIN-161; ON-168, K-538…K-540). Talep öğrenciyi (`records`
 * kimliği), açılıştaki sınıfını, Europe/Istanbul çıkış gününü ve planlanan anı, nedeni ve teslim
 * alacak kişiyi taşır: kayıtlı bağ (`student_guardians`) ya da kayıtlı olmayan kişinin adı,
 * kimliğinin yalnız son dört hanesi ve yakınlığı. Karar, iptal ve teslim aynı satıra yazılır;
 * teslimde teslim alan kişi (bağ ya da onaylanan kişi), adının o anki kopyası ve kimliğin görüldüğü
 * saklanır. Öğrencinin bir günde tek açık (bekleyen, onaylı ya da teslim edilmiş) talebi olur
 * (kısmi tekil indeks). Yoklama kaydı bu tablodan yazılmaz.
 */
export const earlyDismissals = pgTable(
  'early_dismissals',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    // kvkk: K (records öğrenci kimliği)
    studentId: text('student_id').notNull(),
    classId: text('class_id'),
    dismissalOn: date('dismissal_on', { mode: 'string' }).notNull(),
    plannedAt: timestamp('planned_at', { withTimezone: true }).notNull(),
    reason: text('reason').$type<EarlyDismissalReason>().notNull(),
    // kvkk: K (serbest metin)
    reasonNote: text('reason_note'),
    pickupKind: text('pickup_kind').$type<EarlyDismissalPickupKind>().notNull(),
    pickupGuardianLinkId: uuid('pickup_guardian_link_id'),
    // kvkk: K (kayıtlı olmayan teslim alanın adı)
    pickupName: text('pickup_name'),
    // kvkk: K (kimliğin yalnız son dört hanesi)
    pickupIdLast4: text('pickup_id_last4'),
    pickupRelationship: text('pickup_relationship').$type<PickupRelationship>(),
    status: text('status').$type<EarlyDismissalStatus>().notNull(),
    source: text('source').$type<EarlyDismissalSource>().notNull(),
    // kvkk: K
    requestedByUserId: text('requested_by_user_id').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    // kvkk: K
    decidedByUserId: text('decided_by_user_id'),
    // kvkk: K (serbest metin)
    rejectionReason: text('rejection_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    // kvkk: K (serbest metin)
    cancelReason: text('cancel_reason'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    // kvkk: K
    releasedByUserId: text('released_by_user_id'),
    releasedToKind: text('released_to_kind').$type<EarlyDismissalPickupKind>(),
    releasedToGuardianLinkId: uuid('released_to_guardian_link_id'),
    // kvkk: K (teslim alanın adının teslim anındaki kopyası)
    releasedToName: text('released_to_name'),
    releaseIdentityVerified: boolean('release_identity_verified'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'early_dismissals_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'early_dismissals_pickup_guardian_fkey',
      columns: [table.institutionId, table.pickupGuardianLinkId],
      foreignColumns: [studentGuardians.institutionId, studentGuardians.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'early_dismissals_released_guardian_fkey',
      columns: [table.institutionId, table.releasedToGuardianLinkId],
      foreignColumns: [studentGuardians.institutionId, studentGuardians.id],
    }).onDelete('restrict'),
    check('early_dismissals_status_check', oneOf(table.status, EARLY_DISMISSAL_STATUSES)),
    check('early_dismissals_source_check', oneOf(table.source, EARLY_DISMISSAL_SOURCES)),
    check('early_dismissals_reason_check', oneOf(table.reason, EARLY_DISMISSAL_REASONS)),
    check(
      'early_dismissals_reason_note_check',
      sql`(${table.reasonNote} is null or char_length(${table.reasonNote}) between 1 and ${n(EARLY_DISMISSAL_NOTE_MAX)}) and (${table.reason} <> 'other' or ${table.reasonNote} is not null)`,
    ),
    check(
      'early_dismissals_pickup_check',
      sql`${oneOf(table.pickupKind, EARLY_DISMISSAL_PICKUP_KINDS)} and ((${table.pickupKind} = 'guardian' and ${table.pickupGuardianLinkId} is not null and ${table.pickupName} is null and ${table.pickupIdLast4} is null and ${table.pickupRelationship} is null) or (${table.pickupKind} = 'other' and ${table.pickupGuardianLinkId} is null and char_length(${table.pickupName}) between 2 and ${n(PICKUP_NAME_MAX)} and ${table.pickupIdLast4} ~ '^[0-9A-Z]{4}$' and ${oneOf(table.pickupRelationship, PICKUP_RELATIONSHIPS)}))`,
    ),
    check(
      'early_dismissals_decision_check',
      sql`(${table.decidedAt} is null) = (${table.decidedByUserId} is null) and (${table.status} = 'pending' or ${table.status} = 'cancelled' or ${table.decidedAt} is not null) and (${table.status} <> 'pending' or ${table.decidedAt} is null) and ((${table.status} = 'rejected') = (${table.rejectionReason} is not null)) and (${table.rejectionReason} is null or char_length(${table.rejectionReason}) between 5 and ${n(EARLY_DISMISSAL_DECISION_MAX)})`,
    ),
    check(
      'early_dismissals_cancel_check',
      sql`((${table.status} = 'cancelled') = (${table.cancelledAt} is not null)) and (${table.cancelledAt} is null) = (${table.cancelledByUserId} is null) and (${table.cancelReason} is null or (${table.cancelledAt} is not null and char_length(${table.cancelReason}) between 1 and ${n(EARLY_DISMISSAL_DECISION_MAX)}))`,
    ),
    check(
      'early_dismissals_release_check',
      sql`((${table.status} = 'released') = (${table.releasedAt} is not null)) and (${table.releasedAt} is null or (${table.releasedByUserId} is not null and ${table.releaseIdentityVerified} and char_length(${table.releasedToName}) between 1 and ${n(PICKUP_NAME_MAX)} and ((${table.releasedToKind} = 'guardian' and ${table.releasedToGuardianLinkId} is not null) or (${table.releasedToKind} = 'other' and ${table.releasedToGuardianLinkId} is null and ${table.pickupKind} = 'other')))) and (${table.releasedAt} is not null or (${table.releasedByUserId} is null and ${table.releasedToKind} is null and ${table.releasedToGuardianLinkId} is null and ${table.releasedToName} is null and ${table.releaseIdentityVerified} is null))`,
    ),
    index('early_dismissals_day_idx').on(table.institutionId, table.dismissalOn, table.plannedAt),
    index('early_dismissals_student_idx').on(table.institutionId, table.studentId),
    index('early_dismissals_pickup_guardian_idx').on(
      table.institutionId,
      table.pickupGuardianLinkId,
    ),
    index('early_dismissals_released_guardian_idx').on(
      table.institutionId,
      table.releasedToGuardianLinkId,
    ),
    uniqueIndex('early_dismissals_student_day_key')
      .on(table.institutionId, table.studentId, table.dismissalOn)
      .where(sql`${oneOf(table.status, EARLY_DISMISSAL_ACTIVE_STATUSES)}`),
  ],
)
