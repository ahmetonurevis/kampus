import { randomBytes, randomUUID } from 'node:crypto'

import {
  VERIFICATION_CODE_BYTES,
  certificateVerificationView,
  formatCertificateNumber,
  formatVerificationCode,
  mebbisEligibleDecisionId,
  normalizeVerificationCode,
  planCertificateCancellation,
  planCertificateIssue,
  planMebbisRecord,
  type CertificateCancellation,
  type CertificateDraft,
  type CertificateStatus,
  type CertificateVerification,
  type MebbisRecord,
  type MebbisRecordDraft,
} from '@kampus/school-core/cefr/certificates.ts'
import { canReadGroup } from '@kampus/school-core/lib/language-groups.ts'

import {
  findCertificate,
  findCertificateByCode,
  insertCertificate,
  insertMebbisRecord,
  listCertificates,
  listEnrollmentCertificates,
  listMebbisRecords,
  nextCertificateSerial,
  saveCertificateCancellation,
  type StoredCertificate,
} from '../db/certificates.ts'
import { findProgressionDecision, listProgressionDecisions } from '../db/cefr.ts'
import type { Database } from '../db/client.ts'
import { loadCourses } from '../db/courses.ts'
import { loadGroups } from '../db/language-groups.ts'
import { listGroupEnrollments } from '../db/progression.ts'
import { loadRecordsByIds } from '../db/records.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitution, listMembershipLinks } from './memberships.ts'
import { learnerMinor } from './notify.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import {
  UUID,
  coordinationOf,
  enrollmentContext,
  groupContext,
  languageSchool,
  type EnrollmentContext,
} from './progression.ts'
import { auditWork } from './task-work.ts'

/**
 * Kurum başarı belgesi ve MEBBİS belge izi (OG-088; IST-081; docs/domain/dil-okulu.md DOM-DIL-080,
 * 081, 082). Kural core `cefr/certificates.ts`'tedir; burada kayıt, karar, kur, kurum ve kişi
 * kapsamı yüklenir, iş tek transaction ve kurum kilidi altında yazılır (`runCommand`). Uçlar yalnız
 * dil okulundadır (rota).
 *
 * - Belgeyi kurum yöneticisi ya da kurun seviyesinin akademik koordinatörü düzenler ve iptal eder
 *   (core `canIssueCertificate`); grubu okuyamayan öğretmen için kayıt yoktur (404).
 * - Belge numarası kurum sayacından kilitli artırmayla alınır (`nextCertificateSerial`); doğrulama
 *   kodu `node:crypto` ile 144 bit rastgeledir (kodda 140 bit) ve numaradan türetilmez.
 * - Öğrenci yalnız kendi, veli yalnız 18 yaş altı çocuğunun **geçerli** belgesini görür; iptal
 *   edilen belge ve düzenleyen/iptal eden kişiler gösterilmez.
 * - Kimliksiz doğrulama (`verifyCertificate`) yalnız baş harf, kur, gün, durum ve kurum adı verir.
 */

const certificateEntity = (id: string) => ({ type: 'course_certificate', id })
const mebbisEntity = (id: string) => ({ type: 'mebbis_certificate_record', id })

function respond(out: { body?: unknown }, statusCode: number) {
  return () => {
    if (out.body === undefined) throw new Error('certificate command was not written')
    return { statusCode, body: out.body }
  }
}

// --- Görünüm ------------------------------------------------------------------------------

/** Personel görünümü: belge, kod, bağlar, düzenleyen ve iptal izi. */
function staffView(certificate: StoredCertificate) {
  return {
    id: certificate.id,
    number: certificate.number,
    status: certificate.status,
    verificationCode: certificate.verificationCode,
    enrollmentId: certificate.enrollmentId,
    groupId: certificate.groupId,
    learnerId: certificate.learnerId,
    courseId: certificate.courseId,
    decisionId: certificate.decisionId,
    content: certificate.content,
    replacesCertificateId: certificate.replacesCertificateId,
    issuedByUserId: certificate.issuedByUserId,
    issuedAt: certificate.issuedAt,
    cancelledByUserId: certificate.cancelledByUserId,
    cancelledAt: certificate.cancelledAt,
    cancellationReason: certificate.cancellationReason,
    rowVersion: certificate.rowVersion,
  }
}

/** Kursiyer ve veli görünümü: yalnız geçerli belge; kişiler ve iptal izi yok. */
function learnerView(certificate: StoredCertificate) {
  return {
    id: certificate.id,
    number: certificate.number,
    status: certificate.status,
    verificationCode: certificate.verificationCode,
    courseId: certificate.courseId,
    content: certificate.content,
    issuedAt: certificate.issuedAt,
  }
}

// --- Kapsam -------------------------------------------------------------------------------

/**
 * Okuma kapsamı: yönetici kurumun bütünü (`{}`), öğretmen okuyabildiği gruplar (`groupIds`: kendi
 * grubu ya da koordinatörü olduğu seviyenin grubu), öğrenci kendisi, veli 18 yaş altı çocukları
 * (`learnerIds`, yalnız geçerli belge).
 */
async function readScope(
  ctx: ServiceContext,
): Promise<
  | { kind: 'all' }
  | { kind: 'groups'; groupIds: string[] }
  | { kind: 'learner'; learnerIds: string[] }
> {
  const { role } = ctx.actor
  if (role === 'yonetici') return { kind: 'all' }
  if (role === 'ogretmen') {
    const [groups, courses, coordination] = await Promise.all([
      loadGroups(ctx.db, ctx.institutionId),
      loadCourses(ctx.db, ctx.institutionId),
      coordinationOf(ctx.db, ctx),
    ])
    const courseOf = new Map(courses.map((course) => [course.id, course]))
    const reader = {
      role,
      membershipId: ctx.actor.membershipId,
      coordination,
      studentIds: [] as string[],
    }
    const groupIds = groups
      .filter((group) => {
        const course = courseOf.get(group.courseId)
        return course !== undefined && canReadGroup(reader, group, course, [])
      })
      .map((group) => group.id)
    return { kind: 'groups', groupIds }
  }
  const links = await listMembershipLinks(ctx.db, ctx.institutionId, ctx.actor.membershipId)
  if (role === 'ogrenci') {
    return {
      kind: 'learner',
      learnerIds: links.filter((link) => link.kind === 'student').map((link) => link.recordId),
    }
  }
  // Veli: yalnız 18 yaş altı çocuğu (DOM-DIL-090, 091; OG-086 `learnerMinor`).
  const type = await languageSchool(ctx.db, ctx)
  const children = links.filter((link) => link.kind === 'child').map((link) => link.recordId)
  const minors: string[] = []
  for (const child of children) if (await learnerMinor(ctx.db, ctx, type, child)) minors.push(child)
  return { kind: 'learner', learnerIds: minors }
}

// --- Yazma --------------------------------------------------------------------------------

/** Kursiyerin ad-soyadı (`students` kaydı); belgeye yazılır. */
async function learnerName(db: Database, institutionId: string, studentId: string) {
  const [record] = await loadRecordsByIds(db, institutionId, 'students', [studentId])
  const name = record?.data.name
  return typeof name === 'string' ? name : ''
}

/**
 * Kurum başarı belgesini düzenler (DOM-DIL-080, 081, 082; core `planCertificateIssue`): yalnız
 * kaydın geçerli onaylı `passed` kararıyla (aksi 422), karar başına tek geçerli belge (409
 * `certificate_already_issued`). Numara kurum sayacından, kod rastgele üretilir. Başarı 201.
 */
export function issueCertificate(
  ctx: ServiceContext,
  input: { decisionId: string } & Record<string, unknown>,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  const id = randomUUID()
  return runCommand<{ draft: CertificateDraft; scope: EnrollmentContext }>(
    ctx,
    {
      action: 'course_certificate.issue',
      collections: [],
      entity: certificateEntity(id),
      load: async (tx) => {
        const institutionType = await languageSchool(tx, ctx)
        const decision = UUID.test(input.decisionId)
          ? await findProgressionDecision(tx, ctx.institutionId, input.decisionId)
          : null
        if (decision === null) throw new NotFoundError()
        const scope = await enrollmentContext(tx, ctx, decision.enrollmentId)
        const [institution, decisions, certificates, name] = await Promise.all([
          getInstitution(tx, ctx.institutionId),
          listProgressionDecisions(tx, ctx.institutionId, { enrollmentId: scope.stored.id }),
          listEnrollmentCertificates(tx, ctx.institutionId, scope.stored.id),
          learnerName(tx, ctx.institutionId, scope.stored.studentId),
        ])
        if (institution === null) throw new NotFoundError()
        return {
          run: () => ({
            scope,
            draft: planCertificateIssue({
              institutionType,
              enrollment: {
                id: scope.stored.id,
                learnerId: scope.stored.studentId,
                courseId: scope.course.id,
              },
              decisions,
              certificates,
              subject: {
                institutionName: institution.name,
                learnerName: name,
                course: {
                  id: scope.course.id,
                  name: scope.course.name,
                  level: scope.course.level,
                  totalHours: scope.course.totalHours,
                },
              },
              actor: scope.actor,
              input,
              now: ctx.now,
            }),
          }),
        }
      },
      after: async (tx, { draft, scope }) => {
        const serial = await nextCertificateSerial(tx, ctx.institutionId)
        const saved = await insertCertificate(
          tx,
          ctx.institutionId,
          {
            ...draft,
            groupId: scope.group.id,
            serial,
            number: formatCertificateNumber(serial, ctx.now),
            verificationCode: formatVerificationCode(randomBytes(VERIFICATION_CODE_BYTES)),
          },
          id,
        )
        await auditWork(tx, ctx, 'course_certificate.issue', certificateEntity(id), [
          'decisionId',
          'number',
          'verificationCode',
          'content',
          'replacesCertificateId',
        ])
        out.body = { data: staffView(saved) }
      },
    },
    respond(out, 201),
    idempotency,
  )
}

/**
 * Belgeyi gerekçeyle iptal eder (DOM-DIL-082; core `planCertificateCancellation`): yalnız geçerli
 * belge ve bir kez (409 `certificate_already_cancelled`). `If-Match` belgenin satır sürümüdür
 * (tutmazsa 409, rol ve plan denetiminden sonra). Numara ve kod korunur; doğrulama bundan sonra
 * `cancelled` döner.
 */
export function cancelCertificate(
  ctx: ServiceContext,
  command: { certificateId: string; expectedVersion: number; body: { reason: string } },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  return runCommand<{ cancellation: CertificateCancellation }>(
    ctx,
    {
      action: 'course_certificate.cancel',
      collections: [],
      entity: certificateEntity(command.certificateId),
      load: async (tx) => {
        const certificate = UUID.test(command.certificateId)
          ? await findCertificate(tx, ctx.institutionId, command.certificateId)
          : null
        if (certificate === null) throw new NotFoundError()
        const institutionType = await languageSchool(tx, ctx)
        const scope = await enrollmentContext(tx, ctx, certificate.enrollmentId)
        return {
          run: () => {
            const cancellation = planCertificateCancellation({
              institutionType,
              certificate,
              actor: scope.actor,
              input: command.body,
              now: ctx.now,
            })
            // Sürüm denetimi rol/plan denetiminden sonra: yetkisiz çağıran 403 alır, 409 değil.
            if (certificate.rowVersion !== command.expectedVersion) throw new ConflictError()
            return { cancellation }
          },
        }
      },
      after: async (tx, { cancellation }) => {
        const saved = await saveCertificateCancellation(
          tx,
          ctx.institutionId,
          command.certificateId,
          command.expectedVersion,
          cancellation,
          ctx.now,
        )
        if (saved === null) throw new ConflictError()
        await auditWork(tx, ctx, 'course_certificate.cancel', certificateEntity(saved.id), [
          'status',
          'cancelledByUserId',
          'cancelledAt',
          'cancellationReason',
        ])
        out.body = { data: staffView(saved) }
      },
    },
    respond(out, 200),
    idempotency,
  )
}

// --- Okuma --------------------------------------------------------------------------------

export type CertificateListQuery = {
  page: number
  pageSize: number
  status?: CertificateStatus | undefined
  studentId?: string | undefined
  courseId?: string | undefined
}

/**
 * Belge listesi (kurum içi): yönetici bütün belgeleri, öğretmen okuyabildiği grupların belgelerini;
 * öğrenci ve veli yalnız kapsamındaki geçerli belgeleri görür (`status` süzgeci onlarda `valid`).
 */
export async function listCourseCertificates(ctx: ServiceContext, query: CertificateListQuery) {
  const scope = await readScope(ctx)
  const filter = {
    page: query.page,
    pageSize: query.pageSize,
    ...(query.studentId === undefined ? {} : { studentId: query.studentId }),
    ...(query.courseId === undefined ? {} : { courseId: query.courseId }),
  }
  if (scope.kind === 'learner') {
    if (query.status === 'cancelled') return { items: [], total: 0 }
    const { items, total } = await listCertificates(ctx.db, ctx.institutionId, {
      ...filter,
      learnerIds: scope.learnerIds,
      status: 'valid',
    })
    return { items: items.map(learnerView), total }
  }
  const { items, total } = await listCertificates(ctx.db, ctx.institutionId, {
    ...filter,
    ...(scope.kind === 'groups' ? { groupIds: scope.groupIds } : {}),
    ...(query.status === undefined ? {} : { status: query.status }),
  })
  return { items: items.map(staffView), total }
}

/** Belge ayrıntısı; kapsam dışı, başka kurumun ya da kursiyer için iptal edilmiş belge 404. */
export async function getCourseCertificate(ctx: ServiceContext, certificateId: string) {
  const certificate = UUID.test(certificateId)
    ? await findCertificate(ctx.db, ctx.institutionId, certificateId)
    : null
  if (certificate === null) throw new NotFoundError()
  const scope = await readScope(ctx)
  switch (scope.kind) {
    case 'all':
      return staffView(certificate)
    case 'groups':
      if (!scope.groupIds.includes(certificate.groupId)) throw new NotFoundError()
      return staffView(certificate)
    case 'learner':
      if (certificate.status !== 'valid' || !scope.learnerIds.includes(certificate.learnerId))
        throw new NotFoundError()
      return learnerView(certificate)
    default:
      return scope satisfies never
  }
}

/**
 * Kimliksiz doğrulama (DOM-DIL-082, Sabah kararı 85): kod belgeyi bulur, kurum kimliği okunmaz.
 * Biçimi bozuk ve bulunamayan kod aynı 404'tür. Yanıt yalnız baş harf, kur, gün, durum ve kurum
 * adıdır (core `certificateVerificationView`).
 */
export async function verifyCertificate(
  db: Database,
  code: string,
): Promise<CertificateVerification> {
  const normalized = normalizeVerificationCode(code)
  const certificate = normalized === null ? null : await findCertificateByCode(db, normalized)
  if (certificate === null) throw new NotFoundError()
  return certificateVerificationView(certificate)
}

// --- MEBBİS izi (DOM-DIL-080) -------------------------------------------------------------

function mebbisView(record: MebbisRecord) {
  return {
    id: record.id,
    decisionId: record.decisionId,
    certificateNumber: record.certificateNumber,
    issuedDate: record.issuedDate,
    recordedByUserId: record.recordedByUserId,
    recordedAt: record.recordedAt,
  }
}

/**
 * Grubun MEBBİS listesi (DOM-DIL-080): belgeye hak kazanan kursiyerler (geçerli karar onaylı
 * `passed`; devamsızlık ve tekrar listeye girmez) ve MEBBİS izi. Personel; grubu okuyamayan
 * öğretmen 404.
 */
export async function getGroupMebbisList(ctx: ServiceContext, groupId: string) {
  if (!UUID.test(groupId)) throw new NotFoundError()
  const scope = await groupContext(ctx.db, ctx, groupId)
  const enrollments = await listGroupEnrollments(ctx.db, ctx.institutionId, groupId)
  const ids = enrollments.map((item) => item.id)
  const [decisions, records] = await Promise.all([
    listProgressionDecisions(ctx.db, ctx.institutionId, { enrollmentIds: ids }),
    listMebbisRecords(ctx.db, ctx.institutionId, ids),
  ])
  const recordOf = new Map(records.map((record) => [record.decisionId, record]))
  const learners = enrollments.flatMap((stored) => {
    const decisionId = mebbisEligibleDecisionId(
      decisions.filter((row) => row.enrollmentId === stored.id),
    )
    if (decisionId === null) return []
    const record = recordOf.get(decisionId)
    return [
      {
        enrollmentId: stored.id,
        studentId: stored.studentId,
        decisionId,
        record: record === undefined ? null : mebbisView(record),
      },
    ]
  })
  return {
    groupId,
    courseId: scope.course.id,
    canRecord: ctx.actor.role === 'yonetici' || scope.actor.coordinator === true,
    learners,
  }
}

/**
 * MEBBİS'te düzenlenen Kurs Bitirme Belgesini işaretler (DOM-DIL-080; core `planMebbisRecord`):
 * belge no, tarih ve işleyen. Yalnız belgeye hak kazanan kayıt (422); karar başına bir iz (409
 * `mebbis_already_recorded`). Başarı 201.
 */
export function recordMebbisCertificate(
  ctx: ServiceContext,
  command: { decisionId: string; body: Record<string, unknown> },
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  const id = randomUUID()
  return runCommand<{ draft: MebbisRecordDraft; scope: EnrollmentContext }>(
    ctx,
    {
      action: 'mebbis_certificate.record',
      collections: [],
      entity: mebbisEntity(id),
      load: async (tx) => {
        const institutionType = await languageSchool(tx, ctx)
        const decision = UUID.test(command.decisionId)
          ? await findProgressionDecision(tx, ctx.institutionId, command.decisionId)
          : null
        if (decision === null) throw new NotFoundError()
        const scope = await enrollmentContext(tx, ctx, decision.enrollmentId)
        const [decisions, existing] = await Promise.all([
          listProgressionDecisions(tx, ctx.institutionId, { enrollmentId: scope.stored.id }),
          listMebbisRecords(tx, ctx.institutionId, [scope.stored.id]),
        ])
        return {
          run: () => ({
            scope,
            draft: planMebbisRecord({
              institutionType,
              enrollment: { id: scope.stored.id, learnerId: scope.stored.studentId },
              decisions,
              decisionId: decision.id,
              existing,
              actor: scope.actor,
              input: command.body,
              now: ctx.now,
            }),
          }),
        }
      },
      after: async (tx, { draft, scope }) => {
        const saved = await insertMebbisRecord(
          tx,
          ctx.institutionId,
          { ...draft, groupId: scope.group.id },
          id,
        )
        await auditWork(tx, ctx, 'mebbis_certificate.record', mebbisEntity(id), [
          'decisionId',
          'certificateNumber',
          'issuedDate',
        ])
        out.body = { data: { enrollmentId: saved.enrollmentId, ...mebbisView(saved) } }
      },
    },
    respond(out, 201),
    idempotency,
  )
}
