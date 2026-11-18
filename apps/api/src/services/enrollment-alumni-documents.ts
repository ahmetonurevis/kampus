import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import {
  ALUMNI_DOCUMENT_ROLES,
  alumniDocumentNumber,
  alumniRequestActions,
  buildAlumniEducationCertificate,
  buildAlumniTranscript,
  createAlumniDocumentRequestSchema,
  isAdultOn,
  planAlumniDocumentRequest,
  planAlumniRequestDeliver,
  planAlumniRequestReady,
  planAlumniRequestReject,
  planAlumniRequestStart,
  updateAlumniDocumentFeesSchema,
  type AlumniDocumentContent,
  type AlumniDocumentType,
  type AlumniGradeFact,
  type AlumniLearnerFacts,
  type AlumniRequestAction,
} from '@kampus/school-core/lib/enrollment-alumni-documents.ts'
import {
  enrollmentStatuses,
  type EnrollmentRenewal,
  type EnrollmentStatus,
} from '@kampus/school-core/lib/enrollment-status.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

import type { Database } from '../db/client.ts'
import {
  findAlumniRequest,
  insertAlumniRequest,
  listAlumniRequests,
  listInactiveStudents,
  loadAlumniCourses,
  loadAlumniFees,
  loadBirthDates,
  loadGuardianBonds,
  loadWithdrawalDates,
  nextAlumniDocumentSequence,
  updateAlumniRequest,
  upsertAlumniFees,
  type AlumniRequestQuery,
  type AlumniRequestUpdate,
  type StoredAlumniRequest,
} from '../db/enrollment-alumni-documents.ts'
import { purchaseActorNames } from '../db/finance-purchase-requests.ts'
import { findRecord, loadRecords, loadRecordsByIds } from '../db/records.ts'
import { institutions } from '../db/schema/auth.ts'
import { ConflictError, NotFoundError, RuleViolationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile } from './files.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Mezun belge talebi (docs/domain/kayit-ve-crm.md DOM-KAY-044; ON-260). Kural core
 * `lib/enrollment-alumni-documents.ts`'tedir; servis kurum kilidi altında öğrencinin kayıt
 * durumunu, veli bağını, yaşını ve ücret ayarını yükler, core'a karar verdirir, aynı
 * transaction'da yazar ve denetim kaydı bırakır (yalnız alan adları). Yetki ve modül (`crm`)
 * rotadadır. Vekâletname, rıza ve diploma örneği dosyaları talebe bağlanır; bağlı dosyayı yalnız
 * yönetici ve ön büro açar.
 */

const ENTITY = 'alumni_document_requests'
export const ALUMNI_DOCUMENT_ATTACHMENT = 'alumni_document_request'

const studentFacts = z.object({
  name: z.string(),
  classId: z.string().optional(),
  number: z.string().nullish(),
  isActive: z.boolean().optional(),
  joinedAt: z.string().optional(),
  birthDate: z.string().nullish(),
})
type StudentFacts = z.infer<typeof studentFacts>

const renewalFacts = z.object({
  id: z.string(),
  studentId: z.string(),
  mode: z.enum(['renew', 'graduate']),
  status: z.string(),
  year: z.number(),
  fromClassId: z.string(),
  targetClassId: z.string(),
  createdAt: z.string(),
  activatedAt: z.string().optional(),
})

const gradeFacts = z.object({
  classId: z.string(),
  term: z.number(),
  subjectId: z.string(),
  subject: z.string(),
  score: z.number(),
  date: z.string(),
})

const named = z.object({ name: z.string() })
const iso = (value: Date | null) => (value === null ? null : value.toISOString())
const nameOf = (names: ReadonlyMap<string, string>, userId: string | null) =>
  userId === null ? null : (names.get(userId) ?? null)

async function loadInstitution(db: Database, institutionId: string) {
  const [row] = await db
    .select({ name: institutions.name, type: institutions.type })
    .from(institutions)
    .where(eq(institutions.id, institutionId))
    .limit(1)
  if (!row) throw new NotFoundError()
  return row as { name: string; type: InstitutionType }
}

async function loadRenewals(
  db: Database,
  institutionId: string,
  studentIds: readonly string[],
): Promise<EnrollmentRenewal[]> {
  if (studentIds.length === 0) return []
  const rows = await loadRecords(db, institutionId, ['renewals'], {
    match: [{ field: 'studentId', values: [...studentIds] }],
  })
  return rows.flatMap((row) => {
    const parsed = renewalFacts.safeParse(row.data)
    return parsed.success ? [parsed.data] : []
  })
}

interface AlumniStudent {
  id: string
  facts: StudentFacts
  status: EnrollmentStatus
  enrolledDate: string | null
  leftDate: string | null
  lastClassId: string | null
}

const isGraduation = (renewal: EnrollmentRenewal) =>
  renewal.mode === 'graduate' && renewal.status === 'Mezun'

/** Kayıt durumu, kayıt ve ayrılış günü (DOM-KAY-026 olaylarıyla aynı kaynak). */
async function describeStudents(
  db: Database,
  institutionId: string,
  rows: readonly { id: string; data: unknown }[],
): Promise<AlumniStudent[]> {
  const parsed = rows.flatMap((row) => {
    const facts = studentFacts.safeParse(row.data)
    return facts.success ? [{ id: row.id, facts: facts.data }] : []
  })
  const ids = parsed.map((row) => row.id)
  const [renewals, withdrawals] = await Promise.all([
    loadRenewals(db, institutionId, ids),
    loadWithdrawalDates(db, institutionId, ids),
  ])
  const statuses = enrollmentStatuses(
    parsed.map((row) => ({
      id: row.id,
      classId: row.facts.classId ?? '',
      ...(row.facts.isActive === undefined ? {} : { isActive: row.facts.isActive }),
    })),
    { renewals },
  )
  return parsed.map(({ id, facts }) => {
    const status = statuses.get(id) ?? 'active'
    const graduation = renewals.find((renewal) => renewal.studentId === id && isGraduation(renewal))
    const leftDate =
      status === 'graduated'
        ? graduation?.activatedAt
          ? dayKey(graduation.activatedAt)
          : null
        : status === 'withdrawn'
          ? (withdrawals.get(id) ?? null)
          : null
    return {
      id,
      facts,
      status,
      enrolledDate: facts.joinedAt ? dayKey(facts.joinedAt) : null,
      leftDate,
      lastClassId:
        status === 'graduated' && graduation ? graduation.fromClassId : (facts.classId ?? null),
    }
  })
}

async function findAlumniStudent(
  db: Database,
  institutionId: string,
  studentId: string,
): Promise<AlumniStudent | null> {
  const row = await findRecord(db, institutionId, 'students', studentId)
  if (row === null) return null
  const [student] = await describeStudents(db, institutionId, [row])
  return student ?? null
}

async function recordNames(
  db: Database,
  institutionId: string,
  collection: 'classes' | 'parents',
  ids: readonly (string | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null && id !== ''))]
  const rows = await loadRecordsByIds(db, institutionId, collection, wanted, {
    includeArchived: true,
  })
  return new Map(
    rows.flatMap((row) => {
      const parsed = named.safeParse(row.data)
      return parsed.success ? [[row.id, parsed.data.name] as const] : []
    }),
  )
}

// --- Görünümler ----------------------------------------------------------------------------------

function documentNumber(request: StoredAlumniRequest): string | null {
  return request.documentYear === null || request.documentSequence === null
    ? null
    : alumniDocumentNumber(request.documentYear, request.documentSequence)
}

function requestView(request: StoredAlumniRequest, names: ReadonlyMap<string, string>) {
  return {
    id: request.id,
    documentNumber: documentNumber(request),
    studentId: request.studentId,
    studentName: request.studentName,
    documentType: request.documentType,
    copies: request.copies,
    channel: request.channel,
    requesterKind: request.requesterKind,
    requesterName: request.requesterName,
    guardianParentId: request.guardianParentId,
    authorizationFileId: request.authorizationFileId,
    deliveryMethod: request.deliveryMethod,
    deliveryEmail: request.deliveryEmail,
    deliveryAddress: request.deliveryAddress,
    feeCents: request.feeCents,
    status: request.status,
    receivedAt: request.createdAt.toISOString(),
    receivedByName: nameOf(names, request.receivedByUserId),
    preparingAt: iso(request.preparingAt),
    preparingByName: nameOf(names, request.preparingByUserId),
    readyAt: iso(request.readyAt),
    readyByName: nameOf(names, request.readyByUserId),
    manualNote: request.manualNote,
    diplomaFileId: request.diplomaFileId,
    deliveredAt: iso(request.deliveredAt),
    deliveredByName: nameOf(names, request.deliveredByUserId),
    identityCheckNote: request.identityCheckNote,
    paymentMethod: request.paymentMethod,
    paidAt: iso(request.paidAt),
    rejectedAt: iso(request.rejectedAt),
    rejectedByName: nameOf(names, request.rejectedByUserId),
    rejectionReason: request.rejectionReason,
    actions: alumniRequestActions(request.status),
    version: request.version,
  }
}

const actorIds = (request: StoredAlumniRequest) =>
  [
    request.receivedByUserId,
    request.preparingByUserId,
    request.readyByUserId,
    request.deliveredByUserId,
    request.rejectedByUserId,
  ].filter((value): value is string => value !== null)

export async function listAlumniRequestsFor(ctx: ServiceContext, query: AlumniRequestQuery) {
  const { items, total } = await listAlumniRequests(ctx.db, ctx.institutionId, query)
  const names = await purchaseActorNames(ctx.db, ctx.institutionId, items.flatMap(actorIds))
  return { items: items.map((item) => requestView(item, names)), total }
}

async function detail(db: Database, ctx: ServiceContext, id: string) {
  const request = await findAlumniRequest(db, ctx.institutionId, id)
  if (request === null) throw new NotFoundError()
  const names = await purchaseActorNames(db, ctx.institutionId, actorIds(request))
  return requestView(request, names)
}

export const getAlumniRequestFor = (ctx: ServiceContext, id: string) => detail(ctx.db, ctx, id)

/**
 * Talep formunun öğrenci seçimi: pasif (mezun ya da ayrılmış) öğrenciler, kayıt durumu, ayrılış
 * günü, reşit olup olmadığı ve veli kaydına bağlı velileri (velayet ve kısıt). Kimlik numarası ve
 * doğum tarihi dönmez.
 */
export async function listAlumniStudentsFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined },
) {
  const { items, total } = await listInactiveStudents(ctx.db, ctx.institutionId, query)
  const students = await describeStudents(ctx.db, ctx.institutionId, items)
  const ids = students.map((student) => student.id)
  const [birthDates, bonds, classNames] = await Promise.all([
    loadBirthDates(ctx.db, ctx.institutionId, ids),
    loadGuardianBonds(ctx.db, ctx.institutionId, ids),
    recordNames(
      ctx.db,
      ctx.institutionId,
      'classes',
      students.map((student) => student.lastClassId),
    ),
  ])
  const parentNames = await recordNames(
    ctx.db,
    ctx.institutionId,
    'parents',
    bonds.map((bond) => bond.parentId),
  )
  const today = dayKey(ctx.now)
  return {
    items: students.map((student) => ({
      id: student.id,
      name: student.facts.name,
      schoolNumber: student.facts.number?.trim() || null,
      status: student.status === 'graduated' ? ('graduated' as const) : ('withdrawn' as const),
      leftDate: student.leftDate,
      lastClassName:
        student.lastClassId === null ? null : (classNames.get(student.lastClassId) ?? null),
      adult: isAdultOn(birthDates.get(student.id) ?? student.facts.birthDate ?? null, today),
      guardians: bonds
        .filter((bond) => bond.studentId === student.id)
        .map((bond) => ({
          parentId: bond.parentId,
          name: parentNames.get(bond.parentId) ?? null,
          custody: bond.custody,
          contactRestricted: bond.contactRestricted,
        }))
        .sort((left, right) => (left.name ?? '').localeCompare(right.name ?? '', 'tr')),
    })),
    total,
  }
}

// --- Ücret ayarı ---------------------------------------------------------------------------------

export async function getAlumniFeesFor(ctx: ServiceContext) {
  const { fees, updatedAt } = await loadAlumniFees(ctx.db, ctx.institutionId)
  return { ...fees, updatedAt: iso(updatedAt) }
}

/** Ücret ayarı (K-329): yalnız gönderilen türler değişir; açık taleplerin ücreti değişmez. */
export function updateAlumniFeesCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: 'alumni_document_fees', id: ctx.institutionId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'alumni_document_fees.update',
      collections: [],
      entity,
      load: () => Promise.resolve({ run: () => updateAlumniDocumentFeesSchema.parse(input) }),
      after: async (tx, fees) => {
        await upsertAlumniFees(tx, ctx.institutionId, {
          fees,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'alumni_document_fees.update', entity, Object.keys(fees))
        const loaded = await loadAlumniFees(tx, ctx.institutionId)
        body = { data: { ...loaded.fees, updatedAt: iso(loaded.updatedAt) } }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

// --- Talep ---------------------------------------------------------------------------------------

const rawText = (input: unknown, field: string): string | null => {
  const value = (input ?? {}) as Record<string, unknown>
  const raw = value[field]
  return typeof raw === 'string' && raw.trim() !== '' && raw.length <= 200 ? raw.trim() : null
}

/**
 * Talebi kaydet (DOM-KAY-044, K-328): öğrencinin durumu, yaşı ve seçilen velinin bağı kurum kilidi
 * altında okunur; ücret ayardan dondurulur; vekâletname ya da rıza dosyası talebe bağlanır. 201.
 */
export function createAlumniRequestCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'alumni_document_request.create',
      collections: [],
      entity,
      load: async (tx) => {
        const studentId = rawText(input, 'studentId')
        const parentId = rawText(input, 'guardianParentId')
        const student =
          studentId === null ? null : await findAlumniStudent(tx, ctx.institutionId, studentId)
        const [institution, fees, birthDates, bonds, parentNames] = await Promise.all([
          loadInstitution(tx, ctx.institutionId),
          loadAlumniFees(tx, ctx.institutionId),
          loadBirthDates(tx, ctx.institutionId, student ? [student.id] : []),
          loadGuardianBonds(tx, ctx.institutionId, student ? [student.id] : []),
          recordNames(tx, ctx.institutionId, 'parents', [parentId]),
        ])
        return {
          run: () => {
            const parsed = createAlumniDocumentRequestSchema.parse(input)
            // Olmayan, arşivlenmiş ya da başka kurumun öğrencisi aynı 404 (varlık sızmaz).
            if (student === null) throw new NotFoundError()
            const bond = bonds.find(
              (item) => item.studentId === student.id && item.parentId === parsed.guardianParentId,
            )
            const plan = planAlumniDocumentRequest(input, {
              institutionType: institution.type,
              status: student.status,
              adult: isAdultOn(
                birthDates.get(student.id) ?? student.facts.birthDate ?? null,
                dayKey(ctx.now),
              ),
              guardianBond: bond
                ? { custody: bond.custody, contactRestricted: bond.contactRestricted }
                : null,
              unitFeeCents: fees.fees[parsed.documentType],
            })
            const requesterName =
              plan.requesterKind === 'self'
                ? student.facts.name
                : plan.requesterKind === 'guardian'
                  ? (parentNames.get(plan.guardianParentId ?? '') ?? 'Veli')
                  : (plan.proxyName ?? '')
            return { plan, requesterName }
          },
        }
      },
      after: async (tx, { plan, requesterName }) => {
        if (plan.authorizationFileId !== null)
          await attachFile(tx, ctx, {
            fileId: plan.authorizationFileId,
            attachedType: ALUMNI_DOCUMENT_ATTACHMENT,
            attachedId: id,
            dataSubjectId: plan.studentId,
          })
        await insertAlumniRequest(tx, ctx.institutionId, {
          id,
          studentId: plan.studentId,
          documentType: plan.documentType,
          copies: plan.copies,
          channel: plan.channel,
          requesterKind: plan.requesterKind,
          guardianParentId: plan.guardianParentId,
          requesterName: requesterName.slice(0, 120),
          authorizationFileId: plan.authorizationFileId,
          deliveryMethod: plan.deliveryMethod,
          deliveryEmail: plan.deliveryEmail,
          deliveryAddress: plan.deliveryAddress,
          feeCents: plan.feeCents,
          receivedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'alumni_document_request.create',
          entity,
          Object.keys(plan).filter((key) => (plan as Record<string, unknown>)[key] !== null),
        )
        body = { data: await detail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Belgenin içeriği: kayıtlardan, hazır anında üretilir ve dondurulur. */
async function buildContent(
  tx: Database,
  ctx: ServiceContext,
  documentType: AlumniDocumentType,
  studentId: string,
): Promise<AlumniDocumentContent | null> {
  if (documentType === 'diploma_copy') return null
  // Öğrenci kaydı talepten sonra arşivlenmiş olabilir; belge yine kaydın gerçeğini yazar.
  const row = await findRecord(tx, ctx.institutionId, 'students', studentId, {
    includeArchived: true,
  })
  if (row === null) throw new NotFoundError()
  const [student] = await describeStudents(tx, ctx.institutionId, [row])
  if (!student || student.status === 'active')
    throw new RuleViolationError(
      'alumni_document_student_active',
      'Öğrencinin kaydı yeniden aktif; mezun belgesi yerine öğrenci belgesi düzenlenir.',
    )
  const institution = await loadInstitution(tx, ctx.institutionId)
  const grades =
    documentType === 'transcript' && institution.type === 'school'
      ? (
          await loadRecords(tx, ctx.institutionId, ['grades'], {
            match: [{ field: 'studentId', values: [studentId] }],
          })
        ).flatMap((item): AlumniGradeFact[] => {
          const parsed = gradeFacts.safeParse(item.data)
          return parsed.success ? [{ ...parsed.data, date: parsed.data.date.slice(0, 10) }] : []
        })
      : []
  const classNames = await recordNames(tx, ctx.institutionId, 'classes', [
    student.lastClassId,
    ...grades.map((grade) => grade.classId),
  ])
  const learner: AlumniLearnerFacts = {
    institution,
    student: { name: student.facts.name, number: student.facts.number ?? null },
    outcome: student.status === 'graduated' ? 'graduated' : 'withdrawn',
    enrolledDate: student.enrolledDate,
    leftDate: student.leftDate,
    lastClassName:
      student.lastClassId === null ? null : (classNames.get(student.lastClassId) ?? null),
  }
  if (documentType === 'education_certificate') return buildAlumniEducationCertificate(learner)
  const courses =
    institution.type === 'language_school'
      ? await loadAlumniCourses(tx, ctx.institutionId, studentId, dayKey(ctx.now))
      : []
  return buildAlumniTranscript({ ...learner, grades, classNames, courses })
}

/**
 * Durum geçişleri (K-330): hazırlamaya başla, hazır (numara, içerik, diploma dosyası), teslim
 * (kimlik notu, ücretliyse ödeme yöntemi; K-329) ve ret (gerekçe).
 */
export function transitionAlumniRequestCommand(
  ctx: ServiceContext,
  id: string,
  action: AlumniRequestAction,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id }
  const auditAction = `alumni_document_request.${action}`
  let body: unknown
  return runCommand(
    ctx,
    {
      action: auditAction,
      collections: [],
      entity,
      load: async (tx) => {
        const current = await findAlumniRequest(tx, ctx.institutionId, id)
        if (current === null) throw new NotFoundError()
        if (current.version !== expectedVersion) throw new ConflictError()
        const content =
          action === 'ready' && current.status === 'preparing'
            ? await buildContent(tx, ctx, current.documentType, current.studentId)
            : null
        const year = Number(dayKey(ctx.now).slice(0, 4))
        const sequence =
          action === 'ready' ? await nextAlumniDocumentSequence(tx, ctx.institutionId, year) : 0
        return {
          run: (): { changes: AlumniRequestUpdate; fileId: string | null } => {
            switch (action) {
              case 'start':
                planAlumniRequestStart(current)
                return {
                  changes: {
                    status: 'preparing',
                    preparingAt: ctx.now,
                    preparingByUserId: ctx.actor.userId,
                  },
                  fileId: null,
                }
              case 'ready': {
                const { manualNote, fileId } = planAlumniRequestReady(current, input, content)
                return {
                  changes: {
                    status: 'ready',
                    readyAt: ctx.now,
                    readyByUserId: ctx.actor.userId,
                    documentYear: year,
                    documentSequence: sequence,
                    documentContent: content,
                    manualNote,
                    diplomaFileId: fileId,
                  },
                  fileId,
                }
              }
              case 'deliver': {
                const { identityCheckNote, paymentMethod } = planAlumniRequestDeliver(
                  current,
                  input,
                )
                return {
                  changes: {
                    status: 'delivered',
                    deliveredAt: ctx.now,
                    deliveredByUserId: ctx.actor.userId,
                    identityCheckNote,
                    paymentMethod,
                    paidAt: paymentMethod === null ? null : ctx.now,
                  },
                  fileId: null,
                }
              }
              case 'reject': {
                const { reason } = planAlumniRequestReject(current, input)
                return {
                  changes: {
                    status: 'rejected',
                    rejectedAt: ctx.now,
                    rejectedByUserId: ctx.actor.userId,
                    rejectionReason: reason,
                  },
                  fileId: null,
                }
              }
              default:
                return action satisfies never
            }
          },
        }
      },
      after: async (tx, { changes, fileId }) => {
        if (fileId !== null)
          await attachFile(tx, ctx, {
            fileId,
            attachedType: ALUMNI_DOCUMENT_ATTACHMENT,
            attachedId: id,
            dataSubjectId: null,
          })
        const saved = await updateAlumniRequest(tx, ctx.institutionId, {
          id,
          expectedVersion,
          changes,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(
          tx,
          ctx,
          auditAction,
          entity,
          Object.keys(changes).filter((key) => (changes as Record<string, unknown>)[key] !== null),
        )
        body = { data: await detail(tx, ctx, id) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}

/**
 * Hazır belgenin PDF verisi (öğrenim belgesi, not dökümü): dondurulmuş içerik, numara ve hazırlayanın
 * notu. Kişisel veri dışa aktarımı olduğu için her istek denetime `alumni_document.issue` olarak
 * yazılır (yalnız alan adları; DOM-YTK-052). Diploma örneği PDF üretmez (dosyası açılır).
 */
export async function issueAlumniDocument(ctx: ServiceContext, id: string) {
  return ctx.db.transaction(async (tx) => {
    const request = await findAlumniRequest(tx, ctx.institutionId, id)
    if (request === null) throw new NotFoundError()
    if (request.documentType === 'diploma_copy')
      throw new RuleViolationError(
        'alumni_document_no_pdf',
        'Diploma örneği dosya olarak eklenir; PDF üretilmez.',
      )
    const number = documentNumber(request)
    if (
      request.documentContent === null ||
      request.readyAt === null ||
      number === null ||
      (request.status !== 'ready' && request.status !== 'delivered')
    )
      throw new RuleViolationError(
        'alumni_document_not_ready',
        'Belge henüz hazır değil ya da talep reddedildi.',
      )
    await auditWork(tx, ctx, 'alumni_document.issue', { type: ENTITY, id }, [
      'documentNumber',
      'content',
      'manualNote',
    ])
    return {
      requestId: request.id,
      documentNumber: number,
      documentType: request.documentType,
      copies: request.copies,
      issuedAt: request.readyAt.toISOString(),
      manualNote: request.manualNote,
      content: request.documentContent,
    }
  })
}

/**
 * Talebe bağlı vekâletname, rıza ve diploma örneği dosyası (ADR 0003 karar 6): yalnız yönetici ve
 * ön büro açar, talep kurumda olmalıdır. Öğrenci ve veli bu dosyaları görmez.
 */
defineFileAttachment(ALUMNI_DOCUMENT_ATTACHMENT, {
  purposes: ['document'],
  canRead: async (tx, ctx, attachedId) => {
    if (!ALUMNI_DOCUMENT_ROLES.some((role) => role === ctx.actor.role)) return false
    return (await findAlumniRequest(tx, ctx.institutionId, attachedId)) !== null
  },
})
