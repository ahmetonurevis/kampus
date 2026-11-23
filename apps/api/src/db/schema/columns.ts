import { sql, type SQL } from 'drizzle-orm'
import { integer, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core'

/**
 * İlişkisel kurum tablolarının ortak parçaları (veritabani.md §2). Bu dosya tablo tanımlamaz;
 * drizzle-kit şema klasörünü tararken buradan tablo çıkmaz.
 */

/** Sabit sözlük değerleri için `check` ifadesi; değerler kodun kendisidir, kullanıcı girdisi değil. */
export function oneOf(column: AnyPgColumn, values: readonly (string | number)[]): SQL {
  for (const value of values)
    if (!/^[A-Za-z0-9_+-]+$/.test(String(value))) throw new Error(`invalid check value: ${value}`)
  const literals = values.map((value) => (typeof value === 'number' ? String(value) : `'${value}'`))
  return sql`${column} in (${sql.raw(literals.join(', '))})`
}

export const keys = (record: Record<string, unknown>) => Object.keys(record)

/** Zorunlu kolonlar (veritabani.md §2). */
export const requiredColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
})
