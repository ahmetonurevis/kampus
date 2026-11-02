import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
import { permissionRemindersJob } from '../src/jobs/permission-reminders.ts'
import type { JobDeps } from '../src/jobs/types.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
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
import { tempStorage } from './support/files-sample.ts'

/**
 * İzin formu hatırlatma işi (OG-094; DOM-ILT-039, IST-067). Kurum 7-A (c1) örnek kesitiyle
 * kurulur; formlar ve kararlar API'den açılır. FIXED_NOW 2026-10-06T09:00Z (salı, İstanbul
 * 12:00): son günü 2026-10-08 olan forma iki gün, 2026-10-06 olana sıfır gün kalır. Anne ve baba
 * Deniz'in (s1) velayetli velisidir; öbür öğrencilerin hesaplı velisi yoktur ama kararları
 * velilerce beklenir.
 */

const SEED = createSeed(FIXED_NOW)
const C1_STUDENTS = SEED.students.filter((item) => item.classId === 'c1').map((item) => item.id)
type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const SAMPLE: Sample = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => item.id === 'c1'),
  students: SEED.students.filter((item) => item.classId === 'c1'),
  assignments: SEED.assignments.filter((item) => item.classId === 'c1'),
}
const rows = (sample: Sample) =>
  Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )

const FORM = {
  topic: 'trip',
  title: 'Müze gezisi',
  description: 'Cuma günü müze gezisi.',
  deadline: '2026-10-08',
  classIds: ['c1'],
}
const REMINDER = 'permission_form_reminder'

describe('izin formu hatırlatma işi', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let deps: JobDeps
  let store: Awaited<ReturnType<typeof tempStorage>>
  let serial = 0
  const key = () => `test-reminder-${String(++serial).padStart(5, '0')}`

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
    store = await tempStorage()
    deps = { db, storage: store.storage, log: app.log }
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows(SAMPLE), FIXED_NOW)
    return created
  }
  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const parent = (institutionId: string) =>
    member(institutionId, 'veli', [{ kind: 'child', recordId: 's1' }])

  function post(cookie: string, url: string, body: unknown) {
    return app.inject({
      method: 'POST',
      url,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': key(),
      },
      payload: JSON.stringify(body),
    })
  }
  async function open(teacherCookie: string, body: Record<string, unknown> = {}) {
    const response = await post(teacherCookie, '/api/v1/permission-forms', { ...FORM, ...body })
    assert.equal(response.statusCode, 201, response.body)
    return (response.json() as { data: { id: string } }).data.id
  }
  async function decide(cookie: string, formId: string, decision: 'approved' | 'rejected') {
    const response = await post(cookie, `/api/v1/permission-forms/${formId}/decisions`, {
      studentId: 's1',
      decision,
    })
    assert.equal(response.statusCode, 201, response.body)
  }
  const teacher = async (institutionId: string) =>
    (await member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: 't1' }])).cookie
  const reminders = async (institutionId: string) =>
    (await loadRecords(db, institutionId, ['notifications']))
      .map((row) => row.data)
      .filter((data) => data.kind === REMINDER)
      .map((data) => ({
        formId: (data.subject as { id: string }).id,
        studentId: data.studentId as string,
        audience: data.audience as string,
      }))
      .sort((a, b) => `${a.formId}${a.studentId}`.localeCompare(`${b.formId}${b.studentId}`))
  const run = (institutionId: string, now = FIXED_NOW) =>
    permissionRemindersJob.run(deps, { institutionId }, now)

  test('DOM-ILT-039: son güne iki gün kala ve son gün kararı beklenen öğrencilerin velisine hatırlatma; ikinci çalıştırma yeni bildirim yazmaz', async () => {
    const a = await institution()
    const t1 = await teacher(a.id)
    const twoDays = await open(t1)
    const lastDay = await open(t1, { title: 'Bugünkü gezi', deadline: '2026-10-06' })
    await open(t1, { title: 'Sonraki gezi', deadline: '2026-10-10' })
    const anne = await parent(a.id)
    const baba = await parent(a.id)
    // Deniz: iki günlük formda annesi onayladı, son gün formunda babası reddetti.
    await decide(anne.cookie, twoDays, 'approved')
    await decide(baba.cookie, lastDay, 'rejected')

    const first = await run(a.id)
    assert.deepEqual(first, {
      forms: 2,
      reminded: 2,
      created: 2 * (C1_STUDENTS.length - 1),
      deduplicated: 0,
      skipped: null,
    })
    const pending = C1_STUDENTS.filter((id) => id !== 's1')
    assert.deepEqual(
      await reminders(a.id),
      [twoDays, lastDay]
        .flatMap((formId) =>
          pending.map((studentId) => ({ formId, studentId, audience: 'parent' })),
        )
        .sort((x, y) => `${x.formId}${x.studentId}`.localeCompare(`${y.formId}${y.studentId}`)),
    )
    const audits = (await db.select().from(auditLog)).filter(
      (row) => row.institutionId === a.id && row.action === 'notification.create',
    )
    // Açılış bildirimlerinin (üç form) yanında iki hatırlatma; aktörsüz.
    const reminderAudits = audits.filter((row) => [twoDays, lastDay].includes(row.entityId ?? ''))
    assert.ok(reminderAudits.some((row) => row.actorUserId === null))

    const again = await run(a.id)
    assert.deepEqual(again, { ...first, created: 0, deduplicated: first.created })
    assert.equal((await reminders(a.id)).length, first.created)
  })

  test('DOM-ILT-039: kapalı, son günü geçmiş ve hatırlatma günü olmayan forma hatırlatma yok', async () => {
    const a = await institution()
    const t1 = await teacher(a.id)
    const formId = await open(t1)
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/permission-forms/${formId}`,
      headers: { origin: TEST_ORIGIN, cookie: t1 },
    })
    const version = (listed.json() as { data: { version: number } }).data.version
    const closed = await app.inject({
      method: 'POST',
      url: `/api/v1/permission-forms/${formId}/close`,
      headers: {
        origin: TEST_ORIGIN,
        cookie: t1,
        'if-match': `"${String(version)}"`,
        'idempotency-key': key(),
      },
    })
    assert.equal(closed.statusCode, 200, closed.body)
    const later = await open(t1, { title: 'Sonraki gezi', deadline: '2026-10-10' })

    assert.deepEqual(await run(a.id), {
      forms: 0,
      reminded: 0,
      created: 0,
      deduplicated: 0,
      skipped: null,
    })
    // 8 Ekim (İstanbul 09:00): kapalı formun son günüdür ama hatırlatılmaz; öbürüne iki gün kalır.
    const onDeadline = await run(a.id, new Date('2026-10-08T06:00:00.000Z'))
    assert.equal(onDeadline.forms, 1)
    assert.equal(onDeadline.created, C1_STUDENTS.length)
    assert.deepEqual([...new Set((await reminders(a.id)).map((item) => item.formId))], [later])
    // Son gün geçtikten sonra (İstanbul 11 Ekim) hiçbir şey yazılmaz.
    assert.deepEqual(await run(a.id, new Date('2026-10-10T22:00:00.000Z')), {
      forms: 0,
      reminded: 0,
      created: 0,
      deduplicated: 0,
      skipped: null,
    })
    assert.equal((await reminders(a.id)).length, C1_STUDENTS.length)
  })

  test('DOM-ILT-037: yetişkin kursiyerde hatırlatma kendisine, 18 yaş altında veliye gider', async () => {
    const a = await institution({ type: 'language_school' })
    await db.insert(studentIdentities).values({
      institutionId: a.id,
      studentId: 's1',
      academicYear: 2026,
      identityKind: 'foreign',
      identityNumber: 'YK-s1',
      birthDate: '2000-01-01',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    const formId = await open(await teacher(a.id))
    await run(a.id)
    const found = await reminders(a.id)
    assert.deepEqual(
      found.find((item) => item.studentId === 's1'),
      { formId, studentId: 's1', audience: 'student' },
    )
    assert.ok(found.filter((item) => item.studentId !== 's1').every((n) => n.audience === 'parent'))
  })

  test('DOM-YTK-040: communication kapalıyken hatırlatma günündeki forma da iş yazmaz', async () => {
    const off = await institution({ enabledModules: { communication: false } })
    // Modül kapalıyken uçtan form açılamaz; açıkken açılmış formun kaydı doğrudan yazılır.
    await insertMissingRecords(
      db,
      off.id,
      [
        {
          collection: 'permissionForms',
          id: 'pf-test-kapali-modul',
          data: {
            id: 'pf-test-kapali-modul',
            ...FORM,
            targetStudentIds: [],
            studentIds: C1_STUDENTS,
            teacherId: 't1',
            status: 'open',
            closedAt: null,
            createdBy: { role: 'ogretmen', userId: 'u-test' },
            createdAt: '2026-10-01T09:00:00.000Z',
            updatedAt: '2026-10-01T09:00:00.000Z',
          },
        },
      ],
      FIXED_NOW,
    )
    assert.deepEqual(await run(off.id), {
      forms: 0,
      reminded: 0,
      created: 0,
      deduplicated: 0,
      skipped: 'module_disabled',
    })
    assert.deepEqual(await reminders(off.id), [])
  })

  test('IST-002: iş yalnız kendi kurumuna yazar; başka kurumun formu hatırlatılmaz', async () => {
    const a = await institution()
    const b = await institution()
    await open(await teacher(b.id))
    const before = await reminders(b.id)
    assert.deepEqual(await run(a.id), {
      forms: 0,
      reminded: 0,
      created: 0,
      deduplicated: 0,
      skipped: null,
    })
    assert.deepEqual(await reminders(a.id), [])
    assert.deepEqual(await reminders(b.id), before)
    assert.ok((await run(b.id)).created > 0)
  })
})
