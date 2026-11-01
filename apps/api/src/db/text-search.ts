import { sql, type AnyColumn, type SQL } from 'drizzle-orm'

/** Türkçe harf ve büyük/küçük harf duyarsız arama; joker yoktur (`strpos`). */

const FOLD_FROM = 'ıİğĞüÜşŞöÖçÇ'
const FOLD_TO = 'iigguussoocc'
const FOLD_MAP = new Map([...FOLD_FROM].map((char, index) => [char, FOLD_TO[index] ?? char]))

const foldChars = (value: string) => [...value].map((char) => FOLD_MAP.get(char) ?? char).join('')

/** Türkçe harfleri ASCII'ye indirip küçültür; SQL tarafındaki `foldSql` ile aynı sonucu verir. */
export function foldSearch(value: string): string {
  return foldChars(foldChars(value).toLowerCase())
}

export function foldSql(expression: SQL | AnyColumn): SQL {
  return sql`translate(lower(translate(${expression}, ${FOLD_FROM}, ${FOLD_TO})), ${FOLD_FROM}, ${FOLD_TO})`
}
