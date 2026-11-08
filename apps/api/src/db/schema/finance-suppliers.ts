import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  SUPPLIER_ADDRESS_MAX,
  SUPPLIER_CATEGORIES,
  SUPPLIER_DOCUMENTS_MAX,
  SUPPLIER_NAME_MAX,
  SUPPLIER_TAX_OFFICE_MAX,
  SUPPLIER_TYPES,
  type SupplierCategory,
  type SupplierDocument,
  type SupplierType,
} from '@kampus/school-core/lib/finance-suppliers.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))
const CATEGORY_LIST = sql.raw(
  `array[${SUPPLIER_CATEGORIES.map((value) => `'${value}'`).join(', ')}]::text[]`,
)

/**
 * Tedarikçi (DOM-FIN-070; ON-221). Şirkette 10 haneli VKN, şahısta 11 haneli TCKN; kontrol haneleri
 * core'da denetlenir, uzunluğun türe uyması burada da. Vergi numarası kurumda tekil (pasif dahil).
 * Silinmez, `is_active` ile pasifleşir. Belgeler dosyasız listedir (K-127).
 */
export const suppliers = pgTable(
  'suppliers',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<SupplierType>().notNull(),
    // kvkk: K (şahıs tedarikçide TCKN; listede maskeli, loglanmaz)
    taxNumber: text('tax_number').notNull(),
    taxOffice: text('tax_office').notNull(),
    categories: text('categories').array().$type<SupplierCategory[]>().notNull(),
    // kvkk: K
    contactName: text('contact_name'),
    // kvkk: K
    contactPhone: text('contact_phone'),
    // kvkk: K
    contactEmail: text('contact_email'),
    // kvkk: K
    address: text('address'),
    // kvkk: K (şahıs tedarikçide kişisel hesap)
    iban: text('iban'),
    documents: jsonb('documents').$type<SupplierDocument[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'suppliers_pkey', columns: [table.institutionId, table.id] }),
    check(
      'suppliers_name_check',
      sql`char_length(${table.name}) between 2 and ${n(SUPPLIER_NAME_MAX)}`,
    ),
    check('suppliers_type_check', oneOf(table.type, SUPPLIER_TYPES)),
    check(
      'suppliers_tax_number_check',
      sql`(${table.type} = 'company' and ${table.taxNumber} ~ '^[0-9]{10}$')
        or (${table.type} = 'individual' and ${table.taxNumber} ~ '^[1-9][0-9]{10}$')`,
    ),
    check(
      'suppliers_tax_office_check',
      sql`char_length(${table.taxOffice}) between 2 and ${n(SUPPLIER_TAX_OFFICE_MAX)}`,
    ),
    check(
      'suppliers_categories_check',
      sql`cardinality(${table.categories}) >= 1 and ${table.categories} <@ ${CATEGORY_LIST}`,
    ),
    check(
      'suppliers_address_check',
      sql`${table.address} is null or char_length(${table.address}) <= ${n(SUPPLIER_ADDRESS_MAX)}`,
    ),
    check('suppliers_iban_check', sql`${table.iban} is null or ${table.iban} ~ '^TR[0-9]{24}$'`),
    check(
      'suppliers_documents_check',
      sql`jsonb_typeof(${table.documents}) = 'array' and jsonb_array_length(${table.documents}) <= ${n(SUPPLIER_DOCUMENTS_MAX)}`,
    ),
    uniqueIndex('suppliers_tax_number_key')
      .on(table.institutionId, table.taxNumber)
      .where(sql`${table.archivedAt} is null`),
    index('suppliers_active_name_idx').on(table.institutionId, table.isActive, table.name),
  ],
)
