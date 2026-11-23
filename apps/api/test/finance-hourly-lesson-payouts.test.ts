import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { courseNameKey } from '@kampus/school-core/lib/courses.ts'
import { groupNameKey } from '@kampus/school-core/lib/language-groups.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { courses } from '../src/db/schema/courses.ts'
import { schoolCalendarEvents } from '../src/db/schema/finance-school-calendar.ts'
import { languageGroups } from '../src/db/schema/language-groups.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Saat ücretli öğretmen ders saati hakediş dökümü uçları (DOM-FIN-167; ON-075; IST-087;
 * K-556…K-558). Her test kendi kurumunu kurar; ders programı ve öğretmen kayıtları `records`'a
 * yazılır. FIXED_NOW 2026-10-06; ay Eylül 2026 (bitti). Ece (t2) ders saati ücretlidir: 500 ₺,
 * 15 Eylül'den saatlik 900 ₺. Selin (t1) aylıktır ve dökümde yer almaz. Murat (t3) üyeliğe bağlı,
 * ücret tanımı yok.
 */

const FINANCE = '/api/v1/finance'
const BASE = `${FINANCE}/hourly-lesson-payouts`
const OWN = `${FINANCE}/my-hourly-lesson-payouts`
const RATES = `${FINANCE}/pay-rates`
const PROFILES = `${FINANCE}/leave-profiles`
const LEAVE_RECORDS = `${FINANCE}/leave-records`
const MONTH = '2026-09'
const LIST = `${BASE}/${MONTH}`
const MINE = `${OWN}/${MONTH}`

type Json = Record<string, unknown>
type Response = Awaited<ReturnType<App['inject']>>

const at = (day: string, period: number) =>
  new Date(Date.parse(`${day}T06:00:00.000Z`) + period * 50 * 60_000).toISOString()
const lesson = (id: string, day: string, period: number, extra: Json = {}) => ({
  collection: 'schedule' as const,
  id,
  data: {
    id,
    classId: 'c1',
    teacherId: 't2',
    subjectId: 'ing',
    date: at(day, period),
    duration: 40,
    title: 'İngilizce',
    room: '101',
    ...extra,
  },
})
const teacher = (id: string, name: string) => ({
  collection: 'teachers' as const,
  id,
  data: {
    id,
    name,
    subjectId: 'ing',
    branchId: 'b1',
    email: `${id}@ornek.test`,
    phone: '05550000000',
    isActive: true,
  },
})
const TEACHERS = [
  teacher('t1', 'Selin Kaya'),
  teacher('t2', 'Ece Yılmaz'),
  teacher('t3', 'Murat Demir'),
  {
    collection: 'classes' as const,
    id: 'c1',
    data: { id: 'c1', name: '9-A', grade: 9, section: 'A' },
  },
]
const SAMPLE = [
  ...TEACHERS,
  lesson('h-mon-1', '2026-09-07', 0),
  lesson('h-mon-2', '2026-09-07', 1, { duration: 80 }),
  lesson('h-tue-cancel', '2026-09-08', 0, { cancelledAt: '2026-09-01T08:00:00.000Z' }),
  lesson('h-wed-sub', '2026-09-09', 0, { teacherId: 't1', originalTeacherId: 't2' }),
  lesson('h-makeup', '2026-09-15', 0, { makeupForLessonId: 'h-tue-cancel' }),
  lesson('h-holiday', '2026-09-16', 0),
  lesson('h-leave', '2026-09-17', 0),
  lesson('h-selin', '2026-09-07', 2, { teacherId: 't1' }),
  lesson('h-murat', '2026-09-08', 3, { teacherId: 't3', classId: 'c3' }),
]

describe('DOM-FIN-167: ders saati hakediş dökümü uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let tenantCount = 0
  let clientIp = '10.75.0.1'

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  function call(
    url: string,
    cookie: string | null,
    headers: Record<string, string> = {},
    target: App = app,
  ) {
    return target.inject({
      method: 'GET',
      url,
      remoteAddress: clientIp,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }), ...headers },
    })
  }
  function post(url: string, cookie: string, payload: unknown) {
    return app.inject({
      method: 'POST',
      url,
      remoteAddress: clientIp,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      payload: JSON.stringify(payload),
    })
  }
  function ok(response: Response, status = 200): Json {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function assertError(response: Response, status: number, code?: string) {
    assert.equal(response.statusCode, status, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  async function institution(
    overrides: Partial<InstitutionOverrides> = {},
    records: readonly Parameters<typeof insertMissingRecords>[2][number][] = SAMPLE,
  ) {
    clientIp = `10.75.${String((tenantCount += 1))}.1`
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, records, FIXED_NOW)
    return { id: created.id, admin: await signInAs(app, created.admin) }
  }
  type Tenant = Awaited<ReturnType<typeof institution>>
  async function staffMember(t: Tenant, role: Role, teacherId?: string) {
    const member = await createMember(
      app,
      t.id,
      role,
      teacherId === undefined ? [] : [{ kind: 'teacher', recordId: teacherId }],
    )
    return { membershipId: member.membershipId, cookie: await signInAs(app, member) }
  }
  async function rate(
    t: Tenant,
    membershipId: string,
    rateType: string,
    amountCents: number,
    startDate: string,
  ) {
    ok(
      await post(RATES, t.admin, {
        component: 'wage',
        membershipId,
        rateType,
        amountCents,
        startDate,
      }),
      201,
    )
  }
  async function holiday(t: Tenant, day: string) {
    await db.insert(schoolCalendarEvents).values({
      institutionId: t.id,
      id: randomUUID(),
      title: 'Okul kuruluş günü',
      kind: 'holiday',
      allDay: true,
      startDate: day,
      endDate: day,
      audienceKind: 'institution',
      status: 'published',
      publishedAt: FIXED_NOW,
      publishedByUserId: 'test-admin',
      createdByUserId: 'test-admin',
    })
  }

  /** Ece saat ücretli (15 Eylül'de saatliğe geçer), Selin aylık, Murat tanımsız; 16 Eylül tatil, 17 Eylül Ece izinli. */
  async function staffed(overrides: Partial<InstitutionOverrides> = {}) {
    const t = await institution(overrides)
    const ece = await staffMember(t, 'ogretmen', 't2')
    const selin = await staffMember(t, 'ogretmen', 't1')
    const murat = await staffMember(t, 'ogretmen', 't3')
    await rate(t, ece.membershipId, 'lesson_hour', 50_000, '2026-01-01')
    await rate(t, ece.membershipId, 'hourly', 90_000, '2026-09-15')
    await rate(t, selin.membershipId, 'monthly_gross', 4_500_000, '2026-01-01')
    ok(
      await post(PROFILES, t.admin, {
        membershipId: ece.membershipId,
        seniorityStartDate: '2022-09-01',
      }),
      201,
    )
    ok(
      await post(LEAVE_RECORDS, t.admin, {
        membershipId: ece.membershipId,
        typeCode: 'annual',
        startDate: '2026-09-17',
        endDate: '2026-09-17',
        days: 1,
      }),
      201,
    )
    await holiday(t, '2026-09-16')
    return { ...t, ece, selin, murat }
  }
  const audits = (institutionId: string, action: string) =>
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  const teacherRow = (data: Json, membershipId: string) =>
    (data.teachers as Json[]).find((item) => item.membershipId === membershipId)

  test('kimliksiz istek 401', async () => {
    assertError(await call(LIST, null), 401)
    assertError(await call(`${LIST}/teachers/x`, null), 401)
    assertError(await call(MINE, null), 401)
  })

  test('ön büro ve öğretmen tüm dökümü göremez 403; veli ve öğrenci kendi ucunda 403; modül kapalı 403', async () => {
    const t = await staffed()
    for (const role of ['onburo', 'ogretmen', 'veli'] as const) {
      const { cookie } = await staffMember(t, role)
      assertError(await call(LIST, cookie), 403)
      assertError(await call(`${LIST}/teachers/${t.ece.membershipId}`, cookie), 403)
    }
    for (const role of ['veli', 'ogrenci'] as const) {
      const { cookie } = await staffMember(t, role)
      assertError(await call(MINE, cookie), 403)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    assertError(await call(LIST, closed.admin), 403)
    assertError(await call(MINE, closed.admin), 403)
  })

  test('400: geçersiz ay ve bilinmeyen sorgu alanı', async () => {
    const t = await institution()
    assertError(await call(`${BASE}/2026-13`, t.admin), 400)
    assertError(await call(`${LIST}?purpose=csv`, t.admin), 400)
    assertError(await call(`${LIST}?institutionId=x`, t.admin), 400)
    assertError(await call(`${OWN}/eylul`, t.admin), 400)
  })

  test('DOM-FIN-167 K-556: okulda saat ücretli öğretmenin özeti, tutarı ve ücret değişimi; okuma denetime düşer', async () => {
    const t = await staffed()
    const data = ok(await call(LIST, t.admin))
    assert.equal(data.monthComplete, true)
    assert.deepEqual(
      (data.teachers as Json[]).map((item) => item.membershipId).sort(),
      [t.ece.membershipId, t.murat.membershipId].sort(),
    )
    assert.equal(teacherRow(data, t.selin.membershipId), undefined)
    const ece = teacherRow(data, t.ece.membershipId) ?? {}
    assert.equal(ece.payBasis, 'hourly')
    const totals = ece.totals as Json
    assert.deepEqual(
      [
        totals.givenLessons,
        totals.givenHours,
        totals.cancelledLessons,
        totals.makeupLessons,
        totals.substitutedOutLessons,
        totals.holidayLessons,
        totals.leaveLessons,
      ],
      [3, 4, 1, 1, 1, 1, 1],
    )
    // 7 Eylül: 1 + 2 ders saati × 500 ₺; 15 Eylül telafi 40 dakika × 900 ₺ / 60 = 600 ₺.
    assert.equal(totals.amountCents, 210_000)
    assert.deepEqual(
      (ece.rates as Json[]).map((item) => [item.rateType, item.lessons, item.amountCents]),
      [
        ['lesson_hour', 2, 150_000],
        ['hourly', 1, 60_000],
      ],
    )
    const murat = teacherRow(data, t.murat.membershipId) ?? {}
    assert.equal(murat.payBasis, 'unknown')
    assert.deepEqual(murat.warnings, ['no_pay_rate', 'attendance_missing'])
    assert.equal((murat.totals as Json).amountCents, 0)
    assert.deepEqual(data.totals, {
      teacherCount: 2,
      givenLessons: 4,
      givenHours: 5,
      cancelledLessons: 1,
      makeupLessons: 1,
      amountCents: 210_000,
      unpricedTeacherCount: 1,
    })
    assert.equal((await audits(t.id, 'finance.hourly_lesson_payout.read')).length, 1)
    assert.equal((await audits(t.id, 'finance.hourly_lesson_payout.export')).length, 0)
  })

  test('DOM-FIN-167: öğretmenin gün gün dökümü sınıf adı, durum ve satır tutarıyla', async () => {
    const t = await staffed()
    const detail = ok(await call(`${LIST}/teachers/${t.ece.membershipId}`, t.admin))
    assert.equal(detail.staffName, 'Test Kullanıcı')
    assert.equal(detail.monthComplete, true)
    const lines = (detail.days as Json[]).flatMap((day) => day.lines as Json[])
    assert.deepEqual(
      lines.map((line) => [line.lessonId, line.status, line.kind, line.amountCents]),
      [
        ['h-mon-1', 'counted', 'own', 50_000],
        ['h-mon-2', 'counted', 'own', 100_000],
        ['h-tue-cancel', 'cancelled', 'own', null],
        ['h-wed-sub', 'substituted_out', 'own', null],
        ['h-makeup', 'counted', 'makeup', 60_000],
        ['h-holiday', 'holiday', 'own', null],
        ['h-leave', 'leave', 'own', null],
      ],
    )
    assert.equal(lines[0]?.placeName, '9-A')
    assert.equal(lines[4]?.makeupForLessonId, 'h-tue-cancel')
    assert.equal(lines[5]?.holidayTitle, 'Okul kuruluş günü')
    // Aylık ücretli öğretmen dökümde yok: 404.
    assertError(await call(`${LIST}/teachers/${t.selin.membershipId}`, t.admin), 404)
    assertError(await call(`${LIST}/teachers/yok`, t.admin), 404)
    assert.equal((await audits(t.id, 'finance.hourly_lesson_payout.read')).length, 1)
  })

  test('DOM-FIN-167: öğretmen kendi dökümünü görür; aylık ücretlide döküm boş, PDF 404', async () => {
    const t = await staffed()
    const own = ok(await call(MINE, t.ece.cookie))
    assert.equal(own.month, MONTH)
    const payout = own.payout as Json
    assert.equal(payout.membershipId, t.ece.membershipId)
    assert.equal((payout.totals as Json).amountCents, 210_000)
    assert.equal((payout.days as Json[]).length, 6)
    const selin = ok(await call(MINE, t.selin.cookie))
    assert.equal(selin.payout, null)
    assertError(await call(`${MINE}?purpose=pdf`, t.selin.cookie), 404)
    // Ekran okuması denetime düşmez; PDF verisi düşer.
    assert.equal((await audits(t.id, 'finance.hourly_lesson_payout.read')).length, 0)
    ok(await call(`${MINE}?purpose=pdf`, t.ece.cookie))
    const exported = await audits(t.id, 'finance.hourly_lesson_payout.export')
    assert.equal(exported.length, 1)
    assert.equal(exported[0]?.entityId, `hourly-lesson-payout:${MONTH}:${t.ece.membershipId}:pdf`)
  })

  test('DOM-FIN-167: CSV ders başına satır ve toplam; PDF ve CSV denetime düşer, taze oturum ister', async () => {
    const t = await staffed()
    const csv = await call(LIST, t.admin, { accept: 'text/csv' })
    assert.equal(csv.statusCode, 200, csv.body)
    assert.match(String(csv.headers['content-type']), /^text\/csv/)
    assert.match(
      String(csv.headers['content-disposition']),
      /filename="ders-saati-hakedis-2026-09\.csv"/,
    )
    assert.ok(csv.body.startsWith('\uFEFF"Öğretmen";"Gün"'))
    const rows = csv.body.split('\r\n')
    // 7 Ece + 1 Murat satırı, iki toplam, başlık ve not.
    assert.equal(rows.length, 12)
    assert.ok(
      rows.some((row) => row.includes('"Telafi dersi";"Verildi";40;1;"Saatlik";900,00;600,00')),
    )
    const single = await call(`${LIST}/teachers/${t.ece.membershipId}`, t.admin, {
      accept: 'text/csv',
    })
    assert.equal(single.statusCode, 200)
    assert.equal(single.body.split('\r\n').length, 10)
    const own = await call(MINE, t.ece.cookie, { accept: 'text/csv' })
    assert.equal(own.statusCode, 200)
    ok(await call(`${LIST}?purpose=pdf`, t.admin))
    ok(await call(`${LIST}/teachers/${t.ece.membershipId}?purpose=pdf`, t.admin))
    const exported = await audits(t.id, 'finance.hourly_lesson_payout.export')
    assert.deepEqual(
      exported.map((row) => row.entityId).sort(),
      [
        `hourly-lesson-payout:${MONTH}:${t.ece.membershipId}:csv`,
        `hourly-lesson-payout:${MONTH}:${t.ece.membershipId}:csv`,
        `hourly-lesson-payout:${MONTH}:${t.ece.membershipId}:pdf`,
        `hourly-lesson-payout:${MONTH}:csv`,
        `hourly-lesson-payout:${MONTH}:pdf`,
      ].sort(),
    )
    assert.deepEqual(exported[0]?.changes, {
      fields: ['staffName', 'lines', 'hours', 'rateCents', 'amountCents', 'status'],
    })

    const later = await buildTestApp(db, { clock: () => new Date(Date.now() + 16 * 60 * 1000) })
    try {
      assertError(
        await call(LIST, t.admin, { accept: 'text/csv' }, later),
        403,
        'reauthentication_required',
      )
      assertError(
        await call(`${LIST}?purpose=pdf`, t.admin, {}, later),
        403,
        'reauthentication_required',
      )
      assertError(
        await call(`${MINE}?purpose=pdf`, t.ece.cookie, {}, later),
        403,
        'reauthentication_required',
      )
      // Ekran okuması taze oturum istemez.
      ok(await call(LIST, t.admin, {}, later))
    } finally {
      await later.close()
    }
  })

  test('DOM-FIN-167 K-557: dil okulunda grup oturumları plandan; iptal edilen grubun sonraki oturumları iptal', async () => {
    const t = await institution({ type: 'language_school' }, TEACHERS)
    const ece = await staffMember(t, 'ogretmen')
    await rate(t, ece.membershipId, 'lesson_hour', 50_000, '2026-01-01')
    await holiday(t, '2026-09-16')
    const courseId = randomUUID()
    await db.insert(courses).values({
      institutionId: t.id,
      id: courseId,
      name: 'Genel İngilizce B1',
      nameKey: courseNameKey('Genel İngilizce B1'),
      language: 'en',
      level: 'B1',
      totalHours: 8,
      weeklyHours: 2,
      sessionMinutes: 45,
      minLearners: 1,
      maxLearners: 12,
      certified: false,
      status: 'draft',
      eOzelApproval: 'not_submitted',
    })
    const group = (name: string, extra: Partial<typeof languageGroups.$inferInsert>) => ({
      institutionId: t.id,
      id: randomUUID(),
      courseId,
      name,
      nameKey: groupNameKey(name),
      ageBand: 'adult' as const,
      teacherMembershipId: ece.membershipId,
      delivery: 'online' as const,
      startDate: '2026-09-07',
      endDate: '2026-09-30',
      capacity: 10,
      state: 'open' as const,
      openedAt: new Date('2026-09-01T08:00:00.000Z'),
      schedule: [
        { weekday: 1, startTime: '18:00' },
        { weekday: 3, startTime: '18:00' },
      ],
      ...extra,
    })
    const evening = group('B1 Akşam', {})
    const morning = group('B1 Sabah', {
      schedule: [
        { weekday: 2, startTime: '10:00' },
        { weekday: 4, startTime: '10:00' },
      ],
      startDate: '2026-09-08',
      state: 'cancelled',
      cancelledAt: new Date('2026-09-15T08:00:00.000Z'),
      cancelReason: 'Yetersiz katılım',
    })
    const planned = group('B1 Öğle', { state: 'planned', openedAt: null })
    await db.insert(languageGroups).values([evening, morning, planned])

    const data = ok(await call(LIST, t.admin))
    const row = teacherRow(data, ece.membershipId) ?? {}
    assert.deepEqual(row.warnings, ['group_plan'])
    const totals = row.totals as Json
    // Akşam: Eylül'de 8 oturum, 16 Eylül tatil → 7 verildi. Sabah: Eylül'de 7 oturum; 8, 10 ve
    // 15 Eylül (10.00, iptal anından önce) verildi, sonraki 4 oturum iptal. Öğle hiç açılmadı.
    assert.deepEqual(
      [totals.givenLessons, totals.groupHours, totals.cancelledLessons, totals.holidayLessons],
      [10, 10, 4, 1],
    )
    assert.equal(totals.amountCents, 500_000)
    const detail = ok(await call(`${LIST}/teachers/${ece.membershipId}`, t.admin))
    const first = (detail.days as Json[])[0]?.lines as Json[]
    assert.equal(first[0]?.placeName, 'B1 Akşam')
    assert.equal(first[0]?.title, 'Genel İngilizce B1')
    assert.equal(first[0]?.startsAt, '2026-09-07T15:00:00.000Z')
    assert.equal(first[0]?.source, 'group')
  })

  test('DOM-FIN-167: başka kurumun öğretmeni 404; listede ve kendi dökümünde B yok', async () => {
    const a = await staffed()
    const b = await staffed()
    assertError(await call(`${LIST}/teachers/${b.ece.membershipId}`, a.admin), 404)
    assertError(await call(`${LIST}/teachers/${b.ece.membershipId}?purpose=pdf`, a.admin), 404)
    const list = ok(await call(LIST, a.admin))
    assert.equal(teacherRow(list, b.ece.membershipId), undefined)
    assert.equal((list.teachers as Json[]).length, 2)
    // Kendi ucu yalnız oturumdaki üyeliğindir; B'nin dökümü A'nın sorgusuna karışmaz.
    const own = ok(await call(MINE, a.ece.cookie))
    assert.equal((own.payout as Json).membershipId, a.ece.membershipId)
    assert.equal((await audits(b.id, 'finance.hourly_lesson_payout.read')).length, 0)
  })
})
