import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertTripReportDecision,
  assertTripReportIncidents,
  assertTripReportPhotoRemove,
  assertTripReportPlan,
  assertTripReportSubmit,
  isTripEvaluationOpen,
  isTripFinished,
  photoTagIssue,
  planTripEvaluation,
  planTripReportCreate,
  planTripReportPhoto,
  planTripReportUpdate,
  tripAttendance,
  tripAttendedStudents,
  tripEvaluationClosesAt,
  tripEvaluationSchema,
  tripEvaluationSummary,
  tripReportAccess,
  tripReportCreateSchema,
  tripReportPhotoSchema,
  tripReportPhotoUpdateSchema,
  tripReportPhotoVisibility,
  tripReportReturnSchema,
  tripReportUpdateSchema,
  type TripReportAccess,
  type TripReportPhotoState,
} from '../packages/school-core/src/lib/finance-trip-reports.ts'

/** Gezi sonrası rapor, rızalı fotoğraf ve değerlendirme kuralları (DOM-FIN-158; K-529…K-531). */

const PLAN = {
  status: 'approved' as const,
  departureAt: '2026-10-20T05:00:00.000Z',
  returnAt: '2026-10-20T17:00:00.000Z',
}
const DURING = new Date('2026-10-20T10:00:00Z')
const AFTER = new Date('2026-10-21T08:00:00Z')
const WRITER: TripReportAccess = { read: true, write: true, decide: false }
const ADMIN: TripReportAccess = { read: true, write: true, decide: true }
const READER: TripReportAccess = { read: true, write: false, decide: false }
const TEXT = 'Gezi planlandığı gibi gerçekleşti; müze turu tamamlandı.'

function rejects(fn: () => unknown, code: string, kind?: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError, String(error))
    assert.equal(error.code, code)
    if (kind !== undefined) assert.equal(error.kind, kind)
    return true
  })
}

describe('DOM-FIN-158: rapor erişimi ve gezinin bitmesi (K-529)', () => {
  test('yönetici her şeyi, ön büro okur, öğretmen yalnız görevlisi olduğu planı', () => {
    const staff = ['m-lead']
    assert.deepEqual(tripReportAccess({ role: 'yonetici', membershipId: 'x' }, staff), ADMIN)
    assert.deepEqual(tripReportAccess({ role: 'onburo', membershipId: 'x' }, staff), READER)
    assert.deepEqual(tripReportAccess({ role: 'ogretmen', membershipId: 'm-lead' }, staff), WRITER)
    assert.deepEqual(tripReportAccess({ role: 'ogretmen', membershipId: 'm-x' }, staff), {
      read: false,
      write: false,
      decide: false,
    })
    for (const role of ['veli', 'ogrenci'] as const)
      assert.equal(tripReportAccess({ role, membershipId: 'm-lead' }, staff).read, false)
  })

  test('gezi dönüş anından sonra ya da plan tamamlanınca biter', () => {
    assert.equal(isTripFinished(PLAN, DURING), false)
    assert.equal(isTripFinished(PLAN, AFTER), true)
    assert.equal(isTripFinished({ ...PLAN, status: 'completed' }, DURING), true)
    assert.equal(isTripFinished({ ...PLAN, status: 'cancelled' }, AFTER), false)
    rejects(() => assertTripReportPlan(PLAN, DURING), 'trip_report_trip_not_finished')
    for (const status of ['draft', 'submitted', 'rejected', 'cancelled'] as const)
      rejects(
        () => assertTripReportPlan({ ...PLAN, status }, AFTER),
        'trip_report_plan_not_eligible',
      )
    assert.doesNotThrow(() => assertTripReportPlan(PLAN, AFTER))
  })

  test('rapor açma: yazma yetkisi, biten gezi, planda tek rapor', () => {
    const base = { access: WRITER, plan: PLAN, exists: false, now: AFTER }
    assert.doesNotThrow(() => planTripReportCreate(base))
    rejects(
      () => planTripReportCreate({ ...base, access: READER }),
      'trip_report_write_forbidden',
      'forbidden',
    )
    rejects(() => planTripReportCreate({ ...base, now: DURING }), 'trip_report_trip_not_finished')
    rejects(() => planTripReportCreate({ ...base, exists: true }), 'trip_report_exists', 'conflict')
  })
})

describe('DOM-FIN-158: rapor şeması, düzeltme, gönderme ve karar (K-529)', () => {
  test('taslak metinleri boş kalabilir; boş metin null olur; tutanak tekrarı ve fazlası reddedilir', () => {
    const draft = tripReportCreateSchema.parse({})
    assert.deepEqual(draft, {
      summary: null,
      incidentNote: null,
      incidentIds: [],
      outcomeNote: null,
    })
    assert.equal(tripReportCreateSchema.parse({ summary: '   ' }).summary, null)
    const id = '7c2f1f39-3f43-4d52-9a32-3a5c0c9b2b11'
    assert.equal(tripReportCreateSchema.safeParse({ incidentIds: [id, id] }).success, false)
    assert.equal(tripReportCreateSchema.safeParse({ summary: 'x'.repeat(4001) }).success, false)
    assert.equal(tripReportCreateSchema.safeParse({ institutionId: 'b' }).success, false)
    assert.equal(tripReportUpdateSchema.safeParse({}).success, false)
    assert.equal(tripReportReturnSchema.safeParse({ reason: 'kısa' }).success, false)
    assert.equal(
      tripReportReturnSchema.parse({ reason: '  Kazanımı açın  ' }).reason,
      'Kazanımı açın',
    )
  })

  test('düzeltme yalnız değişen alanları döner; kilitli ve değişmeyen reddedilir', () => {
    const current = {
      status: 'draft' as const,
      summary: TEXT,
      incidentNote: null,
      incidentIds: ['a', 'b'],
      outcomeNote: null,
    }
    assert.deepEqual(
      planTripReportUpdate(
        { summary: TEXT, outcomeNote: TEXT, incidentIds: ['b', 'a'] },
        current,
        WRITER,
      ),
      ['outcomeNote'],
    )
    assert.deepEqual(planTripReportUpdate({ incidentIds: ['a'] }, current, WRITER), ['incidentIds'])
    rejects(() => planTripReportUpdate({ summary: TEXT }, current, WRITER), 'trip_report_unchanged')
    rejects(
      () => planTripReportUpdate({ summary: 'yeni' }, current, READER),
      'trip_report_write_forbidden',
    )
    for (const status of ['submitted', 'approved'] as const)
      rejects(
        () => planTripReportUpdate({ summary: 'yeni' }, { ...current, status }, WRITER),
        'trip_report_locked',
      )
    assert.deepEqual(
      planTripReportUpdate(
        { incidentNote: 'Kısa not' },
        { ...current, status: 'returned' },
        WRITER,
      ),
      ['incidentNote'],
    )
  })

  test('gönderme özet ve kazanım ister; karar yalnız yöneticide ve gönderilmiş raporda', () => {
    const report = {
      status: 'draft' as const,
      summary: TEXT,
      incidentNote: null,
      incidentIds: [],
      outcomeNote: TEXT,
    }
    assert.doesNotThrow(() => assertTripReportSubmit(report, WRITER))
    assert.doesNotThrow(() => assertTripReportSubmit({ ...report, status: 'returned' }, WRITER))
    rejects(
      () => assertTripReportSubmit({ ...report, summary: null }, WRITER),
      'trip_report_incomplete',
    )
    rejects(
      () => assertTripReportSubmit({ ...report, outcomeNote: 'kısa' }, WRITER),
      'trip_report_incomplete',
    )
    rejects(
      () => assertTripReportSubmit({ ...report, status: 'submitted' }, WRITER),
      'trip_report_locked',
    )
    assert.doesNotThrow(() => assertTripReportDecision(ADMIN, 'submitted'))
    rejects(
      () => assertTripReportDecision(WRITER, 'submitted'),
      'trip_report_decide_forbidden',
      'forbidden',
    )
    for (const status of ['draft', 'returned', 'approved'] as const)
      rejects(() => assertTripReportDecision(ADMIN, status), 'trip_report_not_submitted')
  })

  test('kaza tutanağı kurumda ve olay anı gezi süresinde olmalı', () => {
    const found = new Map([
      ['in', { id: 'in', occurredAt: '2026-10-20T09:00:00.000Z' }],
      ['out', { id: 'out', occurredAt: '2026-10-19T09:00:00.000Z' }],
    ])
    assert.doesNotThrow(() => assertTripReportIncidents(['in'], found, PLAN))
    rejects(
      () => assertTripReportIncidents(['in', 'x'], found, PLAN),
      'trip_report_incident_not_found',
    )
    rejects(
      () => assertTripReportIncidents(['out'], found, PLAN),
      'trip_report_incident_outside_trip',
    )
  })
})

describe('DOM-FIN-158: fotoğraf etiketi ve rızalı yayım (K-530, IST-017)', () => {
  const file = '7c2f1f39-3f43-4d52-9a32-3a5c0c9b2b11'
  test('etiket ya da "öğrenci görünmüyor" işaretinden tam biri gerekir', () => {
    assert.equal(tripReportPhotoSchema.safeParse({ fileId: file }).success, false)
    assert.equal(
      tripReportPhotoSchema.safeParse({
        fileId: file,
        studentIds: ['s-1'],
        noStudentsVisible: true,
      }).success,
      false,
    )
    const parsed = tripReportPhotoSchema.parse({ fileId: file, studentIds: ['s-1'] })
    assert.equal(parsed.shareWithFamilies, true)
    assert.equal(parsed.caption, null)
    assert.equal(
      tripReportPhotoSchema.safeParse({ fileId: file, studentIds: ['s-1', 's-1'] }).success,
      false,
    )
    assert.equal(tripReportPhotoUpdateSchema.safeParse({}).success, false)
    assert.equal(photoTagIssue([], true), null)
  })

  const state: TripReportPhotoState = {
    caption: null,
    studentIds: ['s-1'],
    noStudentsVisible: false,
    shareWithFamilies: true,
  }
  const checks = {
    access: WRITER,
    status: 'draft' as const,
    participants: new Set(['s-1', 's-2']),
    photoCount: 0,
    mode: 'create' as const,
  }

  test('fotoğraf yalnız katılımcıyı etiketler; sınır ve kilit', () => {
    assert.deepEqual(planTripReportPhoto(state, checks), [])
    rejects(
      () => planTripReportPhoto({ ...state, studentIds: ['s-9'] }, checks),
      'trip_report_photo_student_not_participant',
    )
    rejects(
      () => planTripReportPhoto(state, { ...checks, photoCount: 20 }),
      'trip_report_photos_full',
    )
    rejects(
      () => planTripReportPhoto({ ...state, studentIds: [] }, checks),
      'trip_report_photo_tags_required',
    )
    rejects(
      () => planTripReportPhoto(state, { ...checks, status: 'approved' }),
      'trip_report_locked',
    )
    rejects(
      () => planTripReportPhoto(state, { ...checks, access: READER }),
      'trip_report_write_forbidden',
    )
  })

  test('fotoğraf düzeltmesi değişen alanları döner; değişmeyen reddedilir', () => {
    const update = { ...checks, mode: 'update' as const, photoCount: 20, current: state }
    assert.deepEqual(
      planTripReportPhoto(
        { ...state, studentIds: ['s-1', 's-2'], shareWithFamilies: false },
        update,
      ),
      ['studentIds', 'shareWithFamilies'],
    )
    assert.deepEqual(
      planTripReportPhoto(
        { ...state, studentIds: [], noStudentsVisible: true, caption: 'Müze' },
        update,
      ),
      ['caption', 'studentIds', 'noStudentsVisible'],
    )
    rejects(() => planTripReportPhoto(state, update), 'trip_report_photo_unchanged')
    assert.doesNotThrow(() => assertTripReportPhotoRemove(WRITER, 'returned'))
    rejects(() => assertTripReportPhotoRemove(WRITER, 'submitted'), 'trip_report_locked')
  })

  test('yayım okuma anında: istenmeyen iç arşiv, rıza eksikse iç arşiv, onaydan sonra yayım', () => {
    const consented = [{ consent: true }, { consent: true }]
    assert.equal(
      tripReportPhotoVisibility({
        reportStatus: 'approved',
        shareWithFamilies: false,
        tags: consented,
      }),
      'internal',
    )
    assert.equal(
      tripReportPhotoVisibility({
        reportStatus: 'approved',
        shareWithFamilies: true,
        tags: [{ consent: true }, { consent: false }],
      }),
      'consent_missing',
    )
    assert.equal(
      tripReportPhotoVisibility({
        reportStatus: 'submitted',
        shareWithFamilies: true,
        tags: consented,
      }),
      'awaiting_approval',
    )
    assert.equal(
      tripReportPhotoVisibility({
        reportStatus: 'approved',
        shareWithFamilies: true,
        tags: consented,
      }),
      'published',
    )
    // Etiketsiz ("öğrenci görünmüyor") fotoğraf rıza gerektirmez.
    assert.equal(
      tripReportPhotoVisibility({ reportStatus: 'approved', shareWithFamilies: true, tags: [] }),
      'published',
    )
  })
})

describe('DOM-FIN-158: katılım gezi günü yoklamasından (K-529)', () => {
  test('katılan en az bir kapanan turda var; liste dağıtım ve işaretlerin birleşimi', () => {
    const closedMarks = [
      { studentId: 's-1', status: 'present' as const },
      { studentId: 's-2', status: 'absent' as const },
      { studentId: 's-1', status: 'absent' as const },
      { studentId: 's-4', status: 'present' as const },
    ]
    assert.deepEqual(tripAttendance({ members: ['s-1', 's-2', 's-3'], closedMarks }), {
      source: 'trip_day',
      rosterCount: 4,
      attendedCount: 2,
      absentCount: 2,
    })
    assert.deepEqual([...tripAttendedStudents(closedMarks)].sort(), ['s-1', 's-4'])
    assert.deepEqual(tripAttendance({ members: ['s-1'], closedMarks: [] }), {
      source: 'none',
      rosterCount: 0,
      attendedCount: 0,
      absentCount: 0,
    })
  })
})

describe('DOM-FIN-158: katılımcı değerlendirmesi (K-531)', () => {
  test('şema 1–5 puan ve isteğe bağlı yorum', () => {
    const planId = '7c2f1f39-3f43-4d52-9a32-3a5c0c9b2b11'
    assert.equal(tripEvaluationSchema.parse({ planId, studentId: 's-1', score: 5 }).comment, null)
    for (const score of [0, 6, 3.5])
      assert.equal(
        tripEvaluationSchema.safeParse({ planId, studentId: 's-1', score }).success,
        false,
      )
    assert.equal(
      tripEvaluationSchema.safeParse({
        planId,
        studentId: 's-1',
        score: 4,
        comment: 'x'.repeat(501),
      }).success,
      false,
    )
  })

  test('değerlendirme dönüşten 30 gün açıktır; yalnız katılan, kapsamdaki aile, bir kez', () => {
    assert.equal(tripEvaluationClosesAt(PLAN.returnAt), '2026-11-19T17:00:00.000Z')
    assert.equal(isTripEvaluationOpen(PLAN, AFTER), true)
    assert.equal(isTripEvaluationOpen(PLAN, new Date('2026-11-19T17:00:00Z')), false)
    const base = {
      role: 'veli' as const,
      inScope: true,
      plan: PLAN,
      attended: true,
      exists: false,
      now: AFTER,
    }
    assert.doesNotThrow(() => planTripEvaluation(base))
    assert.doesNotThrow(() => planTripEvaluation({ ...base, role: 'ogrenci' }))
    rejects(() => planTripEvaluation({ ...base, role: 'ogretmen' }), 'trip_evaluation_forbidden')
    rejects(
      () => planTripEvaluation({ ...base, inScope: false }),
      'trip_evaluation_student_not_found',
      'not_found',
    )
    rejects(() => planTripEvaluation({ ...base, plan: null }), 'trip_evaluation_student_not_found')
    rejects(() => planTripEvaluation({ ...base, now: DURING }), 'trip_evaluation_not_open')
    rejects(
      () => planTripEvaluation({ ...base, plan: { ...PLAN, status: 'cancelled' } }),
      'trip_evaluation_not_open',
    )
    rejects(
      () => planTripEvaluation({ ...base, now: new Date('2026-12-01T00:00:00Z') }),
      'trip_evaluation_closed',
    )
    rejects(() => planTripEvaluation({ ...base, attended: false }), 'trip_evaluation_not_attended')
    rejects(
      () => planTripEvaluation({ ...base, exists: true }),
      'trip_evaluation_exists',
      'conflict',
    )
  })

  test('özet 5 yanıttan azken gizli; yorumlar ad taşımaz', () => {
    assert.deepEqual(tripEvaluationSummary([]), {
      responses: 0,
      hidden: false,
      average: null,
      distribution: null,
      comments: null,
    })
    const few = [{ score: 5, comment: 'Çok güzeldi' }]
    assert.deepEqual(tripEvaluationSummary(few), {
      responses: 1,
      hidden: true,
      average: null,
      distribution: null,
      comments: null,
    })
    const many = [
      { score: 5, comment: 'Çok güzeldi' },
      { score: 4, comment: null },
      { score: 4, comment: 'Rehber iyiydi' },
      { score: 3, comment: null },
      { score: 2, comment: null },
    ]
    assert.deepEqual(tripEvaluationSummary(many), {
      responses: 5,
      hidden: false,
      average: 3.6,
      distribution: [0, 1, 1, 2, 1],
      comments: ['Çok güzeldi', 'Rehber iyiydi'],
    })
  })
})
