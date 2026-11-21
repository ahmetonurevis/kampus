import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import {
  assertEmergencyClassVisible,
  emergencyAlertFlags,
  emergencyContactPhone,
  emergencyContacts,
  emergencySummaryCreateSchema,
  emergencySummaryNeedsReview,
  emergencySummaryState,
  emergencySummaryUpdateSchema,
  emergencyViewerClasses,
  planEmergencySummaryApproval,
  planEmergencySummaryCreate,
  planEmergencySummaryUpdate,
  type EmergencyAlertFlags,
  type EmergencyCardPurpose,
  type EmergencyContactSource,
  type EmergencySummaryState,
  type EmergencyViewer,
  type HealthProfileStamp,
} from '@kampus/school-core/lib/finance-emergency-summaries.ts'
import type { RosterParentRecord } from '@kampus/school-core/lib/finance-transport-roster.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import {
  archiveEmergencySummary,
  findEmergencySummary,
  findStudentEmergencySummary,
  insertEmergencySummary,
  listEmergencySummaries,
  publishEmergencySummary,
  studentsWithMedicationOn,
  updateEmergencySummaryDraft,
  type SealedText,
  type StoredEmergencySummary,
} from '../db/finance-emergency-summaries.ts'
import { memberNames } from '../db/finance-visitors.ts'
import { loadHealthProfile } from '../db/health-profiles.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { users } from '../db/schema/auth.ts'
import { loadGuardianAccounts } from '../db/student-guardians.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { FieldBinding, FieldCipher } from '../lib/field-crypto.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import { readScope, readSource } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Acil durum özeti (DOM-FIN-155; ON-165; K-520…K-522; H-111). Kural core
 * `lib/finance-emergency-summaries.ts`'tedir. Servis acil eylem metnini alan anahtarıyla şifreleyip
 * çözer; uyarı işaretlerini, bugünkü ilacı ve acil iletişimi her okumada sağlık profilinden
 * (DOM-ILT-035, yalnız okunur), revir ilaç onayından (DOM-FIN-151) ve veli bağından (K-501)
 * türetir. Sağlık profili kopyalanmaz; profilin yalnız liste varlığı, acil talimatı (yalnız
 * yöneticinin yönetim görünümünde) ve damgası okunur.
 *
 * Sağlık ayrıntısı dönen her okuma öğrenci başına aynı transaction'da denetime düşer (kim, hangi
 * öğrenci, hangi alanlar; değer yok); denetim yazılamazsa yanıt dönmez. Sağlık profili okuması ve
 * okuma denetimi bu dosyada tek yerdedir (`readHealthSignals`, `auditSensitiveRead`): ON-164'ün
 * okuma gerekçesi geldiğinde gerekçe yalnız bu iki fonksiyona eklenir. Rol ve modül rotadadır.
 */

const TABLE = 'emergency_summaries'
const STUDENT = 'students'

export interface EmergencySummaryDeps {
  cipher: FieldCipher
}

/** Kartta dönen alanlar; okuma denetimine alan adları olarak yazılır. */
const CARD_FIELDS = ['actionText', 'alertFlags', 'medicationToday', 'contacts']
/** Yönetim görünümünde ayrıca dönen alanlar. */
const MANAGE_FIELDS = ['draftText', 'publishedText', 'profileInstructions', ...CARD_FIELDS.slice(1)]
const CARD_ACTIONS = {
  view: 'finance.emergency_summary.read',
  print: 'finance.emergency_summary.print',
} as const satisfies Record<EmergencyCardPurpose, string>

// --- Şifreleme -----------------------------------------------------------------------------------

const binding = (
  institutionId: string,
  row: { id: string; studentId: string },
  column: 'published' | 'draft',
): FieldBinding => ({
  institutionId,
  table: TABLE,
  column,
  rowKey: row.id,
  context: [row.studentId],
})

const seal = (
  deps: EmergencySummaryDeps,
  institutionId: string,
  row: { id: string; studentId: string },
  column: 'published' | 'draft',
  text: string,
): SealedText => deps.cipher.encrypt(binding(institutionId, row, column), text)

function open(
  deps: EmergencySummaryDeps,
  institutionId: string,
  row: { id: string; studentId: string },
  column: 'published' | 'draft',
  value: SealedText | null,
): string | null {
  if (value === null) return null
  return deps.cipher.decrypt(binding(institutionId, row, column), value)
}

const textsOf = (
  deps: EmergencySummaryDeps,
  institutionId: string,
  row: StoredEmergencySummary,
) => ({
  draft: open(deps, institutionId, row, 'draft', row.draft),
  published: open(deps, institutionId, row, 'published', row.published),
})

const reviewedOf = (row: StoredEmergencySummary): HealthProfileStamp | null =>
  row.reviewedProfileVersion === null
    ? null
    : { version: row.reviewedProfileVersion, updatedAt: row.reviewedProfileUpdatedAt }

const stateOf = (row: StoredEmergencySummary): EmergencySummaryState =>
  emergencySummaryState({ hasDraft: row.draft !== null, hasPublished: row.published !== null })

// --- Sağlık profili okumasının ve okuma denetiminin tek kapısı -----------------------------------

interface HealthSignals {
  stamp: HealthProfileStamp
  flags: EmergencyAlertFlags
  /** Profilin acil talimatı; yalnız yöneticinin yönetim görünümünde döner. */
  instructions: string
}

/**
 * Öğrencilerin sağlık profilinden özetin gerektirdiği en az bilgi (K-522): damga, uyarı türü
 * işaretleri ve acil talimat. Profil Oğuzhan'ın deposundan (`loadHealthProfile`) okunur; içerik
 * buradan dışarı yalnız bu üç biçimde çıkar. Kayıt yoksa damga sürüm 1, işaret yok.
 */
async function readHealthSignals(
  tx: Database,
  ctx: ServiceContext,
  deps: EmergencySummaryDeps,
  studentIds: readonly string[],
): Promise<Map<string, HealthSignals>> {
  const signals = new Map<string, HealthSignals>()
  for (const studentId of new Set(studentIds)) {
    const profile = await loadHealthProfile(tx, ctx.institutionId, studentId, deps.cipher)
    signals.set(studentId, {
      stamp: {
        version: profile?.version ?? 1,
        updatedAt: profile?.updatedAt.toISOString() ?? null,
      },
      flags: emergencyAlertFlags(profile?.content ?? null),
      instructions: profile?.content.emergencyInstructions ?? '',
    })
  }
  return signals
}

const NO_SIGNALS: HealthSignals = {
  stamp: { version: 1, updatedAt: null },
  flags: emergencyAlertFlags(null),
  instructions: '',
}

/** Hassas okuma denetimi (DOM-YTK-052): öğrenci başına bir satır, yalnız alan adları. */
async function auditSensitiveRead(
  tx: Database,
  ctx: ServiceContext,
  action: string,
  studentIds: readonly string[],
  fields: readonly string[],
) {
  for (const studentId of new Set(studentIds))
    await auditWork(tx, ctx, action, { type: STUDENT, id: studentId }, [...fields])
}

// --- Kapsam ve kayıtlar --------------------------------------------------------------------------

/**
 * Okuyanın sınıf bağı (K-521), kapsam kaynağından. Öğretmende yalnız etkin öğretmen kaydı
 * (`scope.teacher`). İşlemden önce çağrılır: tek bağlantılı sürücüde işlem içinden `ctx.db`
 * beklemede kalır.
 */
async function viewerOf(ctx: ServiceContext): Promise<EmergencyViewer> {
  const role = ctx.actor.role
  switch (role) {
    case 'yonetici':
    case 'onburo':
    case 'veli':
    case 'ogrenci':
      return { role }
    case 'ogretmen': {
      const [scope, source] = await Promise.all([readScope(ctx), readSource(ctx)])
      const teacherId = scope.teacher?.id
      if (teacherId === undefined) return { role, homeroomClassIds: [], teachingClassIds: [] }
      return {
        role,
        homeroomClassIds: source.classes.filter((c) => c.teacherId === teacherId).map((c) => c.id),
        teachingClassIds: source.assignments
          .filter((a) => a.teacherId === teacherId)
          .map((a) => a.classId),
      }
    }
    default:
      return role satisfies never
  }
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

interface StudentFacts {
  name: string
  classId: string | null
  active: boolean
  parentId: string | null
}

/** Öğrenci kayıtları (arşivli yüklenmez). */
async function studentFacts(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', [...new Set(ids)])
  return new Map<string, StudentFacts>(
    rows.map((row) => [
      row.id,
      {
        name: text(row.data.name) ?? '—',
        classId: text(row.data.classId),
        active: row.data.isActive !== false,
        parentId: text(row.data.parentId),
      },
    ]),
  )
}

async function classNamesOf(db: Database, ctx: ServiceContext, ids: readonly (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'classes', wanted, {
    includeArchived: true,
  })
  return new Map(rows.map((row) => [row.id, text(row.data.name) ?? row.id]))
}

/** Acil iletişim kaynakları (K-501): bağlar, hesap adları ve veli kayıtları. */
async function contactSources(
  db: Database,
  ctx: ServiceContext,
  students: ReadonlyMap<string, StudentFacts>,
  studentIds: readonly string[],
): Promise<(studentId: string) => EmergencyContactSource> {
  const links = await loadGuardianAccounts(db, ctx.institutionId, [...new Set(studentIds)])
  const parentIds = [
    ...links.flatMap((link) => (link.parentId === null ? [] : [link.parentId])),
    ...studentIds.flatMap((id) => {
      const parentId = students.get(id)?.parentId ?? null
      return parentId === null ? [] : [parentId]
    }),
  ]
  const [parentRows, accounts] = await Promise.all([
    loadRecordsByIds(db, ctx.institutionId, 'parents', [...new Set(parentIds)]),
    memberNames(
      db,
      ctx.institutionId,
      links.flatMap((link) => (link.membershipId === null ? [] : [link.membershipId])),
    ),
  ])
  const parents = new Map<string, RosterParentRecord>(
    parentRows.map((row) => [
      row.id,
      {
        id: row.id,
        name: text(row.data.name),
        phone: text(row.data.phone),
        relationship: text(row.data.relationship),
      },
    ]),
  )
  const byStudent = new Map<string, typeof links>()
  for (const link of links)
    byStudent.set(link.studentId, [...(byStudent.get(link.studentId) ?? []), link])
  return (studentId) => ({
    links: byStudent.get(studentId) ?? [],
    memberNames: accounts,
    parents,
    studentParentId: students.get(studentId)?.parentId ?? null,
  })
}

// --- Kart ----------------------------------------------------------------------------------------

/**
 * Yayındaki özetlerin kartları; öğrenci adına göre sıralı. Ayrılmış ya da arşivli öğrencinin özeti
 * kartta yoktur.
 */
async function buildCards(
  tx: Database,
  ctx: ServiceContext,
  deps: EmergencySummaryDeps,
  rows: readonly StoredEmergencySummary[],
  students: ReadonlyMap<string, StudentFacts>,
) {
  const visible = rows.filter(
    (row) => row.published !== null && students.get(row.studentId)?.active === true,
  )
  const ids = visible.map((row) => row.studentId)
  const [signals, medication, classNames, contactsOf] = await Promise.all([
    readHealthSignals(tx, ctx, deps, ids),
    studentsWithMedicationOn(tx, ctx.institutionId, dayKey(ctx.now), ids),
    classNamesOf(
      tx,
      ctx,
      ids.map((id) => students.get(id)?.classId ?? null),
    ),
    contactSources(tx, ctx, students, ids),
  ])
  return visible
    .map((row) => {
      const student = students.get(row.studentId)
      const health = signals.get(row.studentId) ?? NO_SIGNALS
      return {
        summaryId: row.id,
        studentId: row.studentId,
        studentName: student?.name ?? '—',
        classId: student?.classId ?? null,
        className:
          student?.classId == null ? null : (classNames.get(student.classId) ?? student.classId),
        actionText: open(deps, ctx.institutionId, row, 'published', row.published) ?? '',
        alerts: health.flags,
        medicationToday: medication.has(row.studentId),
        contacts: emergencyContacts(contactsOf(row.studentId)),
        needsReview: emergencySummaryNeedsReview(reviewedOf(row), health.stamp),
        approvedAt: row.approvedAt ?? row.updatedAt,
      }
    })
    .sort(
      (a, b) =>
        a.studentName.localeCompare(b.studentName, 'tr') || a.studentId.localeCompare(b.studentId),
    )
}

// --- Görüntüleme (K-521) -------------------------------------------------------------------------

/** Görülebilen sınıflar ve her birinde yayında özeti olan etkin öğrenci sayısı; sağlık değeri yok. */
export async function listEmergencyClassesFor(ctx: ServiceContext) {
  const [viewer, source] = await Promise.all([viewerOf(ctx), readSource(ctx)])
  const classes = emergencyViewerClasses(viewer)
  const visibleClassIds = source.classes
    .map((item) => item.id)
    .filter((id) => classes === 'all' || classes.has(id))
  const summaries = await listEmergencySummaries(ctx.db, ctx.institutionId, { publishedOnly: true })
  const students = await studentFacts(
    ctx.db,
    ctx,
    summaries.map((row) => row.studentId),
  )
  const counts = new Map<string, number>()
  for (const row of summaries) {
    const student = students.get(row.studentId)
    if (student?.active !== true || student.classId === null) continue
    counts.set(student.classId, (counts.get(student.classId) ?? 0) + 1)
  }
  const names = await classNamesOf(ctx.db, ctx, visibleClassIds)
  return visibleClassIds
    .map((id) => ({
      classId: id,
      className: names.get(id) ?? id,
      summaryCount: counts.get(id) ?? 0,
    }))
    .sort((a, b) => a.className.localeCompare(b.className, 'tr', { numeric: true }))
}

/**
 * Sınıfın kartları (K-521): yalnız yayında özeti olan etkin öğrenciler. Görüntüleme
 * `finance.emergency_summary.read`, sınıf PDF'i `finance.emergency_summary.print`; öğrenci başına
 * bir denetim satırı. Kapsam dışı ya da olmayan sınıf 404.
 */
export async function classEmergencyCardsFor(
  ctx: ServiceContext,
  deps: EmergencySummaryDeps,
  classId: string,
  purpose: EmergencyCardPurpose,
) {
  try {
    const [viewer, source] = await Promise.all([viewerOf(ctx), readSource(ctx)])
    assertEmergencyClassVisible(viewer, classId)
    if (!source.classes.some((item) => item.id === classId)) throw new NotFoundError()
    const classStudentIds = source.students
      .filter((student) => student.classId === classId)
      .map((student) => student.id)
    const className = (await classNamesOf(ctx.db, ctx, [classId])).get(classId) ?? classId
    return await ctx.db.transaction(async (tx) => {
      const [rows, students] = await Promise.all([
        listEmergencySummaries(tx, ctx.institutionId, {
          studentIds: classStudentIds,
          publishedOnly: true,
        }),
        studentFacts(tx, ctx, classStudentIds),
      ])
      const cards = await buildCards(tx, ctx, deps, rows, students)
      await auditSensitiveRead(
        tx,
        ctx,
        CARD_ACTIONS[purpose],
        cards.map((card) => card.studentId),
        CARD_FIELDS,
      )
      ctx.log.info({ event: CARD_ACTIONS[purpose], classId, count: cards.length })
      return { classId, className, listDate: dayKey(ctx.now), purpose, cards }
    })
  } catch (error) {
    throw mapOperationError(error)
  }
}

/** Öğrencinin yayındaki kartı; özeti yayında değilse, öğrenci kapsam dışıysa ya da ayrıldıysa 404. */
export async function studentEmergencyCardFor(
  ctx: ServiceContext,
  deps: EmergencySummaryDeps,
  studentId: string,
) {
  try {
    const viewer = await viewerOf(ctx)
    return await ctx.db.transaction(async (tx) => {
      const students = await studentFacts(tx, ctx, [studentId])
      const student = students.get(studentId)
      if (student === undefined) throw new NotFoundError()
      assertEmergencyClassVisible(viewer, student.classId)
      const row = await findStudentEmergencySummary(tx, ctx.institutionId, studentId)
      const [card] = await buildCards(tx, ctx, deps, row === null ? [] : [row], students)
      if (card === undefined) throw new NotFoundError()
      await auditSensitiveRead(tx, ctx, CARD_ACTIONS.view, [studentId], CARD_FIELDS)
      return card
    })
  } catch (error) {
    throw mapOperationError(error)
  }
}

/**
 * Acil iletişim kişisinin tam telefonu (K-521): yalnız kartı görebilene, yayında özeti olan etkin
 * öğrenci için. Her açılış `finance.emergency_summary.contact_reveal` denetimine düşer (telefon
 * yazılmaz); değer loga yazılmaz.
 */
export async function revealEmergencyContactFor(
  ctx: ServiceContext,
  studentId: string,
  position: number,
) {
  try {
    const viewer = await viewerOf(ctx)
    return await ctx.db.transaction(async (tx) => {
      const students = await studentFacts(tx, ctx, [studentId])
      const student = students.get(studentId)
      if (student === undefined || !student.active) throw new NotFoundError()
      assertEmergencyClassVisible(viewer, student.classId)
      const row = await findStudentEmergencySummary(tx, ctx.institutionId, studentId)
      if (row === null || row.published === null) throw new NotFoundError()
      const contactsOf = await contactSources(tx, ctx, students, [studentId])
      const contact = emergencyContactPhone(contactsOf(studentId), position)
      await auditSensitiveRead(
        tx,
        ctx,
        'finance.emergency_summary.contact_reveal',
        [studentId],
        [`contacts.${String(position)}.phone`],
      )
      return contact
    })
  } catch (error) {
    throw mapOperationError(error)
  }
}

// --- Yönetim (K-520) -----------------------------------------------------------------------------

export interface EmergencySummaryListQuery {
  page: number
  pageSize: number
  classId?: string | undefined
  state?: EmergencySummaryState | undefined
  q?: string | undefined
}

/**
 * Yönetim listesi (yönetici): öğrenci, sınıf, durum ve gözden geçirme işareti; metin ve uyarı
 * işareti yok, okuma denetlenmez. Öğrenci adına göre; arama öğrenci adında.
 */
export async function listEmergencySummariesFor(
  ctx: ServiceContext,
  deps: EmergencySummaryDeps,
  query: EmergencySummaryListQuery,
) {
  const rows = await listEmergencySummaries(ctx.db, ctx.institutionId)
  const students = await studentFacts(
    ctx.db,
    ctx,
    rows.map((row) => row.studentId),
  )
  const needle = query.q?.trim().toLocaleLowerCase('tr') ?? ''
  const matched = rows
    .map((row) => ({ row, student: students.get(row.studentId) ?? null }))
    .filter(
      ({ row, student }) =>
        (query.state === undefined || stateOf(row) === query.state) &&
        (query.classId === undefined || student?.classId === query.classId) &&
        (needle === '' || (student?.name ?? '').toLocaleLowerCase('tr').includes(needle)),
    )
    .sort(
      (a, b) =>
        (a.student?.name ?? '').localeCompare(b.student?.name ?? '', 'tr') ||
        a.row.studentId.localeCompare(b.row.studentId),
    )
  const page = matched.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
  const [classNames, signals] = await Promise.all([
    classNamesOf(
      ctx.db,
      ctx,
      page.map(({ student }) => student?.classId ?? null),
    ),
    readHealthSignals(
      ctx.db,
      ctx,
      deps,
      page.flatMap(({ row }) => (row.published === null ? [] : [row.studentId])),
    ),
  ])
  return {
    total: matched.length,
    items: page.map(({ row, student }) => ({
      id: row.id,
      studentId: row.studentId,
      studentName: student?.name ?? null,
      studentActive: student?.active ?? false,
      classId: student?.classId ?? null,
      className:
        student?.classId == null ? null : (classNames.get(student.classId) ?? student.classId),
      state: stateOf(row),
      needsReview: emergencySummaryNeedsReview(
        reviewedOf(row),
        (signals.get(row.studentId) ?? NO_SIGNALS).stamp,
      ),
      approvedAt: row.approvedAt,
      updatedAt: row.updatedAt,
      version: row.version,
    })),
  }
}

async function manageDetail(
  tx: Database,
  ctx: ServiceContext,
  deps: EmergencySummaryDeps,
  row: StoredEmergencySummary,
) {
  const students = await studentFacts(tx, ctx, [row.studentId])
  const student = students.get(row.studentId)
  const [signals, medication, classNames, contactsOf, approvers] = await Promise.all([
    readHealthSignals(tx, ctx, deps, [row.studentId]),
    studentsWithMedicationOn(tx, ctx.institutionId, dayKey(ctx.now), [row.studentId]),
    classNamesOf(tx, ctx, [student?.classId ?? null]),
    contactSources(tx, ctx, students, [row.studentId]),
    approverNames(tx, ctx, row.approvedByUserId),
  ])
  const health = signals.get(row.studentId) ?? NO_SIGNALS
  const texts = textsOf(deps, ctx.institutionId, row)
  return {
    id: row.id,
    studentId: row.studentId,
    studentName: student?.name ?? null,
    studentActive: student?.active ?? false,
    classId: student?.classId ?? null,
    className:
      student?.classId == null ? null : (classNames.get(student.classId) ?? student.classId),
    state: stateOf(row),
    draftText: texts.draft,
    publishedText: texts.published,
    profileInstructions: health.instructions === '' ? null : health.instructions,
    alerts: health.flags,
    medicationToday: medication.has(row.studentId),
    contacts: emergencyContacts(contactsOf(row.studentId)),
    needsReview: emergencySummaryNeedsReview(reviewedOf(row), health.stamp),
    approvedAt: row.approvedAt,
    approvedByName:
      row.approvedByUserId === null ? null : (approvers.get(row.approvedByUserId) ?? null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  }
}

/** Onaylayanın adı (kurum üyeliğinin hesap adı); bulunamazsa haritada yok. */
async function approverNames(tx: Database, ctx: ServiceContext, userId: string | null) {
  const names = new Map<string, string>()
  if (userId === null) return names
  const [user] = await tx
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (user !== undefined) names.set(userId, user.name)
  return names
}

/** Yönetim ayrıntısı (yönetici): taslak ve yayındaki metin, profil talimatı; okuma denetlenir. */
export async function getEmergencySummaryFor(
  ctx: ServiceContext,
  deps: EmergencySummaryDeps,
  id: string,
) {
  return ctx.db.transaction(async (tx) => {
    const row = await summaryOf(tx, ctx, id)
    const body = await manageDetail(tx, ctx, deps, row)
    await auditSensitiveRead(
      tx,
      ctx,
      'finance.emergency_summary.manage_read',
      [row.studentId],
      MANAGE_FIELDS,
    )
    return body
  })
}

async function summaryOf(tx: Database, ctx: ServiceContext, id: string) {
  const row = await findEmergencySummary(tx, ctx.institutionId, id)
  if (row === null) throw new NotFoundError()
  return row
}

async function versionedSummary(
  tx: Database,
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
) {
  const row = await summaryOf(tx, ctx, id)
  if (row.version !== expectedVersion) throw new ConflictError()
  return row
}

/** Yazmanın yanıtı: yönetim ayrıntısı (yazanın okuması da denetime düşer). */
async function respondDetail(
  tx: Database,
  ctx: ServiceContext,
  deps: EmergencySummaryDeps,
  id: string,
) {
  const row = await summaryOf(tx, ctx, id)
  const body = await manageDetail(tx, ctx, deps, row)
  await auditSensitiveRead(
    tx,
    ctx,
    'finance.emergency_summary.manage_read',
    [row.studentId],
    MANAGE_FIELDS,
  )
  return { data: body }
}

/** Yeni özet (K-520): taslak olarak açılır; `Idempotency-Key` rotada zorunlu. 201. */
export function createEmergencySummaryCommand(
  ctx: ServiceContext,
  deps: EmergencySummaryDeps,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: TABLE, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.emergency_summary.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = emergencySummaryCreateSchema.parse(input)
        const [students, existing] = await Promise.all([
          studentFacts(tx, ctx, [parsed.studentId]),
          findStudentEmergencySummary(tx, ctx.institutionId, parsed.studentId),
        ])
        const student = students.get(parsed.studentId)
        return {
          run: () =>
            planEmergencySummaryCreate(parsed, {
              student: student === undefined ? null : { active: student.active },
              summaryExists: existing !== null,
            }),
        }
      },
      after: async (tx, planned) => {
        const key = { id, studentId: planned.studentId }
        await insertEmergencySummary(tx, ctx.institutionId, {
          id,
          studentId: planned.studentId,
          draft: seal(deps, ctx.institutionId, key, 'draft', planned.draft),
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.emergency_summary.create', entity, [
          'studentId',
          'draftText',
        ])
        body = await respondDetail(tx, ctx, deps, id)
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Metin düzeltmesi (K-520): onay bekleyen metin olur; `If-Match` özet sürümü. */
export function updateEmergencySummaryCommand(
  ctx: ServiceContext,
  deps: EmergencySummaryDeps,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TABLE, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.emergency_summary.update',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await versionedSummary(tx, ctx, id, expectedVersion)
        const parsed = emergencySummaryUpdateSchema.parse(input)
        const texts = textsOf(deps, ctx.institutionId, row)
        return { run: () => ({ row, plan: planEmergencySummaryUpdate(texts, parsed) }) }
      },
      after: async (tx, { row, plan }) => {
        const saved = await updateEmergencySummaryDraft(tx, ctx.institutionId, {
          id,
          expectedVersion,
          draft:
            plan.draft === null ? null : seal(deps, ctx.institutionId, row, 'draft', plan.draft),
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.emergency_summary.update', entity, ['draftText'])
        body = await respondDetail(tx, ctx, deps, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Onay (K-520): taslak yayına alınır ya da profil değiştiyse yayındaki metin yeniden onaylanır;
 * onay anındaki profil damgası saklanır. `If-Match` özet sürümü.
 */
export function approveEmergencySummaryCommand(
  ctx: ServiceContext,
  deps: EmergencySummaryDeps,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TABLE, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.emergency_summary.approve',
      collections: [],
      entity,
      load: async (tx) => {
        const row = await versionedSummary(tx, ctx, id, expectedVersion)
        const texts = textsOf(deps, ctx.institutionId, row)
        const signals = await readHealthSignals(tx, ctx, deps, [row.studentId])
        const stamp = (signals.get(row.studentId) ?? NO_SIGNALS).stamp
        return {
          run: () => ({
            row,
            hadDraft: texts.draft !== null,
            plan: planEmergencySummaryApproval({ ...texts, reviewed: reviewedOf(row) }, stamp),
          }),
        }
      },
      after: async (tx, { row, hadDraft, plan }) => {
        const saved = await publishEmergencySummary(tx, ctx.institutionId, {
          id,
          expectedVersion,
          published: seal(deps, ctx.institutionId, row, 'published', plan.published),
          reviewed: plan.reviewed,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          'finance.emergency_summary.approve',
          entity,
          hadDraft ? ['publishedText', 'reviewedProfile'] : ['reviewedProfile'],
        )
        body = await respondDetail(tx, ctx, deps, id)
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/** Arşiv (K-520): özet görünmez olur; öğrenci için yeni özet açılabilir. `If-Match` sürümü. */
export function archiveEmergencySummaryCommand(
  ctx: ServiceContext,
  id: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: TABLE, id }
  return runCommand(
    ctx,
    {
      action: 'finance.emergency_summary.archive',
      collections: [],
      entity,
      load: async (tx) => {
        await versionedSummary(tx, ctx, id, expectedVersion)
        return { run: () => null }
      },
      after: async (tx) => {
        const saved = await archiveEmergencySummary(tx, ctx.institutionId, {
          id,
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.emergency_summary.archive', entity, ['archivedAt'])
      },
    },
    () => ({ statusCode: 200, body: { data: { id, archived: true } } }),
    idempotency,
  )
}
