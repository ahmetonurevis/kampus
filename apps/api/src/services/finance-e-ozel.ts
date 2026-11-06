import { isCourse } from '@kampus/school-core/lib/enrollment.ts'
import {
  applyEOzelMarks,
  E_OZEL_ACADEMIC_KINDS,
  E_OZEL_KINDS,
  eOzelAttendanceItems,
  eOzelCourseEndItems,
  eOzelCsv,
  eOzelFeeItems,
  eOzelLearnerItems,
  eOzelMarkSchema,
  planEOzelMark,
  selectEOzelItems,
  type EOzelFilter,
  type EOzelItem,
  type EOzelKind,
} from '@kampus/school-core/lib/finance-e-ozel.ts'

import type { Database } from '../db/client.ts'
import {
  listEOzelMarks,
  loadAbsentLessonHours,
  loadEffectiveCourseDecisions,
  loadFeeRows,
  loadLearnerIdentities,
  memberNames,
  saveEOzelMark,
} from '../db/finance-e-ozel.ts'
import { setPaymentMebbis } from '../db/payments.ts'
import { loadRecords } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { ModuleDisabledError } from '../plugins/modules.ts'
import { getInstitutionModules } from './modules.ts'
import {
  runCommand,
  runReadOnly,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'

/**
 * e-Özel işlem listesi (IST-085, DOM-KAY-015). Kaynaklar okunur, satırı core kurar; yazılan tek şey
 * "işlendi" işaretidir. Kimlik numarası yalnız maskeli çıkar; denetime alan adı düşer, değer düşmez
 * (DOM-YTK-052, DOM-YTK-053). Devamsızlık ve kurs sonu `academic` modülünün verisidir: kapalıyken
 * satır üretilmez, doğrudan istek 403 olur; `crm` kapalıyken kimlik boş döner (DOM-YTK-040). Liste kurum başına bellekte kurulur;
 * tahsilat ve yoklama büyüdükçe depoya indirilir (`docs/muhendislik/api-tasarimi.md`).
 */

const LIST_READ_FIELDS = ['maskedIdentity', 'birthDate']
const MARK_FIELDS = ['recordedAt', 'recordedByUserId']

async function audit(
  db: Database,
  ctx: ServiceContext,
  action: string,
  entity: { type: string; id: string },
  fields: readonly string[],
) {
  await db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action,
    entityType: entity.type,
    entityId: entity.id,
    changes: { fields: [...fields] },
    createdAt: ctx.now,
  })
}

/** Okulda kurum türünün dışındadır: rol denetiminden önce 404 (DOM-YTK-012, ADR 0008). */
export async function assertEOzelInstitution(ctx: ServiceContext): Promise<void> {
  const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
  if (institution === null || !isCourse(institution.type)) throw new NotFoundError()
}

const studentsOf = (rows: { data: unknown }[]) =>
  rows.map((row) => row.data as { id: string; name: string; isActive?: boolean })

/** Kimlik `crm` modülünün verisidir (`GET /students/:id/identity`): kapalıyken satırda boş kalır. */
async function loadKind(
  db: Database,
  institutionId: string,
  kind: EOzelKind,
  scope: { crm: boolean },
) {
  switch (kind) {
    case 'learner': {
      const students = studentsOf(await loadRecords(db, institutionId, ['students']))
      const identities = scope.crm ? await loadLearnerIdentities(db, institutionId) : new Map()
      return eOzelLearnerItems(students, identities)
    }
    case 'fee':
      return eOzelFeeItems(await loadFeeRows(db, institutionId))
    case 'attendance': {
      const [students, classes, days, lessonHours] = [
        await loadRecords(db, institutionId, ['students']),
        await loadRecords(db, institutionId, ['classes']),
        await loadRecords(db, institutionId, ['attendance'], {
          match: [{ kind: 'equals', field: 'status', values: ['absent', 'excused'] }],
        }),
        await loadAbsentLessonHours(db, institutionId),
      ]
      const names = new Map(studentsOf(students).map((item) => [item.id, item.name]))
      const classNames = new Map(
        classes.map((row) => {
          const data = row.data as { id: string; name?: string }
          return [data.id, data.name ?? null]
        }),
      )
      return eOzelAttendanceItems({
        names,
        lessonHours,
        days: days.map((row) => {
          const data = row.data as {
            id: string
            studentId: string
            classId?: string
            date: string
            status: string
          }
          return {
            id: data.id,
            studentId: data.studentId,
            date: data.date,
            status: data.status,
            className: classNames.get(data.classId ?? '') ?? null,
          }
        }),
      })
    }
    case 'course_end': {
      const students = studentsOf(await loadRecords(db, institutionId, ['students']))
      return eOzelCourseEndItems({
        names: new Map(students.map((item) => [item.id, item.name])),
        decisions: await loadEffectiveCourseDecisions(db, institutionId),
      })
    }
    default:
      return kind satisfies never
  }
}

type ItemScope = { kinds: readonly EOzelKind[]; crm: boolean }

async function loadItems(
  db: Database,
  institutionId: string,
  { kinds, crm }: ItemScope,
): Promise<EOzelItem[]> {
  const items: EOzelItem[] = []
  for (const kind of kinds) items.push(...(await loadKind(db, institutionId, kind, { crm })))
  return applyEOzelMarks(items, await listEOzelMarks(db, institutionId))
}

/** İstenen türler; `academic` kapalıyken genel liste o türleri düşürür, doğrudan istek 403 olur. */
async function scopeFor(ctx: ServiceContext, kind: EOzelKind | undefined): Promise<ItemScope> {
  const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
  const academic = institution?.modules.academic === true
  const crm = institution?.modules.crm === true
  if (kind !== undefined && !academic && E_OZEL_ACADEMIC_KINDS.includes(kind))
    throw new ModuleDisabledError()
  if (kind !== undefined) return { kinds: [kind], crm }
  return {
    kinds: E_OZEL_KINDS.filter((item) => academic || !E_OZEL_ACADEMIC_KINDS.includes(item)),
    crm,
  }
}

/** Süzülmüş bütün satırlar ve işaretleyen adları; tek görüntüden okunur. */
function selectedItems(ctx: ServiceContext, filter: EOzelFilter, scope: ItemScope) {
  return runReadOnly(ctx, {
    action: 'finance.e_ozel_list',
    collections: [],
    load: async (tx) => {
      const items = selectEOzelItems(await loadItems(tx, ctx.institutionId, scope), filter)
      const names = await memberNames(
        tx,
        ctx.institutionId,
        items.flatMap((item) => item.recordedByUserId ?? []),
      )
      return { run: () => ({ items, names }) }
    },
  })
}

const filterKey = (filter: EOzelFilter) => `${filter.kind ?? 'all'}:${filter.status}`

/**
 * Sayfalı liste. Maskeli kimlik ve doğum tarihi dönen sayfa denetime yazılır (`student_identity.read`
 * ile aynı gerekçe, ON-063); arama metni denetime yazılmaz, kişi adı olabilir. Denetim yazılamazsa
 * yanıt dönmez.
 */
export async function listEOzelItems(
  ctx: ServiceContext,
  query: EOzelFilter & { page: number; pageSize: number },
) {
  const { page, pageSize, ...filter } = query
  const { items, names } = await selectedItems(ctx, filter, await scopeFor(ctx, filter.kind))
  const rows = items.slice((page - 1) * pageSize, page * pageSize)
  if (rows.some((item) => item.learner?.maskedIdentity))
    await audit(
      ctx.db,
      ctx,
      'finance.e_ozel_read',
      { type: 'e_ozel_items', id: filterKey(filter) },
      LIST_READ_FIELDS,
    )
  return {
    total: items.length,
    items: rows.map(({ recordedByUserId, ...item }) => ({
      ...item,
      recordedByName: recordedByUserId === null ? null : (names.get(recordedByUserId) ?? null),
    })),
  }
}

/** Elle işleme dosyası: süzgeç listeyle aynıdır, sayfalanmaz; her aktarım denetime yazılır. */
export async function exportEOzelItems(ctx: ServiceContext, filter: EOzelFilter): Promise<string> {
  const { items, names } = await selectedItems(ctx, filter, await scopeFor(ctx, filter.kind))
  const csv = eOzelCsv(items, names)
  await audit(
    ctx.db,
    ctx,
    'finance.e_ozel_export',
    { type: 'e_ozel_items', id: filterKey(filter) },
    [],
  )
  return csv
}

/**
 * "İşlendi" işaretini yazar ya da geri alır. Ücret satırı tahsilatın MEBBİS işaretidir ve aynı
 * denetim eylemini yazar (DOM-FIN-032). Listede olmayan kaynak 404: başka kurumun kaydı, iptal
 * edilmiş tahsilat, düzeltilen yoklama ve eski kur sonu kararı burada ayrışmaz.
 */
export async function setEOzelMarkCommand(
  ctx: ServiceContext,
  target: { kind: EOzelKind; sourceId: string },
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const { recorded } = eOzelMarkSchema.parse(input)
  const scope = await scopeFor(ctx, target.kind)
  let view:
    { kind: EOzelKind; sourceId: string; version: number; recordedAt: string | null } | undefined
  return runCommand(
    ctx,
    {
      action: 'finance.e_ozel_record',
      collections: [],
      entity: { type: 'e_ozel_records', id: `${target.kind}:${target.sourceId}` },
      load: async (tx) => {
        const items = await loadItems(tx, ctx.institutionId, scope)
        const item = items.find(
          (row) => row.kind === target.kind && row.sourceId === target.sourceId,
        )
        if (item === undefined) throw new NotFoundError()
        if (item.version !== expectedVersion) throw new ConflictError()
        return { run: () => planEOzelMark({ recorded, current: item }) }
      },
      after: async (tx) => {
        const recordedByUserId = recorded ? ctx.actor.userId : null
        const saved =
          target.kind === 'fee'
            ? await setPaymentMebbis(tx, ctx.institutionId, {
                id: target.sourceId,
                expectedVersion,
                recordedByUserId,
                now: ctx.now,
              })
            : await saveEOzelMark(tx, ctx.institutionId, {
                kind: target.kind,
                sourceId: target.sourceId,
                expectedVersion,
                recordedByUserId,
                now: ctx.now,
              })
        if (saved === null) throw new ConflictError()
        if (target.kind === 'fee')
          await audit(tx, ctx, 'payment.mebbis', { type: 'payments', id: target.sourceId }, [
            'mebbisRecordedAt',
          ])
        else
          await audit(
            tx,
            ctx,
            'finance.e_ozel_record',
            { type: 'e_ozel_records', id: `${target.kind}:${target.sourceId}` },
            MARK_FIELDS,
          )
        view = {
          kind: target.kind,
          sourceId: target.sourceId,
          version: saved.version,
          recordedAt: recorded ? ctx.now.toISOString() : null,
        }
      },
    },
    () => {
      if (view === undefined) throw new Error('e-ozel mark was not written')
      return { statusCode: 200, body: { data: view } }
    },
    idempotency,
  )
}
