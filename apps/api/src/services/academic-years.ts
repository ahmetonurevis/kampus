import { randomUUID } from 'node:crypto'

import {
  academicYearView,
  currentAcademicPeriod,
  planAcademicYearActivation,
  planAcademicYearClosure,
  planAcademicYearCreation,
  planAcademicYearUpdate,
  planTermCreation,
  planTermRemoval,
  planTermUpdate,
  termSequence,
  updateAcademicTermSchema,
  updateAcademicYearSchema,
  type AcademicYear,
} from '@kampus/school-core/lib/academic-years.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

import {
  archiveAcademicTerm,
  insertAcademicTerm,
  insertAcademicYear,
  loadAcademicYears,
  saveAcademicYear,
  setInstitutionAcademicYear,
  updateAcademicTerm,
  type StoredAcademicYear,
} from '../db/academic-years.ts'
import type { Database } from '../db/client.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitution } from './memberships.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Eğitim yılı ve dönemleri (IST-011; docs/domain/yetki-ve-kapsam.md DOM-YTK-063…067). Kural core
 * `lib/academic-years.ts`'tedir; burada yükleme, sürüm denetimi ve yazma vardır. Beş rol okur
 * (öğrenci ve veli alanları `academicYearView` ile daralır); yalnız yönetici yazar. Her yazma tek
 * transaction ve kurum kilidi altındadır (`runCommand`); yılın `rowVersion`'ı yıl ve dönemlerinin
 * ortak iyimser kilididir (`If-Match`). Denetime yalnız alan adları yazılır.
 */

const ENTITY = 'academic_year'
const entity = (startYear: number) => ({ type: ENTITY, id: String(startYear) })

type Meta = { rowVersion: number; updatedAt: string }

/** Rolün görünümü; personelde sürüm ve son değişiklik anı da döner. */
function yearView(ctx: ServiceContext, year: AcademicYear, meta: Meta) {
  const view = academicYearView(year, ctx.actor.role)
  return 'status' in view ? { ...view, ...meta } : view
}

const storedView = (ctx: ServiceContext, year: StoredAcademicYear) =>
  yearView(ctx, year, { rowVersion: year.rowVersion, updatedAt: year.updatedAt })

export interface AcademicYearListInput {
  page: number
  pageSize: number
}

/** Kurumun yılları, yeni yıl önce (DOM-YTK-067). */
export async function listYears(ctx: ServiceContext, input: AcademicYearListInput) {
  const years = await loadAcademicYears(ctx.db, ctx.institutionId)
  const start = (input.page - 1) * input.pageSize
  return {
    items: years.slice(start, start + input.pageSize).map((year) => storedView(ctx, year)),
    total: years.length,
  }
}

/** Tek yıl; olmayan ya da başka kurumun yılı 404. */
export async function getYear(ctx: ServiceContext, startYear: number) {
  const years = await loadAcademicYears(ctx.db, ctx.institutionId)
  const year = years.find((item) => item.startYear === startYear)
  if (!year) throw new NotFoundError()
  return storedView(ctx, year)
}

/**
 * Bugünün (Europe/Istanbul) eğitim yılı ve dönemi (DOM-YTK-067). Dönem görünümdeki sırasıyla
 * eşlenir: öğrenci ve velinin görünümünde dönem kimliği yoktur.
 */
export async function currentPeriod(ctx: ServiceContext) {
  const years = await loadAcademicYears(ctx.db, ctx.institutionId)
  const current = currentAcademicPeriod(years, ctx.now.toISOString())
  const year = years.find((item) => item.startYear === current.year?.startYear)
  if (!year) return { date: current.date, year: null, term: null }
  const view = storedView(ctx, year)
  const sequence = current.term ? termSequence(year, current.term.id) : null
  return {
    date: current.date,
    year: view,
    term: view.terms.find((term) => term.sequence === sequence) ?? null,
  }
}

async function institutionTypeOf(tx: Database, ctx: ServiceContext): Promise<InstitutionType> {
  const institution = await getInstitution(tx, ctx.institutionId)
  if (institution === null) throw new NotFoundError()
  return institution.type
}

/** Yılın yeni hâlini sürüm koşuluyla yazar; yazılmazsa 409. */
async function save(tx: Database, ctx: ServiceContext, year: AcademicYear, expected: number) {
  if (!(await saveAcademicYear(tx, ctx.institutionId, year, expected, ctx.now)))
    throw new ConflictError()
}

/** `after`'da yazılan yanıt gövdesini uç yanıtına çevirir. */
function respond(out: { body?: unknown }, statusCode: number) {
  return () => {
    if (out.body === undefined) throw new Error('academic year was not written')
    return { statusCode, body: out.body }
  }
}

/** Gönderilen (tanımlı) alanların adları; değer denetime yazılmaz. */
const definedFields = (data: Record<string, unknown>) =>
  Object.keys(data).filter((key) => data[key] !== undefined)

/**
 * Yeni yıl (DOM-YTK-063, -064): `planned` açılır, isteğe bağlı ilk dönemleriyle. Aynı başlangıç
 * yılı 409 `academic_year_exists`; aralık ve dönem kuralları 422. Başarı 201.
 */
export function createYear(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<AcademicYear>(
    ctx,
    {
      action: 'academic_year.create',
      collections: [],
      entity: (year) => entity(year.startYear),
      load: async (tx) => {
        const years = await loadAcademicYears(tx, ctx.institutionId)
        return { run: () => planAcademicYearCreation({ years, input, makeTermId: randomUUID }) }
      },
      after: async (tx, year) => {
        await insertAcademicYear(tx, ctx.institutionId, year, ctx.now)
        await auditWork(tx, ctx, 'academic_year.create', entity(year.startYear), [
          'startYear',
          'startDate',
          'endDate',
          ...(year.terms.length > 0 ? ['terms'] : []),
        ])
        out.body = {
          data: yearView(ctx, year, { rowVersion: 1, updatedAt: ctx.now.toISOString() }),
        }
      },
    },
    respond(out, 201),
    idempotency,
  )
}

type YearChange = {
  year: AcademicYear
  /** Denetime yazılan alan adları. */
  fields: string[]
  /** Yıl satırından önce yazılan ek değişiklik (dönem satırı, önceki etkin yıl, kurum ayarı). */
  write?: (tx: Database) => Promise<void>
}

type YearCommand = {
  action: string
  startYear: number
  expectedVersion: number
  /** Başarı durumu: dönem eklemede 201, diğerlerinde 200. */
  statusCode?: number
  plan: (input: { years: StoredAcademicYear[]; institutionType: InstitutionType }) => YearChange
}

/**
 * Var olan yıla komut: kurum kilidi altında yükler; yıl yoksa 404, `If-Match` tutmazsa 409. Core
 * planını çalıştırır, ek yazmadan sonra yılın sürümünü artırır ve denetime yazar. Yanıt yılın
 * yeni hâlidir.
 */
function runYearCommand(
  ctx: ServiceContext,
  command: YearCommand,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<YearChange & { rowVersion: number }>(
    ctx,
    {
      action: command.action,
      collections: [],
      entity: entity(command.startYear),
      load: async (tx) => {
        const years = await loadAcademicYears(tx, ctx.institutionId)
        const year = years.find((item) => item.startYear === command.startYear)
        if (!year) throw new NotFoundError()
        if (year.rowVersion !== command.expectedVersion) throw new ConflictError()
        const institutionType = await institutionTypeOf(tx, ctx)
        return {
          run: () => ({ ...command.plan({ years, institutionType }), rowVersion: year.rowVersion }),
        }
      },
      after: async (tx, change) => {
        if (change.write) await change.write(tx)
        await save(tx, ctx, change.year, change.rowVersion)
        await auditWork(tx, ctx, command.action, entity(command.startYear), change.fields)
        out.body = {
          data: yearView(ctx, change.year, {
            rowVersion: change.rowVersion + 1,
            updatedAt: ctx.now.toISOString(),
          }),
        }
      },
    },
    respond(out, command.statusCode ?? 200),
    idempotency,
  )
}

export interface YearTarget {
  startYear: number
  expectedVersion: number
}

/** Yılın tarihlerini değiştirir (DOM-YTK-063); kapanmış yıl 409 `academic_year_closed`. */
export function updateYear(
  ctx: ServiceContext,
  target: YearTarget,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return runYearCommand(
    ctx,
    {
      action: 'academic_year.update',
      ...target,
      plan: ({ years }) => ({
        year: planAcademicYearUpdate({ years, startYear: target.startYear, input }),
        // Plan girdiyi doğruladı; aynı şema tanımlı alanları verir.
        fields: definedFields(updateAcademicYearSchema.parse(input)),
      }),
    },
    idempotency,
  )
}

/** Yıla dönem ekler (DOM-YTK-064). Başarı 201; yanıt yılın yeni hâlidir. */
export function addTerm(
  ctx: ServiceContext,
  target: YearTarget,
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return runYearCommand(
    ctx,
    {
      action: 'academic_term.create',
      ...target,
      statusCode: 201,
      plan: ({ years }) => {
        const { year, term } = planTermCreation({
          years,
          startYear: target.startYear,
          input,
          termId: randomUUID(),
        })
        return {
          year,
          fields: ['terms.name', 'terms.startDate', 'terms.endDate'],
          write: (tx) => insertAcademicTerm(tx, ctx.institutionId, year.startYear, term, ctx.now),
        }
      },
    },
    idempotency,
  )
}

/** Dönemin adını ya da tarihlerini değiştirir (DOM-YTK-064). */
export function updateTerm(
  ctx: ServiceContext,
  target: YearTarget & { termId: string },
  input: unknown,
  idempotency: IdempotencyRequest | null,
) {
  return runYearCommand(
    ctx,
    {
      action: 'academic_term.update',
      ...target,
      plan: ({ years }) => {
        const { year, term } = planTermUpdate({
          years,
          startYear: target.startYear,
          termId: target.termId,
          input,
        })
        return {
          year,
          fields: definedFields(updateAcademicTermSchema.parse(input)).map(
            (field) => `terms.${field}`,
          ),
          write: async (tx) => {
            if (!(await updateAcademicTerm(tx, ctx.institutionId, year.startYear, term, ctx.now)))
              throw new ConflictError()
          },
        }
      },
    },
    idempotency,
  )
}

/** Dönemi kaldırır (arşiv; DOM-YTK-064, -065). */
export function removeTerm(
  ctx: ServiceContext,
  target: YearTarget & { termId: string },
  idempotency: IdempotencyRequest | null,
) {
  return runYearCommand(
    ctx,
    {
      action: 'academic_term.remove',
      ...target,
      plan: ({ years, institutionType }) => {
        const { year, term } = planTermRemoval({
          years,
          startYear: target.startYear,
          termId: target.termId,
          institutionType,
        })
        return {
          year,
          fields: ['terms'],
          write: async (tx) => {
            const archived = await archiveAcademicTerm(
              tx,
              ctx.institutionId,
              year.startYear,
              term.id,
              ctx.now,
            )
            if (!archived) throw new ConflictError()
          },
        }
      },
    },
    idempotency,
  )
}

/**
 * Yılı etkinleştirir (DOM-YTK-065): önceki etkin yıl aynı işlemde kapanır (ayrı denetim satırı)
 * ve kurum ayarındaki güncel yıl (`institution_settings.academic_year`) bu yıla eşitlenir;
 * yenileme, rıza süresi ve tarife bu sayıyı okur. Önceki yıl etkinleştirilen yıldan önce yazılır:
 * tek etkin yıl indeksi (`academic_years_active_key`) ara durumda da tutar.
 */
export function activateYear(
  ctx: ServiceContext,
  target: YearTarget,
  idempotency: IdempotencyRequest | null,
) {
  return runYearCommand(
    ctx,
    {
      action: 'academic_year.activate',
      ...target,
      plan: ({ years, institutionType }) => {
        const { activated, closed } = planAcademicYearActivation({
          years,
          startYear: target.startYear,
          institutionType,
          now: ctx.now.toISOString(),
        })
        const previous = closed && years.find((item) => item.startYear === closed.startYear)
        return {
          year: activated,
          fields: ['status', 'activatedAt'],
          write: async (tx) => {
            if (closed && previous) {
              await save(tx, ctx, closed, previous.rowVersion)
              await auditWork(tx, ctx, 'academic_year.close', entity(closed.startYear), [
                'status',
                'closedAt',
              ])
            }
            await setInstitutionAcademicYear(tx, ctx.institutionId, activated.startYear, ctx.now)
          },
        }
      },
    },
    idempotency,
  )
}

/** Etkin yılı son gününden itibaren kapatır (DOM-YTK-066). */
export function closeYear(
  ctx: ServiceContext,
  target: YearTarget,
  idempotency: IdempotencyRequest | null,
) {
  return runYearCommand(
    ctx,
    {
      action: 'academic_year.close',
      ...target,
      plan: ({ years }) => ({
        year: planAcademicYearClosure({
          years,
          startYear: target.startYear,
          now: ctx.now.toISOString(),
        }),
        fields: ['status', 'closedAt'],
      }),
    },
    idempotency,
  )
}
