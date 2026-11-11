import { sql } from 'drizzle-orm'
import {
  boolean,
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
  MATERIAL_CANCEL_REASON_MAX,
  MATERIAL_DELIVERY_NOTE_MAX,
  MATERIAL_RECIPIENT_KINDS,
  MATERIAL_RECIPIENT_NAME_MAX,
  MATERIAL_SET_GRADE_MAX,
  MATERIAL_SET_GRADE_MIN,
  MATERIAL_SET_ITEM_QUANTITY_MAX,
  MATERIAL_SET_NAME_MAX,
  MATERIAL_SET_YEAR_MAX,
  MATERIAL_SET_YEAR_MIN,
  type MaterialRecipientKind,
} from '@kampus/school-core/lib/finance-material-sets.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'
import { courses } from './courses.ts'
import { stockItems, stockMovements, stockWarehouses } from './finance-inventory.ts'
import { studentGuardians } from './student-guardians.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Kitap ve materyal seti (DOM-FIN-080; ON-232): bir eğitim yılı için ad, isteğe bağlı hedef (okulda
 * sınıf düzeyi, dil okulunda kur) ve kalemler (`material_set_items`). Ad yıl içinde tekildir (core,
 * Türkçe harf duyarsız). Set silinmez, `is_active` ile pasifleşir.
 */
export const materialSets = pgTable(
  'material_sets',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    academicYear: integer('academic_year').notNull(),
    gradeLevel: integer('grade_level'),
    courseId: uuid('course_id'),
    isActive: boolean('is_active').notNull().default(true),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'material_sets_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'material_sets_course_fkey',
      columns: [table.institutionId, table.courseId],
      foreignColumns: [courses.institutionId, courses.id],
    }).onDelete('restrict'),
    check(
      'material_sets_text_check',
      sql`char_length(${table.name}) between 2 and ${n(MATERIAL_SET_NAME_MAX)}`,
    ),
    check(
      'material_sets_year_check',
      sql`${table.academicYear} between ${n(MATERIAL_SET_YEAR_MIN)} and ${n(MATERIAL_SET_YEAR_MAX)}`,
    ),
    // Hedef ya sınıf düzeyi ya kurdur; ikisi birden olmaz.
    check(
      'material_sets_target_check',
      sql`(${table.gradeLevel} is null or ${table.gradeLevel} between ${n(MATERIAL_SET_GRADE_MIN)} and ${n(MATERIAL_SET_GRADE_MAX)})
        and (${table.gradeLevel} is null or ${table.courseId} is null)`,
    ),
    index('material_sets_year_idx').on(table.institutionId, table.academicYear),
    index('material_sets_course_idx')
      .on(table.institutionId, table.courseId)
      .where(sql`${table.courseId} is not null`),
  ],
)

/**
 * Setin kalemi (DOM-FIN-080): stok kartı ve öğrenci başına adet. Kalemler düzeltilince eski satırlar
 * arşivlenir (`archived_at`), yenileri yazılır; önceki teslimler kendi kalemlerini korur
 * (`material_delivery_items`, K-208).
 */
export const materialSetItems = pgTable(
  'material_set_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    setId: uuid('set_id').notNull(),
    stockItemId: uuid('stock_item_id').notNull(),
    quantity: integer('quantity').notNull(),
    position: integer('position').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'material_set_items_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'material_set_items_set_fkey',
      columns: [table.institutionId, table.setId],
      foreignColumns: [materialSets.institutionId, materialSets.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'material_set_items_stock_item_fkey',
      columns: [table.institutionId, table.stockItemId],
      foreignColumns: [stockItems.institutionId, stockItems.id],
    }).onDelete('restrict'),
    check(
      'material_set_items_quantity_check',
      sql`${table.quantity} between 1 and ${n(MATERIAL_SET_ITEM_QUANTITY_MAX)} and ${table.position} >= 0`,
    ),
    uniqueIndex('material_set_items_set_stock_item_key')
      .on(table.institutionId, table.setId, table.stockItemId)
      .where(sql`${table.archivedAt} is null`),
    index('material_set_items_set_idx').on(table.institutionId, table.setId),
    index('material_set_items_stock_item_idx').on(table.institutionId, table.stockItemId),
  ],
)

/**
 * Materyal seti teslimi (DOM-FIN-080): öğrenciye setin teslimi, teslim alan, gün ve kâğıt imza
 * işareti. Teslim seçilen depodan kalemler kadar `delivery` stok çıkışı yazar
 * (`material_delivery_items.stock_movement_id`). Aynı öğrenciye aynı setin iptal edilmemiş tek
 * teslimi olur. Silinmez; yönetici gerekçeyle iptal eder, çıkışlar da iptal edilir (K-209).
 */
export const materialDeliveries = pgTable(
  'material_deliveries',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    setId: uuid('set_id').notNull(),
    // kvkk: K — öğrenci kaydı (`records` `students`)
    studentId: text('student_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    deliveryDate: date('delivery_date', { mode: 'string' }).notNull(),
    recipientKind: text('recipient_kind').$type<MaterialRecipientKind>().notNull(),
    // kvkk: K — veli bağı (`student_guardians`)
    guardianId: uuid('guardian_id'),
    // kvkk: K — teslim alanın adı
    recipientName: text('recipient_name'),
    signatureReceived: boolean('signature_received').notNull(),
    signatureRecordedAt: timestamp('signature_recorded_at', { withTimezone: true }),
    // kvkk: K
    signatureRecordedByUserId: text('signature_recorded_by_user_id'),
    note: text('note'),
    // kvkk: K
    createdByUserId: text('created_by_user_id').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // kvkk: K
    cancelledByUserId: text('cancelled_by_user_id'),
    cancelReason: text('cancel_reason'),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'material_deliveries_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'material_deliveries_set_fkey',
      columns: [table.institutionId, table.setId],
      foreignColumns: [materialSets.institutionId, materialSets.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'material_deliveries_warehouse_fkey',
      columns: [table.institutionId, table.warehouseId],
      foreignColumns: [stockWarehouses.institutionId, stockWarehouses.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'material_deliveries_guardian_fkey',
      columns: [table.institutionId, table.guardianId],
      foreignColumns: [studentGuardians.institutionId, studentGuardians.id],
    }).onDelete('restrict'),
    check(
      'material_deliveries_recipient_kind_check',
      oneOf(table.recipientKind, MATERIAL_RECIPIENT_KINDS),
    ),
    // Öğrencide ad ve veli yok; kayıtlı velide bağ ve o anki ad; başka kişide yalnız ad.
    check(
      'material_deliveries_recipient_check',
      sql`(${table.recipientKind} = 'student' and ${table.guardianId} is null and ${table.recipientName} is null)
        or (${table.recipientKind} = 'guardian' and ${table.guardianId} is not null and ${table.recipientName} is not null)
        or (${table.recipientKind} = 'other' and ${table.guardianId} is null and ${table.recipientName} is not null)`,
    ),
    check(
      'material_deliveries_text_check',
      sql`(${table.recipientName} is null or char_length(${table.recipientName}) between 1 and ${n(MATERIAL_RECIPIENT_NAME_MAX)})
        and (${table.note} is null or char_length(${table.note}) <= ${n(MATERIAL_DELIVERY_NOTE_MAX)})
        and (${table.cancelReason} is null or char_length(${table.cancelReason}) <= ${n(MATERIAL_CANCEL_REASON_MAX)})`,
    ),
    // İmza alındıysa kim ve ne zaman işlediği de yazılıdır.
    check(
      'material_deliveries_signature_check',
      sql`(${table.signatureReceived} = (${table.signatureRecordedAt} is not null))
        and ((${table.signatureRecordedAt} is null) = (${table.signatureRecordedByUserId} is null))`,
    ),
    check(
      'material_deliveries_cancel_check',
      sql`((${table.cancelledAt} is null) = (${table.cancelledByUserId} is null))
        and ((${table.cancelledAt} is null) = (${table.cancelReason} is null))`,
    ),
    uniqueIndex('material_deliveries_set_student_key')
      .on(table.institutionId, table.setId, table.studentId)
      .where(sql`${table.cancelledAt} is null and ${table.archivedAt} is null`),
    index('material_deliveries_set_idx').on(table.institutionId, table.setId),
    index('material_deliveries_student_idx').on(table.institutionId, table.studentId),
    index('material_deliveries_warehouse_idx').on(table.institutionId, table.warehouseId),
    index('material_deliveries_guardian_idx')
      .on(table.institutionId, table.guardianId)
      .where(sql`${table.guardianId} is not null`),
  ],
)

/**
 * Teslimin kalemi (DOM-FIN-080): teslim anındaki stok kartı ve adet ile yazdığı stok çıkışı. Set
 * kalemleri sonradan değişse de teslimin içeriği burada kalır (K-208).
 */
export const materialDeliveryItems = pgTable(
  'material_delivery_items',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    deliveryId: uuid('delivery_id').notNull(),
    stockItemId: uuid('stock_item_id').notNull(),
    quantity: integer('quantity').notNull(),
    stockMovementId: uuid('stock_movement_id').notNull(),
    position: integer('position').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'material_delivery_items_pkey', columns: [table.institutionId, table.id] }),
    foreignKey({
      name: 'material_delivery_items_delivery_fkey',
      columns: [table.institutionId, table.deliveryId],
      foreignColumns: [materialDeliveries.institutionId, materialDeliveries.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'material_delivery_items_stock_item_fkey',
      columns: [table.institutionId, table.stockItemId],
      foreignColumns: [stockItems.institutionId, stockItems.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'material_delivery_items_movement_fkey',
      columns: [table.institutionId, table.stockMovementId],
      foreignColumns: [stockMovements.institutionId, stockMovements.id],
    }).onDelete('restrict'),
    check(
      'material_delivery_items_quantity_check',
      sql`${table.quantity} between 1 and ${n(MATERIAL_SET_ITEM_QUANTITY_MAX)} and ${table.position} >= 0`,
    ),
    index('material_delivery_items_delivery_idx').on(table.institutionId, table.deliveryId),
    index('material_delivery_items_stock_item_idx').on(table.institutionId, table.stockItemId),
    uniqueIndex('material_delivery_items_movement_key').on(
      table.institutionId,
      table.stockMovementId,
    ),
  ],
)
