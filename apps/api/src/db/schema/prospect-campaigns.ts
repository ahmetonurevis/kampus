import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_CODE_PATTERN,
  CAMPAIGN_COST_MAX_CENTS,
  CAMPAIGN_NAME_MAX,
  type CampaignChannel,
} from '@kampus/school-core/lib/prospect-campaigns.ts'

import { institutions } from './auth.ts'
import { oneOf, requiredColumns } from './columns.ts'

const n = (value: number) => sql.raw(String(value))

/**
 * Kampanya kodu (docs/domain/kayit-ve-crm.md DOM-KAY-041; ON-134). Kod kurumda arşivliler dahil
 * tekildir ve değişmez (K-288); aday kampanyaya `records` adayındaki `campaignId` ile bağlıdır
 * (adaylar `records`'ta olduğundan yabancı anahtar yok). Silme arşivdir; arşivli kod yeni adaya
 * bağlanmaz, huni raporunda adaylarıyla kalır.
 */
export const campaignCodes = pgTable(
  'campaign_codes',
  {
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id),
    id: uuid('id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    channel: text('channel').$type<CampaignChannel>().notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    costCents: bigint('cost_cents', { mode: 'number' }),
    currency: text('currency').notNull().default('TRY'),
    isActive: boolean('is_active').notNull().default(true),
    createdByUserId: text('created_by_user_id').notNull(),
    ...requiredColumns(),
  },
  (table) => [
    primaryKey({ name: 'campaign_codes_pkey', columns: [table.institutionId, table.id] }),
    check(
      'campaign_codes_code_check',
      sql`${table.code} ~ ${sql.raw(`'${CAMPAIGN_CODE_PATTERN}'`)}`,
    ),
    check(
      'campaign_codes_name_check',
      sql`char_length(${table.name}) between 2 and ${n(CAMPAIGN_NAME_MAX)}`,
    ),
    check('campaign_codes_channel_check', oneOf(table.channel, CAMPAIGN_CHANNELS)),
    check('campaign_codes_dates_check', sql`${table.startDate} <= ${table.endDate}`),
    check(
      'campaign_codes_cost_check',
      sql`${table.costCents} is null or ${table.costCents} between 0 and ${n(CAMPAIGN_COST_MAX_CENTS)}`,
    ),
    check('campaign_codes_currency_check', sql`${table.currency} = 'TRY'`),
    // Liste ve rapor kurumun bütün kampanyalarını okur (kurumda onlarca satır); ayrı indeks yok.
    uniqueIndex('campaign_codes_code_key').on(table.institutionId, table.code),
  ],
)
