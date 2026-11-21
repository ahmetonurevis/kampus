import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  DRIVING_LICENSE_CLASSES,
  END_DATE_REQUIRED_TYPES,
  PERSON_DOCUMENT_TYPES,
  TRANSPORT_DOCUMENT_NUMBER_MAX,
  TRANSPORT_DOCUMENT_SUBJECTS,
  TRANSPORT_DOCUMENT_TYPES,
  TRANSPORT_DOCUMENT_WARNING_DAYS_DEFAULT,
  TRANSPORT_DOCUMENT_WARNING_DAYS_MAX,
  TRANSPORT_DOCUMENT_WARNING_DAYS_MIN,
  VEHICLE_DOCUMENT_TYPES,
  type DrivingLicenseClass,
  type TransportDocumentSubject,
  type TransportDocumentType,
} from '@kampus/school-core/lib/finance-transport-documents.ts'
import { TRANSPORT_DRIVER_NAME_MAX } from '@kampus/school-core/lib/finance-transport.ts'

import { institutions, memberships } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { files } from './files.ts'
import { transportVehicles } from './finance-transport.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Servis aracı ve personeli belgesi (DOM-FIN-147; ON-147; K-496, K-497). Özne araç (`vehicle`),
 * aracın kayıtlı sürücüsü (`driver`; sürücü kurum üyesi değildir, araç kaydına ve kayıt anındaki
 * sürücü adına bağlanır) ya da kurum üyesi personeldir (`staff`; rehber ya da üye sürücü, üyelik
 * yabancı anahtarı). Kişi belgesinde içerik ve numara tutulmaz: yalnız tür, tarihler, ehliyet sınıfı
 * ve dosya. Belge silinmez ve düzeltilmez; aynı öznenin aynı türdeki yeni belgesi eskisini "yerine
 * geçti" yapar ("Diğer" hariç; kısmi tekil indeksler). Dosya platform dosya altyapısındadır
 * (`files`, bağ türü `transport_document`).
 */
export const transportDocuments = pgTable(
  'transport_documents',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    subjectKind: text('subject_kind').$type<TransportDocumentSubject>().notNull(),
    vehicleId: uuid('vehicle_id'),
    // kvkk: K (personel üyeliği)
    membershipId: text('membership_id'),
    // kvkk: K (kayıt anındaki sürücü adı)
    driverName: text('driver_name'),
    documentType: text('document_type').$type<TransportDocumentType>().notNull(),
    documentNumber: text('document_number'),
    licenseClass: text('license_class').$type<DrivingLicenseClass>(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    // kvkk: Ö (adli sicil ve psikoteknik dosyası; açılışı denetimde)
    fileId: uuid('file_id'),
    replacesId: uuid('replaces_id'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'transport_documents_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'transport_documents_vehicle_fkey',
      columns: [table.institutionId, table.vehicleId],
      foreignColumns: [transportVehicles.institutionId, transportVehicles.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'transport_documents_membership_fkey',
      columns: [table.institutionId, table.membershipId],
      foreignColumns: [memberships.institutionId, memberships.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'transport_documents_file_fkey',
      columns: [table.institutionId, table.fileId],
      foreignColumns: [files.institutionId, files.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'transport_documents_replaces_fkey',
      columns: [table.institutionId, table.replacesId],
      foreignColumns: [table.institutionId, table.id],
    }).onDelete('restrict'),
    check(
      'transport_documents_subject_check',
      sql`${oneOf(table.subjectKind, TRANSPORT_DOCUMENT_SUBJECTS)}
        and ((${table.subjectKind} in ('vehicle', 'driver')) = (${table.vehicleId} is not null))
        and ((${table.subjectKind} = 'staff') = (${table.membershipId} is not null))
        and ((${table.subjectKind} = 'driver') = (${table.driverName} is not null))`,
    ),
    check(
      'transport_documents_driver_name_check',
      sql`${table.driverName} is null or char_length(${table.driverName}) between 2 and ${n(TRANSPORT_DRIVER_NAME_MAX)}`,
    ),
    check(
      'transport_documents_type_check',
      sql`${oneOf(table.documentType, TRANSPORT_DOCUMENT_TYPES)}
        and (${table.documentType} = 'other'
          or (${table.subjectKind} = 'vehicle') = (${oneOf(table.documentType, VEHICLE_DOCUMENT_TYPES)}))
        and (${table.documentType} = 'other'
          or (${table.subjectKind} <> 'vehicle') = (${oneOf(table.documentType, PERSON_DOCUMENT_TYPES)}))`,
    ),
    check(
      'transport_documents_license_check',
      sql`((${table.documentType} = 'driving_license') = (${table.licenseClass} is not null))
        and (${table.licenseClass} is null or ${oneOf(table.licenseClass, DRIVING_LICENSE_CLASSES)})`,
    ),
    // Kişi belgesinde numara tutulmaz (KVKK en az veri; K-497).
    check(
      'transport_documents_number_check',
      sql`${table.documentNumber} is null
        or (${table.subjectKind} = 'vehicle'
          and char_length(${table.documentNumber}) between 1 and ${n(TRANSPORT_DOCUMENT_NUMBER_MAX)})`,
    ),
    check(
      'transport_documents_end_date_check',
      sql`(${table.endDate} is null or ${table.endDate} >= ${table.startDate})
        and (${table.endDate} is not null or not ${oneOf(table.documentType, END_DATE_REQUIRED_TYPES)})`,
    ),
    uniqueIndex('transport_documents_vehicle_current_key')
      .on(table.institutionId, table.vehicleId, table.subjectKind, table.documentType)
      .where(
        sql`${table.supersededAt} is null and ${table.documentType} <> 'other' and ${table.vehicleId} is not null`,
      ),
    uniqueIndex('transport_documents_membership_current_key')
      .on(table.institutionId, table.membershipId, table.documentType)
      .where(
        sql`${table.supersededAt} is null and ${table.documentType} <> 'other' and ${table.membershipId} is not null`,
      ),
    uniqueIndex('transport_documents_file_key')
      .on(table.institutionId, table.fileId)
      .where(sql`${table.fileId} is not null`),
    // Bir belgenin yerine en çok bir belge geçer; yabancı anahtarın indeksidir.
    uniqueIndex('transport_documents_replaces_key')
      .on(table.institutionId, table.replacesId)
      .where(sql`${table.replacesId} is not null`),
    index('transport_documents_vehicle_idx').on(table.institutionId, table.vehicleId),
    index('transport_documents_membership_idx').on(table.institutionId, table.membershipId),
    index('transport_documents_end_date_idx')
      .on(table.institutionId, table.endDate)
      .where(sql`${table.supersededAt} is null and ${table.endDate} is not null`),
  ],
)

/**
 * Servis belgesi uyarı ayarı (DOM-FIN-147; K-498). Kurum başına bir satır; satır yoksa varsayılan
 * (30 gün, ayar sürümü 1).
 */
export const transportDocumentSettings = pgTable(
  'transport_document_settings',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    warningDays: integer('warning_days').notNull().default(TRANSPORT_DOCUMENT_WARNING_DAYS_DEFAULT),
    ...requiredColumns(),
  },
  (table) => [
    check(
      'transport_document_settings_warning_days_check',
      sql`${table.warningDays} between ${n(TRANSPORT_DOCUMENT_WARNING_DAYS_MIN)} and ${n(TRANSPORT_DOCUMENT_WARNING_DAYS_MAX)}`,
    ),
  ],
)
