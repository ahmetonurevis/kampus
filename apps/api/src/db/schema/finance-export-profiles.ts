import { jsonb, pgTable, text } from 'drizzle-orm/pg-core'

import type { FinanceExportProfile } from '@kampus/school-core/lib/finance-export-profile.ts'

import { institutions } from './auth.ts'
import { requiredColumns } from './columns.ts'

/** Kurumun muhasebe aktarım profili (ON-024, IST-111); satır yoksa standart dosya iner. */
export const financeExportProfiles = pgTable('finance_export_profiles', {
  institutionId: text('institution_id')
    .primaryKey()
    .references(() => institutions.id),
  profile: jsonb('profile').$type<FinanceExportProfile | null>(),
  ...requiredColumns(),
})
