import { randomUUID } from 'node:crypto'

import { isCalendarDay } from '@kampus/school-core/lib/age.ts'
import { hasValidConsent } from '@kampus/school-core/lib/consents.ts'
import { tripPlanNumber } from '@kampus/school-core/lib/finance-trip-plans.ts'
import {
  assertTripReportDecision,
  assertTripReportIncidents,
  assertTripReportPhotoRemove,
  assertTripReportSubmit,
  isTripEvaluationOpen,
  isTripFinished,
  planTripEvaluation,
  planTripReportCreate,
  planTripReportPhoto,
  planTripReportUpdate,
  TRIP_REPORT_EDITABLE_STATUSES,
  tripAttendance,
  tripEvaluationClosesAt,
  tripEvaluationSchema,
  tripEvaluationSummary,
  tripReportAccess,
  tripReportCreateSchema,
  tripReportPhotoSchema,
  tripReportPhotoUpdateSchema,
  tripReportPhotoVisibility,
  tripReportReturnSchema,
  tripReportTransitionSchema,
  tripReportUpdateSchema,
  type TripAttendance,
  type TripReportAccess,
  type TripReportPhotoState,
  type TripReportStatus,
} from '@kampus/school-core/lib/finance-trip-reports.ts'

import type { Database } from '../db/client.ts'
import { activeParticipants } from '../db/finance-paid-activities.ts'
import {
  loadStudentTripDayMarks,
  loadTripDayChecks,
  loadTripDayMarks,
  loadTripDayMembers,
} from '../db/finance-trip-day.ts'
import { findTripPlan, loadTripPlanStaff, type StoredTripPlan } from '../db/finance-trip-plans.ts'
import {
  archiveReportPhoto,
  countPlanEvaluations,
  findIncidentFacts,
  findTripReport,
  insertReportPhoto,
  insertTripEvaluation,
  insertTripReport,
  listIncidentsBetween,
  listTripReportRows,
  loadMembershipEvaluations,
  loadPlanEvaluations,
  loadReportIncidentIds,
  loadReportPhotos,
  loadStudentBirthDates,
  loadStudentConsents,
  nextReportPhotoPosition,
  replacePhotoTags,
  replaceReportIncidents,
  reportUserNames,
  TRIP_REPORT_ATTACHMENT,
  updateReportPhoto,
  updateTripReport,
  type StoredReportPhoto,
  type StoredTripReport,
  type TripReportChangesRow,
  type TripReportListQuery,
} from '../db/finance-trip-reports.ts'
import { listPrivacyNotices } from '../db/privacy.ts'
import { loadRecords, loadRecordsByIds } from '../db/records.ts'
import { AppError, ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile, detachFile, getFileUrl } from './files.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { readScope } from './read-scope.ts'
import { auditWork } from './task-work.ts'

/**
 * Gezi sonrası rapor, rızalı fotoğraf ve katılımcı değerlendirmesi (DOM-FIN-158; ON-158;
 * K-529…K-531; IST-017). Kural core `lib/finance-trip-reports.ts`'tedir; servis kurum kilidi altında
 * yükler, tek transaction'da yazar ve denetime yalnız alan adlarını yazar (metin, yorum, gerekçe ve
 * öğrenci kimliği yazılmaz). Katılım gezi günü yoklamasından (DOM-FIN-154) okunur. Fotoğraflar
 * platform dosyalarıdır (bağ türü `trip_report`); yayım saklanmaz, her okumada etiketli öğrencilerin
 * `photo_video_sharing` rızasından hesaplanır (`hasValidConsent`, DOM-YTK-061): geri çekilen rıza
 * fotoğrafı bir sonraki okumada yayından düşürür. Dosya bağlantısı yalnız bu servisin o istekte
 * okunabilir bulduğu dosyalara üretilir; genel `GET /files/:id/url` 404 alır.
 */

const REPORT = 'trip_reports'
const PHOTO = 'trip_report_photos'
const EVALUATION = 'trip_evaluations'
const PHOTO_PURPOSE = 'photo_video_sharing' as const
/** Etiket seçenekleri listesinin üst sınırı (ada göre). */
const OPTIONS_MAX = 500
/** Aile görünümü dönüşü bu kadar gün içindeki gezileri listeler. */
const FAMILY_DAYS = 365
const DAY_MS = 86_400_000

/** Bu istekte bağlantısı üretilebilecek fotoğraf dosyaları (servisin okuma kararı). */
const photoGrants = new WeakMap<ServiceContext, Set<string>>()

defineFileAttachment(TRIP_REPORT_ATTACHMENT, {
  purposes: ['question_image'],
  canRead: async (_tx, ctx, _reportId, file) => photoGrants.get(ctx)?.has(file.id) === true,
})

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null
const iso = (value: Date | null) => (value === null ? null : value.toISOString())

// --- Yükleme -------------------------------------------------------------------------------------

async function studentFacts(db: Database, ctx: ServiceContext, ids: readonly string[]) {
  const rows = await loadRecordsByIds(db, ctx.institutionId, 'students', [...new Set(ids)], {
    includeArchived: true,
  })
  const classIds = rows.flatMap((row) => {
    const id = text(row.data.classId)
    return id === null ? [] : [id]
  })
  const classes = await loadRecordsByIds(db, ctx.institutionId, 'classes', [...new Set(classIds)], {
    includeArchived: true,
  })
  const classNames = new Map(classes.map((row) => [row.id, text(row.data.name)]))
  return new Map(
    rows.map((row) => {
      const classId = text(row.data.classId)
      return [
        row.id,
        {
          name: text(row.data.name) ?? '—',
          className: classId === null ? null : (classNames.get(classId) ?? null),
          birthDate: text(row.data.birthDate),
        },
      ] as const
    }),
  )
}

/**
 * Etiketli öğrencilerin geçerli fotoğraf rızası (IST-017, DOM-YTK-061): okuma anında core
 * `hasValidConsent`; doğum tarihi kimlik tablosundan, yoksa öğrenci kaydından (rıza servisiyle aynı).
 */
async function consentOf(
  db: Database,
  ctx: ServiceContext,
  studentIds: readonly string[],
  facts: ReadonlyMap<string, { birthDate: string | null }>,
): Promise<Map<string, boolean>> {
  const ids = [...new Set(studentIds)]
  if (ids.length === 0) return new Map()
  const [rows, texts, births] = await Promise.all([
    loadStudentConsents(db, ctx.institutionId, ids, PHOTO_PURPOSE),
    listPrivacyNotices(db, ctx.institutionId),
    loadStudentBirthDates(db, ctx.institutionId, ids),
  ])
  const now = ctx.now.toISOString()
  return new Map(
    ids.map((id) => {
      const birthDate = births.get(id) ?? facts.get(id)?.birthDate ?? null
      const student = {
        id,
        birthDate: birthDate !== null && isCalendarDay(birthDate) ? birthDate : null,
      }
      return [
        id,
        hasValidConsent(
          rows.get(id) ?? [],
          { purpose: PHOTO_PURPOSE, subject: { kind: 'student', student }, texts },
          now,
        ),
      ] as const
    }),
  )
}

/** Gezi günü listesi ve kapanan turların işaretleri (DOM-FIN-154). */
async function tripDayFacts(db: Database, ctx: ServiceContext, planId: string) {
  const [members, checks] = await Promise.all([
    loadTripDayMembers(db, ctx.institutionId, planId),
    loadTripDayChecks(db, ctx.institutionId, planId),
  ])
  const closed = checks.filter((check) => check.status !== 'open').map((check) => check.id)
  const marks = await loadTripDayMarks(db, ctx.institutionId, closed)
  return {
    members: members.map((member) => member.studentId),
    closedMarks: marks.map((mark) => ({ studentId: mark.studentId, status: mark.status })),
  }
}

/**
 * Gezinin katılımcıları (etiket için): bağlı etkinlikte asil katılımlar, etkinliksiz planda kurumun
 * etkin öğrencileri; gezi günü listesindeki öğrenciler de katılımcıdır (DOM-FIN-154 ile aynı).
 */
async function participantsOf(
  db: Database,
  ctx: ServiceContext,
  plan: StoredTripPlan,
  roster: readonly string[],
): Promise<{ all: Set<string>; options: string[] }> {
  const eligible =
    plan.paidActivityId !== null
      ? (await activeParticipants(db, ctx.institutionId, plan.paidActivityId)).map(
          (row) => row.studentId,
        )
      : (await loadRecords(db, ctx.institutionId, ['students']))
          .filter((row) => row.data.isActive !== false)
          .map((row) => row.id)
  const all = new Set([...eligible, ...roster])
  // Seçenekler önce gezi günü listesidir; liste yoksa bütün katılımcılar.
  return { all, options: roster.length > 0 ? [...new Set(roster)] : eligible }
}

interface ReportState {
  plan: StoredTripPlan
  staffIds: string[]
  access: TripReportAccess
  report: StoredTripReport | null
}

/** Plan, görevliler, yetki ve rapor; plan yoksa ya da rol göremiyorsa 404 (K-529). */
async function loadState(db: Database, ctx: ServiceContext, planId: string): Promise<ReportState> {
  const plan = await findTripPlan(db, ctx.institutionId, planId)
  if (plan === null) throw new NotFoundError()
  const staff = await loadTripPlanStaff(db, ctx.institutionId, [planId])
  const staffIds = (staff.get(planId) ?? []).map((row) => row.membershipId)
  const access = tripReportAccess(ctx.actor, staffIds)
  if (!access.read) throw new NotFoundError()
  return { plan, staffIds, access, report: await findTripReport(db, ctx.institutionId, planId) }
}

const editable = (status: TripReportStatus) =>
  (TRIP_REPORT_EDITABLE_STATUSES as readonly string[]).includes(status)

/** Dondurulmuş (gönderilmiş, onaylanmış) ya da canlı katılım. */
function attendanceOf(report: StoredTripReport | null, live: TripAttendance) {
  if (
    report !== null &&
    !editable(report.status) &&
    report.attendanceSource !== null &&
    report.rosterCount !== null &&
    report.attendedCount !== null &&
    report.absentCount !== null
  )
    return {
      source: report.attendanceSource,
      rosterCount: report.rosterCount,
      attendedCount: report.attendedCount,
      absentCount: report.absentCount,
      frozen: true,
    }
  return { ...live, frozen: false }
}

interface PhotoView {
  id: string
  fileId: string
  caption: string | null
  noStudentsVisible: boolean
  shareWithFamilies: boolean
  position: number
  contentType: string
  byteSize: number
  students: { studentId: string; studentName: string; consent: boolean }[]
  visibility: ReturnType<typeof tripReportPhotoVisibility>
  url: string | null
  expiresAt: string | null
  version: number
}

/**
 * İmzalı bağlantılar (yalnız `storage` verilince; transaction dışında, PGlite tek bağlantılıdır).
 * Dosya artık açılamıyorsa (imha, işleniyor, hazır değil) bağlantı boş döner.
 */
async function signPhotos(
  ctx: ServiceContext,
  storage: StorageDriver | null,
  photos: PhotoView[],
): Promise<PhotoView[]> {
  if (storage === null || photos.length === 0) return photos
  const grants = photoGrants.get(ctx) ?? new Set<string>()
  for (const photo of photos) grants.add(photo.fileId)
  photoGrants.set(ctx, grants)
  const signed: PhotoView[] = []
  for (const photo of photos) {
    try {
      const link = await getFileUrl(ctx, storage, photo.fileId)
      signed.push({ ...photo, url: link.url, expiresAt: link.expiresAt })
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      ctx.log.info({ event: 'finance.trip_report.photo_unavailable', code: error.code })
      signed.push(photo)
    }
  }
  return signed
}

function photoViews(
  photos: readonly StoredReportPhoto[],
  status: TripReportStatus,
  facts: ReadonlyMap<string, { name: string }>,
  consent: ReadonlyMap<string, boolean>,
): PhotoView[] {
  return photos.map((photo) => {
    const students = photo.studentIds
      .map((studentId) => ({
        studentId,
        studentName: facts.get(studentId)?.name ?? '—',
        consent: consent.get(studentId) === true,
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr'))
    return {
      id: photo.id,
      fileId: photo.fileId,
      caption: photo.caption,
      noStudentsVisible: photo.noStudentsVisible,
      shareWithFamilies: photo.shareWithFamilies,
      position: photo.position,
      contentType: photo.contentType,
      byteSize: photo.byteSize,
      students,
      visibility: tripReportPhotoVisibility({
        reportStatus: status,
        shareWithFamilies: photo.shareWithFamilies,
        tags: students,
      }),
      url: null,
      expiresAt: null,
      version: photo.version,
    }
  })
}

async function reportDetail(db: Database, ctx: ServiceContext, planId: string) {
  const { plan, access, report } = await loadState(db, ctx, planId)
  const finished = isTripFinished(plan, ctx.now)
  const [day, incidentIds, photoMap, evaluations] = await Promise.all([
    tripDayFacts(db, ctx, planId),
    report === null ? Promise.resolve([]) : loadReportIncidentIds(db, ctx.institutionId, report.id),
    report === null
      ? Promise.resolve(new Map<string, StoredReportPhoto[]>())
      : loadReportPhotos(db, ctx.institutionId, [report.id]),
    loadPlanEvaluations(db, ctx.institutionId, planId),
  ])
  const live = tripAttendance(day)
  const photos = report === null ? [] : (photoMap.get(report.id) ?? [])
  const canWrite = access.write && finished && (report === null || editable(report.status))
  const attended = new Set(
    day.closedMarks.filter((mark) => mark.status === 'present').map((mark) => mark.studentId),
  )
  const participants = canWrite
    ? await participantsOf(db, ctx, plan, [
        ...day.members,
        ...day.closedMarks.map((m) => m.studentId),
      ])
    : { all: new Set<string>(), options: [] }
  const options = participants.options.slice(0, OPTIONS_MAX)
  const tagged = photos.flatMap((photo) => photo.studentIds)
  const facts = await studentFacts(db, ctx, [...tagged, ...options])
  const [consent, incidents, incidentOptions, names] = await Promise.all([
    consentOf(db, ctx, [...tagged, ...options], facts),
    findIncidentFacts(db, ctx.institutionId, incidentIds),
    canWrite
      ? listIncidentsBetween(
          db,
          ctx.institutionId,
          new Date(plan.departureAt),
          new Date(plan.returnAt),
        )
      : Promise.resolve([]),
    reportUserNames(db, [
      report?.createdByUserId ?? null,
      report?.submittedByUserId ?? null,
      report?.decidedByUserId ?? null,
    ]),
  ])
  const nameOf = (id: string | null | undefined) =>
    id === null || id === undefined ? null : (names.get(id) ?? null)
  return {
    plan: {
      id: plan.id,
      number: tripPlanNumber(plan.sequence),
      name: plan.name,
      status: plan.status,
      departureAt: plan.departureAt,
      returnAt: plan.returnAt,
    },
    tripFinished: finished,
    canCreate: report === null && access.write && finished && plan.status !== 'cancelled',
    report:
      report === null
        ? null
        : {
            id: report.id,
            status: report.status,
            summary: report.summary,
            incidentNote: report.incidentNote,
            outcomeNote: report.outcomeNote,
            incidents: incidentIds.flatMap((id) => {
              const found = incidents.get(id)
              return found === undefined ? [] : [found]
            }),
            createdByName: nameOf(report.createdByUserId),
            createdAt: report.createdAt.toISOString(),
            submittedAt: iso(report.submittedAt),
            submittedByName: nameOf(report.submittedByUserId),
            decidedAt: iso(report.decidedAt),
            decidedByName: nameOf(report.decidedByUserId),
            returnReason: report.returnReason,
            canEdit: access.write && editable(report.status),
            canDecide: access.decide && report.status === 'submitted',
            version: report.version,
            photos: photoViews(photos, report.status, facts, consent),
          },
    attendance: attendanceOf(report, live),
    evaluations: tripEvaluationSummary(evaluations),
    options: canWrite
      ? {
          students: options
            .map((studentId) => ({
              studentId,
              studentName: facts.get(studentId)?.name ?? '—',
              className: facts.get(studentId)?.className ?? null,
              attended: live.source === 'none' ? null : attended.has(studentId),
              consent: consent.get(studentId) === true,
            }))
            .sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr')),
          studentTotal: participants.options.length,
          incidents: incidentOptions,
        }
      : null,
  }
}

/** Rapor görünümü; `storage` verilirse fotoğrafların imzalı bağlantısıyla. */
export async function getTripReportFor(
  ctx: ServiceContext,
  planId: string,
  storage: StorageDriver | null,
) {
  const view = await reportDetail(ctx.db, ctx, planId)
  if (view.report === null) return view
  return {
    ...view,
    report: { ...view.report, photos: await signPhotos(ctx, storage, view.report.photos) },
  }
}

// --- Liste ---------------------------------------------------------------------------------------

/**
 * Biten gezilerin rapor listesi (K-529): yönetici ve ön büro bütün planlar, öğretmen yalnız görevlisi
 * olduğu planlar. Raporu açılmamış gezi `missing` durumundadır.
 */
export async function listTripReportsFor(
  ctx: ServiceContext,
  query: Omit<TripReportListQuery, 'now' | 'staffMembershipId'>,
) {
  const { items, total } = await listTripReportRows(ctx.db, ctx.institutionId, {
    ...query,
    now: ctx.now,
    ...(ctx.actor.role === 'ogretmen' ? { staffMembershipId: ctx.actor.membershipId } : {}),
  })
  const planIds = items.map((row) => row.planId)
  const reportIds = items.flatMap((row) => (row.reportId === null ? [] : [row.reportId]))
  const [responses, photos] = await Promise.all([
    countPlanEvaluations(ctx.db, ctx.institutionId, planIds),
    loadReportPhotos(ctx.db, ctx.institutionId, reportIds),
  ])
  return {
    items: items.map((row) => ({
      planId: row.planId,
      planNumber: tripPlanNumber(row.planSequence),
      planName: row.planName,
      planStatus: row.planStatus,
      departureAt: row.departureAt.toISOString(),
      returnAt: row.returnAt.toISOString(),
      reportId: row.reportId,
      status: row.reportStatus ?? ('missing' as const),
      authorName: row.reportId === null ? null : row.authorName,
      submittedAt: iso(row.submittedAt),
      decidedAt: iso(row.decidedAt),
      photoCount: row.reportId === null ? 0 : (photos.get(row.reportId)?.length ?? 0),
      responseCount: responses.get(row.planId) ?? 0,
    })),
    total,
  }
}

// --- Aile ----------------------------------------------------------------------------------------

/**
 * Aile görünümü (K-530, K-531): kapsamdaki öğrencilerin (veli için bağlı çocuklar) katıldığı
 * (kapanan turda "var"), dönüşü son bir yıl içindeki biten geziler; onaylı raporun yayımlanmış
 * fotoğrafları (yayım okuma anında, rızası olmayan öğrencinin göründüğü fotoğraf yok) ve
 * değerlendirme durumu. Rapor metni, katılım sayısı ve başka ailelerin yanıtları dönmez.
 */
export async function listMyTripReportsFor(ctx: ServiceContext, storage: StorageDriver | null) {
  const scope = await readScope(ctx)
  const studentIds = [...scope.studentIds]
  if (studentIds.length === 0) return []
  const marks = await loadStudentTripDayMarks(ctx.db, ctx.institutionId, studentIds)
  const since = ctx.now.getTime() - FAMILY_DAYS * DAY_MS
  const plans = new Map<
    string,
    { planId: string; planName: string; departureAt: Date; returnAt: Date; students: Set<string> }
  >()
  for (const mark of marks) {
    if (mark.status !== 'present') continue
    const facts = { status: mark.planStatus, returnAt: mark.returnAt.toISOString() }
    if (!isTripFinished(facts, ctx.now) || mark.returnAt.getTime() < since) continue
    const row = plans.get(mark.planId) ?? {
      planId: mark.planId,
      planName: mark.planName,
      departureAt: mark.departureAt,
      returnAt: mark.returnAt,
      students: new Set<string>(),
    }
    row.students.add(mark.studentId)
    plans.set(mark.planId, row)
  }
  const list = [...plans.values()].sort((a, b) => b.returnAt.getTime() - a.returnAt.getTime())
  const planIds = list.map((row) => row.planId)
  const [reports, mine, kids] = await Promise.all([
    Promise.all(planIds.map((id) => findTripReport(ctx.db, ctx.institutionId, id))),
    loadMembershipEvaluations(ctx.db, ctx.institutionId, ctx.actor.membershipId, planIds),
    studentFacts(ctx.db, ctx, studentIds),
  ])
  const approved = reports.filter(
    (report): report is StoredTripReport => report?.status === 'approved',
  )
  const photoMap = await loadReportPhotos(
    ctx.db,
    ctx.institutionId,
    approved.map((report) => report.id),
  )
  const tagged = [...photoMap.values()].flatMap((photos) => photos.flatMap((p) => p.studentIds))
  const tagFacts = await studentFacts(ctx.db, ctx, tagged)
  const consent = await consentOf(ctx.db, ctx, tagged, tagFacts)
  const rows = []
  for (const [index, row] of list.entries()) {
    const report = reports[index] ?? null
    const published =
      report?.status === 'approved'
        ? photoViews(photoMap.get(report.id) ?? [], 'approved', tagFacts, consent).filter(
            (photo) => photo.visibility === 'published',
          )
        : []
    const signed = await signPhotos(ctx, storage, published)
    const own = mine.find((evaluation) => evaluation.planId === row.planId) ?? null
    const returnAt = row.returnAt.toISOString()
    const open = isTripEvaluationOpen(
      { status: marks.find((m) => m.planId === row.planId)?.planStatus ?? 'approved', returnAt },
      ctx.now,
    )
    rows.push({
      planId: row.planId,
      planName: row.planName,
      departureAt: row.departureAt.toISOString(),
      returnAt,
      students: [...row.students]
        .map((studentId) => ({ studentId, studentName: kids.get(studentId)?.name ?? '—' }))
        .sort((a, b) => a.studentName.localeCompare(b.studentName, 'tr')),
      reportApproved: report?.status === 'approved',
      // Aileye yalnız görüntü ve açıklama gider; etiket (öğrenci adları) ve rıza durumu gitmez.
      photos: signed.map((photo) => ({
        id: photo.id,
        caption: photo.caption,
        contentType: photo.contentType,
        url: photo.url,
        expiresAt: photo.expiresAt,
      })),
      evaluation: {
        open: open && own === null,
        closesAt: tripEvaluationClosesAt(returnAt),
        mine:
          own === null
            ? null
            : {
                studentId: own.studentId,
                score: own.score,
                comment: own.comment,
                createdAt: own.createdAt.toISOString(),
              },
      },
    })
  }
  return rows
}

// --- Komutlar ------------------------------------------------------------------------------------

const respondWith = (statusCode: number, body: () => unknown) => () => ({
  statusCode,
  body: body(),
})

/** Rapor açma (K-529). `Idempotency-Key` zorunlu; 201 ve rapor görünümü. */
export function createTripReportCommand(
  ctx: ServiceContext,
  planId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: REPORT, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.trip_report.create',
      collections: [],
      entity,
      load: async (tx) => {
        const fields = tripReportCreateSchema.parse(input)
        const state = await loadState(tx, ctx, planId)
        const found = await findIncidentFacts(tx, ctx.institutionId, fields.incidentIds)
        return {
          run: () => {
            planTripReportCreate({
              access: state.access,
              plan: state.plan,
              exists: state.report !== null,
              now: ctx.now,
            })
            assertTripReportIncidents(fields.incidentIds, found, state.plan)
            return fields
          },
        }
      },
      after: async (tx, fields) => {
        await insertTripReport(tx, ctx.institutionId, {
          id,
          planId,
          summary: fields.summary,
          incidentNote: fields.incidentNote,
          outcomeNote: fields.outcomeNote,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await replaceReportIncidents(tx, ctx.institutionId, {
          reportId: id,
          incidentIds: fields.incidentIds,
          now: ctx.now,
          ids: randomUUID,
        })
        await auditWork(tx, ctx, 'finance.trip_report.create', entity, [
          'planId',
          ...(['summary', 'incidentNote', 'outcomeNote'] as const).filter(
            (key) => fields[key] !== null,
          ),
          ...(fields.incidentIds.length > 0 ? ['incidentIds'] : []),
        ])
        body = { data: await reportDetail(tx, ctx, planId) }
      },
    },
    respondWith(201, () => body),
    idempotency,
  )
}

/** Raporu yükler; yoksa 404, sürüm tutmazsa 409 (yetki denetiminden sonra). */
async function reportFor(tx: Database, ctx: ServiceContext, planId: string, version: number) {
  const state = await loadState(tx, ctx, planId)
  const report = state.report
  if (report === null) throw new NotFoundError()
  if (report.version !== version) throw new ConflictError()
  return { ...state, report }
}

/** Rapor düzeltme (K-529): `If-Match` raporun sürümüdür; yalnız değişen alanlar yazılır. */
export function updateTripReportCommand(
  ctx: ServiceContext,
  planId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  let body: unknown
  let reportId = ''
  return runCommand(
    ctx,
    {
      action: 'finance.trip_report.update',
      collections: [],
      entity: { type: REPORT, id: planId },
      load: async (tx) => {
        const changes = tripReportUpdateSchema.parse(input)
        const { report, plan, access } = await reportFor(tx, ctx, planId, expectedVersion)
        reportId = report.id
        const [incidentIds, found] = await Promise.all([
          loadReportIncidentIds(tx, ctx.institutionId, report.id),
          findIncidentFacts(tx, ctx.institutionId, changes.incidentIds ?? []),
        ])
        return {
          run: () => {
            const changed = planTripReportUpdate(changes, { ...report, incidentIds }, access)
            if (changes.incidentIds !== undefined)
              assertTripReportIncidents(changes.incidentIds, found, plan)
            return { changes, changed, report }
          },
        }
      },
      after: async (tx, { changes, changed, report }) => {
        const row: TripReportChangesRow = {}
        if (changed.includes('summary')) row.summary = changes.summary ?? null
        if (changed.includes('incidentNote')) row.incidentNote = changes.incidentNote ?? null
        if (changed.includes('outcomeNote')) row.outcomeNote = changes.outcomeNote ?? null
        if (
          !(await updateTripReport(tx, ctx.institutionId, {
            id: report.id,
            expectedVersion,
            changes: row,
            now: ctx.now,
          }))
        )
          throw new ConflictError()
        if (changed.includes('incidentIds'))
          await replaceReportIncidents(tx, ctx.institutionId, {
            reportId: report.id,
            incidentIds: changes.incidentIds ?? [],
            now: ctx.now,
            ids: randomUUID,
          })
        await auditWork(
          tx,
          ctx,
          'finance.trip_report.update',
          { type: REPORT, id: reportId },
          changed,
        )
        body = { data: await reportDetail(tx, ctx, planId) }
      },
    },
    respondWith(200, () => body),
    idempotency,
  )
}

type Transition = 'submit' | 'approve' | 'return'

/**
 * Gönderme, onay ve iade (K-529): gönderimde katılım gezi günü yoklamasından dondurulur ve önceki
 * iade gerekçesi düşer; onay ve iade yalnız yöneticidedir, iade gerekçe ister. `If-Match` raporun
 * sürümüdür.
 */
export function transitionTripReportCommand(
  ctx: ServiceContext,
  planId: string,
  transition: Transition,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const action = `finance.trip_report.${transition}`
  let body: unknown
  return runCommand(
    ctx,
    {
      action,
      collections: [],
      entity: { type: REPORT, id: planId },
      load: async (tx) => {
        const reason = transition === 'return' ? tripReportReturnSchema.parse(input).reason : null
        if (transition !== 'return') tripReportTransitionSchema.parse(input)
        const { report, access } = await reportFor(tx, ctx, planId, expectedVersion)
        const [incidentIds, day] = await Promise.all([
          loadReportIncidentIds(tx, ctx.institutionId, report.id),
          transition === 'submit' ? tripDayFacts(tx, ctx, planId) : Promise.resolve(null),
        ])
        return {
          run: (): {
            report: StoredTripReport
            changes: TripReportChangesRow
            fields: string[]
          } => {
            if (transition === 'submit') {
              assertTripReportSubmit({ ...report, incidentIds }, access)
              const attendance = tripAttendance(day ?? { members: [], closedMarks: [] })
              return {
                report,
                changes: {
                  status: 'submitted',
                  submittedAt: ctx.now,
                  submittedByUserId: ctx.actor.userId,
                  attendanceSource: attendance.source,
                  rosterCount: attendance.rosterCount,
                  attendedCount: attendance.attendedCount,
                  absentCount: attendance.absentCount,
                  returnReason: null,
                },
                fields: ['status', 'submittedAt', 'attendedCount', 'absentCount'],
              }
            }
            assertTripReportDecision(access, report.status)
            return {
              report,
              changes: {
                status: transition === 'approve' ? 'approved' : 'returned',
                decidedAt: ctx.now,
                decidedByUserId: ctx.actor.userId,
                returnReason: reason,
              },
              fields:
                transition === 'approve'
                  ? ['status', 'decidedAt']
                  : ['status', 'decidedAt', 'returnReason'],
            }
          },
        }
      },
      after: async (tx, { report, changes, fields }) => {
        if (
          !(await updateTripReport(tx, ctx.institutionId, {
            id: report.id,
            expectedVersion,
            changes,
            now: ctx.now,
          }))
        )
          throw new ConflictError()
        await auditWork(tx, ctx, action, { type: REPORT, id: report.id }, fields)
        body = { data: await reportDetail(tx, ctx, planId) }
      },
    },
    respondWith(200, () => body),
    idempotency,
  )
}

/** Fotoğraf ekleme (K-530): yüklenmiş dosya rapora bağlanır; `Idempotency-Key` zorunlu; 201. */
export function addTripReportPhotoCommand(
  ctx: ServiceContext,
  planId: string,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: PHOTO, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.trip_report.photo_add',
      collections: [],
      entity,
      load: async (tx) => {
        const fields = tripReportPhotoSchema.parse(input)
        const state = await loadState(tx, ctx, planId)
        const report = state.report
        if (report === null) throw new NotFoundError()
        const [photos, day] = await Promise.all([
          loadReportPhotos(tx, ctx.institutionId, [report.id]),
          tripDayFacts(tx, ctx, planId),
        ])
        const participants = await participantsOf(tx, ctx, state.plan, [
          ...day.members,
          ...day.closedMarks.map((mark) => mark.studentId),
        ])
        return {
          run: () => {
            planTripReportPhoto(fields, {
              access: state.access,
              status: report.status,
              participants: participants.all,
              photoCount: photos.get(report.id)?.length ?? 0,
              mode: 'create',
            })
            return { fields, report }
          },
        }
      },
      after: async (tx, { fields, report }) => {
        await attachFile(tx, ctx, {
          fileId: fields.fileId,
          attachedType: TRIP_REPORT_ATTACHMENT,
          attachedId: report.id,
          dataSubjectId: null,
        })
        await insertReportPhoto(tx, ctx.institutionId, {
          id,
          reportId: report.id,
          fileId: fields.fileId,
          caption: fields.caption,
          noStudentsVisible: fields.noStudentsVisible,
          shareWithFamilies: fields.shareWithFamilies,
          position: await nextReportPhotoPosition(tx, ctx.institutionId, report.id),
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        await replacePhotoTags(tx, ctx.institutionId, {
          reportId: report.id,
          photoId: id,
          studentIds: fields.studentIds,
          current: [],
          now: ctx.now,
          ids: randomUUID,
        })
        await auditWork(tx, ctx, 'finance.trip_report.photo_add', entity, [
          'reportId',
          'fileId',
          'studentIds',
          'noStudentsVisible',
          'shareWithFamilies',
          ...(fields.caption === null ? [] : ['caption']),
        ])
        body = { data: await reportDetail(tx, ctx, planId) }
      },
    },
    respondWith(201, () => body),
    idempotency,
  )
}

async function photoFor(
  tx: Database,
  ctx: ServiceContext,
  planId: string,
  photoId: string,
  version: number,
) {
  const state = await loadState(tx, ctx, planId)
  const report = state.report
  if (report === null) throw new NotFoundError()
  const photos = (await loadReportPhotos(tx, ctx.institutionId, [report.id])).get(report.id) ?? []
  const photo = photos.find((row) => row.id === photoId)
  if (photo === undefined) throw new NotFoundError()
  if (photo.version !== version) throw new ConflictError()
  return { ...state, report, photo }
}

/** Fotoğraf düzeltme (K-530): etiket, açıklama, "öğrenci görünmüyor" ve yayım isteği; `If-Match`. */
export function updateTripReportPhotoCommand(
  ctx: ServiceContext,
  planId: string,
  photoId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PHOTO, id: photoId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.trip_report.photo_update',
      collections: [],
      entity,
      load: async (tx) => {
        const changes = tripReportPhotoUpdateSchema.parse(input)
        const { plan, access, report, photo } = await photoFor(
          tx,
          ctx,
          planId,
          photoId,
          expectedVersion,
        )
        const day = await tripDayFacts(tx, ctx, planId)
        const participants = await participantsOf(tx, ctx, plan, [
          ...day.members,
          ...day.closedMarks.map((mark) => mark.studentId),
        ])
        const current: TripReportPhotoState = {
          caption: photo.caption,
          studentIds: photo.studentIds,
          noStudentsVisible: photo.noStudentsVisible,
          shareWithFamilies: photo.shareWithFamilies,
        }
        const next: TripReportPhotoState = {
          caption: changes.caption === undefined ? current.caption : changes.caption,
          studentIds: changes.studentIds ?? current.studentIds,
          noStudentsVisible: changes.noStudentsVisible ?? current.noStudentsVisible,
          shareWithFamilies: changes.shareWithFamilies ?? current.shareWithFamilies,
        }
        return {
          run: () => ({
            next,
            current,
            report,
            changed: planTripReportPhoto(next, {
              access,
              status: report.status,
              participants: participants.all,
              photoCount: 0,
              mode: 'update',
              current,
            }),
          }),
        }
      },
      after: async (tx, { next, current, report, changed }) => {
        const row: Partial<Omit<TripReportPhotoState, 'studentIds'>> = {}
        if (changed.includes('caption')) row.caption = next.caption
        if (changed.includes('noStudentsVisible')) row.noStudentsVisible = next.noStudentsVisible
        if (changed.includes('shareWithFamilies')) row.shareWithFamilies = next.shareWithFamilies
        if (
          !(await updateReportPhoto(tx, ctx.institutionId, {
            id: photoId,
            expectedVersion,
            changes: row,
            now: ctx.now,
          }))
        )
          throw new ConflictError()
        if (changed.includes('studentIds'))
          await replacePhotoTags(tx, ctx.institutionId, {
            reportId: report.id,
            photoId,
            studentIds: next.studentIds,
            current: current.studentIds,
            now: ctx.now,
            ids: randomUUID,
          })
        await auditWork(tx, ctx, 'finance.trip_report.photo_update', entity, changed)
        body = { data: await reportDetail(tx, ctx, planId) }
      },
    },
    respondWith(200, () => body),
    idempotency,
  )
}

/** Fotoğraf kaldırma (K-530): satır arşivlenir, dosya bağı çözülür; `If-Match`. */
export function removeTripReportPhotoCommand(
  ctx: ServiceContext,
  planId: string,
  photoId: string,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: PHOTO, id: photoId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.trip_report.photo_remove',
      collections: [],
      entity,
      load: async (tx) => {
        const { access, report, photo } = await photoFor(tx, ctx, planId, photoId, expectedVersion)
        return {
          run: () => {
            assertTripReportPhotoRemove(access, report.status)
            return { report, photo }
          },
        }
      },
      after: async (tx, { report, photo }) => {
        await replacePhotoTags(tx, ctx.institutionId, {
          reportId: report.id,
          photoId,
          studentIds: [],
          current: photo.studentIds,
          now: ctx.now,
          ids: randomUUID,
        })
        if (
          !(await archiveReportPhoto(tx, ctx.institutionId, {
            id: photoId,
            expectedVersion,
            now: ctx.now,
          }))
        )
          throw new ConflictError()
        await detachFile(tx, ctx, {
          fileId: photo.fileId,
          attachedType: TRIP_REPORT_ATTACHMENT,
          attachedId: report.id,
        })
        await auditWork(tx, ctx, 'finance.trip_report.photo_remove', entity, ['archivedAt'])
        body = { data: await reportDetail(tx, ctx, planId) }
      },
    },
    respondWith(200, () => body),
    idempotency,
  )
}

/**
 * Katılımcı değerlendirmesi (K-531): veli ya da öğrenci, kapsamdaki ve geziye katılmış öğrenci için
 * gezi başına bir kez. `Idempotency-Key` zorunlu; 201 ve kendi değerlendirmesi. Denetime yalnız alan
 * adları (puan ve yorum yazılmaz).
 */
export async function createTripEvaluationCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  // Kapsam işlemden önce okunur: okuma kendi bağlantısını kullanır (PGlite tek bağlantılıdır).
  const scope = await readScope(ctx)
  const id = randomUUID()
  const entity = { type: EVALUATION, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.trip_evaluation.create',
      collections: [],
      entity,
      load: async (tx) => {
        const fields = tripEvaluationSchema.parse(input)
        const inScope = scope.studentIds.has(fields.studentId)
        const [plan, marks, mine] = await Promise.all([
          findTripPlan(tx, ctx.institutionId, fields.planId),
          inScope
            ? loadStudentTripDayMarks(tx, ctx.institutionId, [fields.studentId])
            : Promise.resolve([]),
          loadMembershipEvaluations(tx, ctx.institutionId, ctx.actor.membershipId, [fields.planId]),
        ])
        return {
          run: () => {
            planTripEvaluation({
              role: ctx.actor.role,
              inScope,
              plan,
              attended: marks.some(
                (mark) => mark.planId === fields.planId && mark.status === 'present',
              ),
              exists: mine.length > 0,
              now: ctx.now,
            })
            return fields
          },
        }
      },
      after: async (tx, fields) => {
        await insertTripEvaluation(tx, ctx.institutionId, {
          id,
          planId: fields.planId,
          studentId: fields.studentId,
          membershipId: ctx.actor.membershipId,
          respondentRole: ctx.actor.role,
          score: fields.score,
          comment: fields.comment,
          now: ctx.now,
        })
        await auditWork(tx, ctx, 'finance.trip_evaluation.create', entity, [
          'planId',
          'studentId',
          'score',
          ...(fields.comment === null ? [] : ['comment']),
        ])
        body = {
          data: {
            id,
            planId: fields.planId,
            studentId: fields.studentId,
            score: fields.score,
            comment: fields.comment,
            createdAt: ctx.now.toISOString(),
          },
        }
      },
    },
    respondWith(201, () => body),
    idempotency,
  )
}
