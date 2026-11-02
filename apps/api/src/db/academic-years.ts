import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import type { AcademicTerm, AcademicYear } from '@kampus/school-core/lib/academic-years.ts'

import type { Database } from './client.ts'
import { academicTerms, academicYears } from './schema/academic-years.ts'
import { institutionSettings } from './schema/institution-settings.ts'

/**
 * Eğitim yılı deposu (IST-011; DOM-YTK-063…067). Kurum kapsamlıdır: ilk parametre
 * `institutionId`. Yıl satırının `version`'ı yıl ve dönemlerinin ortak iyimser kilididir; dönem
 * yazan her işlem yılın sürümünü de `bumpAcademicYear` ile artırır. Arşivli dönem okunmaz.
 */

type YearRow = typeof academicYears.$inferSelect

export type StoredAcademicYear = AcademicYear & {
  rowVersion: number
  createdAt: string
  updatedAt: string
}

const iso = (value: Date | null) => (value === null ? null : value.toISOString())

function toYear(row: YearRow, terms: readonly AcademicTerm[]): StoredAcademicYear {
  return {
    startYear: row.startYear,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    activatedAt: iso(row.activatedAt),
    closedAt: iso(row.closedAt),
    terms,
    rowVersion: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Kurumun bütün yılları (yeni yıl önce) ve arşivlenmemiş dönemleri (gün sırasıyla). */
export async function loadAcademicYears(
  db: Database,
  institutionId: string,
): Promise<StoredAcademicYear[]> {
  const [years, terms] = await Promise.all([
    db
      .select()
      .from(academicYears)
      .where(and(eq(academicYears.institutionId, institutionId), isNull(academicYears.archivedAt)))
      .orderBy(sql`${academicYears.startYear} desc`),
    db
      .select({
        id: academicTerms.id,
        startYear: academicTerms.startYear,
        name: academicTerms.name,
        startDate: academicTerms.startDate,
        endDate: academicTerms.endDate,
      })
      .from(academicTerms)
      .where(and(eq(academicTerms.institutionId, institutionId), isNull(academicTerms.archivedAt)))
      .orderBy(asc(academicTerms.startYear), asc(academicTerms.startDate), asc(academicTerms.id)),
  ])
  const byYear = new Map<number, AcademicTerm[]>()
  for (const { startYear, ...term } of terms) {
    const list = byYear.get(startYear)
    if (list) list.push(term)
    else byYear.set(startYear, [term])
  }
  return years.map((row) => toYear(row, byYear.get(row.startYear) ?? []))
}

const at = (value: string | null) => (value === null ? null : new Date(value))

const yearValues = (institutionId: string, year: AcademicYear, now: Date) => ({
  institutionId,
  startYear: year.startYear,
  startDate: year.startDate,
  endDate: year.endDate,
  status: year.status,
  activatedAt: at(year.activatedAt),
  closedAt: at(year.closedAt),
  createdAt: now,
  updatedAt: now,
})

const termValues = (institutionId: string, year: AcademicYear, now: Date) =>
  year.terms.map((term) => ({
    institutionId,
    startYear: year.startYear,
    id: term.id,
    name: term.name,
    startDate: term.startDate,
    endDate: term.endDate,
    createdAt: now,
    updatedAt: now,
  }))

/** Yeni yıl ve ilk dönemleri. */
export async function insertAcademicYear(
  tx: Database,
  institutionId: string,
  year: AcademicYear,
  now: Date,
): Promise<void> {
  await tx.insert(academicYears).values(yearValues(institutionId, year, now))
  if (year.terms.length > 0)
    await tx.insert(academicTerms).values(termValues(institutionId, year, now))
}

/**
 * Yılın tarih ve durum kolonlarını yazar ve sürümü artırır; `expectedVersion` tutmazsa `false`
 * (409). Dönem değişikliğinde yıl kolonları aynı kalır, yalnız sürüm artar.
 */
export async function saveAcademicYear(
  tx: Database,
  institutionId: string,
  year: AcademicYear,
  expectedVersion: number,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(academicYears)
    .set({
      startDate: year.startDate,
      endDate: year.endDate,
      status: year.status,
      activatedAt: at(year.activatedAt),
      closedAt: at(year.closedAt),
      updatedAt: now,
      version: sql`${academicYears.version} + 1`,
    })
    .where(
      and(
        eq(academicYears.institutionId, institutionId),
        eq(academicYears.startYear, year.startYear),
        eq(academicYears.version, expectedVersion),
        isNull(academicYears.archivedAt),
      ),
    )
    .returning({ startYear: academicYears.startYear })
  return rows.length === 1
}

export async function insertAcademicTerm(
  tx: Database,
  institutionId: string,
  startYear: number,
  term: AcademicTerm,
  now: Date,
): Promise<void> {
  await tx
    .insert(academicTerms)
    .values({ institutionId, startYear, ...term, createdAt: now, updatedAt: now })
}

/** Dönemin ad ve tarihlerini yazar; arşivli ya da başka yılın dönemi `false`. */
export async function updateAcademicTerm(
  tx: Database,
  institutionId: string,
  startYear: number,
  term: AcademicTerm,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(academicTerms)
    .set({
      name: term.name,
      startDate: term.startDate,
      endDate: term.endDate,
      updatedAt: now,
      version: sql`${academicTerms.version} + 1`,
    })
    .where(termWhere(institutionId, startYear, term.id))
    .returning({ id: academicTerms.id })
  return rows.length === 1
}

/** Dönemi arşivler (kaldırma); arşivli ya da başka yılın dönemi `false`. */
export async function archiveAcademicTerm(
  tx: Database,
  institutionId: string,
  startYear: number,
  termId: string,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(academicTerms)
    .set({ archivedAt: now, updatedAt: now, version: sql`${academicTerms.version} + 1` })
    .where(termWhere(institutionId, startYear, termId))
    .returning({ id: academicTerms.id })
  return rows.length === 1
}

const termWhere = (institutionId: string, startYear: number, termId: string) =>
  and(
    eq(academicTerms.institutionId, institutionId),
    eq(academicTerms.startYear, startYear),
    eq(academicTerms.id, termId),
    isNull(academicTerms.archivedAt),
  )

/**
 * Kurum ayarındaki güncel yıl (`institution_settings.academic_year`, core State `academicYear`)
 * etkin yıla eşitlenir: yenileme, rıza süresi ve tarife bu sayıyı okumaya devam eder. Ayar satırı
 * yoksa açılır; her yazma ayar sürümünü artırır.
 */
export async function setInstitutionAcademicYear(
  tx: Database,
  institutionId: string,
  startYear: number,
  now: Date,
): Promise<void> {
  await tx
    .insert(institutionSettings)
    .values({ institutionId, academicYear: startYear, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: institutionSettings.institutionId,
      set: {
        academicYear: startYear,
        updatedAt: now,
        version: sql`${institutionSettings.version} + 1`,
      },
    })
}

/**
 * Örnek veri: yıl ve dönemleri yoksa yazar (idempotent; var olan yıl ve dönem değişmez). Kurum
 * ayarı da örnek yılla açılır (`ensureInstitutionSettings` zaten açmışsa değişmez).
 */
export async function ensureAcademicYears(
  db: Database,
  institutionId: string,
  years: readonly AcademicYear[],
  now: Date,
): Promise<void> {
  for (const year of years) {
    await db
      .insert(academicYears)
      .values(yearValues(institutionId, year, now))
      .onConflictDoNothing()
    if (year.terms.length > 0)
      await db
        .insert(academicTerms)
        .values(termValues(institutionId, year, now))
        .onConflictDoNothing()
  }
}
