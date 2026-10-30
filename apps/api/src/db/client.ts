import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import pg from 'pg'

import * as auditLogSchema from './schema/audit-log.ts'
import * as authSchema from './schema/auth.ts'
import * as idempotencyKeysSchema from './schema/idempotency-keys.ts'
import * as institutionSettingsSchema from './schema/institution-settings.ts'
import * as membershipLinksSchema from './schema/membership-links.ts'
import * as recordsSchema from './schema/records.ts'
import * as resourcesSchema from './schema/resources.ts'
import * as skillsSchema from './schema/skills.ts'

export const schema = {
  ...authSchema,
  ...institutionSettingsSchema,
  ...membershipLinksSchema,
  ...auditLogSchema,
  ...recordsSchema,
  ...idempotencyKeysSchema,
  ...resourcesSchema,
  ...skillsSchema,
}
export type Schema = typeof schema

/**
 * Sürücüden bağımsız veritabanı arayüzü: üretim/geliştirmede node-postgres, testte PGlite.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>

/** drizzle-kit'in ürettiği migration klasörü (`apps/api/drizzle`). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url))

export function connectPostgres(databaseUrl: string) {
  // Better Auth tabloları saat dilimsiz `timestamp` kullanır; oturum UTC'ye sabitlenir.
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, options: '-c timezone=UTC' })
  const db = drizzle({ client: pool, schema })
  return { db, close: () => pool.end() }
}
