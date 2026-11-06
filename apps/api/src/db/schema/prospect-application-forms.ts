import { sql } from 'drizzle-orm'
import { boolean, check, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'

import { institutions } from './auth.ts'
import { requiredColumns } from './columns.ts'

/**
 * Kurum sitesine gömülen ön başvuru formu (ON-133; DOM-KAY-003, DOM-KAY-009; IST-145). Kurum başına
 * tek satır; kurum ayarı değil kayıt alanıdır. Satır kişisel veri taşımaz.
 *
 * **Kurumsuz indeks istisnası:** `prospect_application_forms_form_key_key` yalnız `form_key`
 * üzerindedir. Açık uçta oturum yoktur, kurum bu anahtardan çözülür; `course_certificates`
 * doğrulama kodu ile aynı belgelenmiş istisna. Anahtar yenilenince eskisi satırda kalmaz, hemen
 * geçersiz olur.
 */
export const prospectApplicationForms = pgTable(
  'prospect_application_forms',
  {
    institutionId: text('institution_id')
      .primaryKey()
      .references(() => institutions.id),
    formKey: text('form_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    siteOrigin: text('site_origin'),
    ...requiredColumns(),
  },
  (table) => [
    uniqueIndex('prospect_application_forms_form_key_key').on(table.formKey),
    check(
      'prospect_application_forms_form_key_check',
      sql`${table.formKey} ~ '^[A-Za-z0-9_-]{32}$'`,
    ),
    check(
      'prospect_application_forms_site_origin_check',
      sql`${table.siteOrigin} is null or ${table.siteOrigin} ~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$'`,
    ),
  ],
)
