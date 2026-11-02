import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import pg from 'pg'

import * as academicYearsSchema from './schema/academic-years.ts'
import * as auditLogSchema from './schema/audit-log.ts'
import * as authSchema from './schema/auth.ts'
import * as cefrSchema from './schema/cefr.ts'
import * as coordinatorDutiesSchema from './schema/coordinator-duties.ts'
import * as coursesSchema from './schema/courses.ts'
import * as filesSchema from './schema/files.ts'
import * as idempotencyKeysSchema from './schema/idempotency-keys.ts'
import * as institutionSettingsSchema from './schema/institution-settings.ts'
import * as languageGroupsSchema from './schema/language-groups.ts'
import * as membershipLinksSchema from './schema/membership-links.ts'
import * as privacySchema from './schema/privacy.ts'
import * as recordsSchema from './schema/records.ts'
import * as resourcesSchema from './schema/resources.ts'
import * as skillsSchema from './schema/skills.ts'
import * as studentGuardiansSchema from './schema/student-guardians.ts'

export const schema = {
  ...authSchema,
  ...institutionSettingsSchema,
  ...membershipLinksSchema,
  ...coordinatorDutiesSchema,
  ...auditLogSchema,
  ...recordsSchema,
  ...idempotencyKeysSchema,
  ...resourcesSchema,
  ...skillsSchema,
  ...filesSchema,
  ...privacySchema,
  ...academicYearsSchema,
  ...studentGuardiansSchema,
  ...coursesSchema,
  ...languageGroupsSchema,
  ...cefrSchema,
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
