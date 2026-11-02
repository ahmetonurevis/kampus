import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'

import type { WorkflowCommand } from '@kampus/school-core/lib/school-workflows.ts'
import { WORKFLOW_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { Role } from '../src/auth.ts'
import type { CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { feeTariffs } from '../src/db/schema/fee-tariffs.ts'
import { WORKFLOW_ROUTES } from '../src/routes/workflows.schemas.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import { FIXED_NOW } from './support/app.ts'
import {
  DAY,
  db,
  institution,
  member,
  post,
  SEED,
  useCommandsHarness,
} from './support/commands-harness.ts'

/**
 * İş akışı köprüsünde çapraz kurum (IST-002; DOM-YTK-001, DOM-YTK-011). Her komut ayrı rotadır
 * (`POST /workflows/:command[/:recordId]`); kayıt alan her komutta B kurumunun kaydına A'dan
 * gerçek gövdeyle yazma 404 döner, `If-Match` B'nin sürümünü taşısa da 404'tür (sürüm denetimi
 * varlığı sızdırmaz), yanıt olmayan kimlikle aynıdır ve iki kurumun satırları değişmez.
 * Kimliksiz oluşturan her komutta gövdedeki `institutionId: B` ve B'ye ait bağlı kayıt kimliği
 * etkisizdir: yanıt olmayan kimlikle aynıdır, B'ye hiçbir şey yazılmaz.
 *
 * B kaydı yalnız B'de bulunan önekli kimlikle seed kopyasından kurulur; seed kimlikleri (s1, c1…)
 * iki kurumda da bulunduğundan çapraz kurum sınamasında kullanılmaz.
 */

type Actor = { role: Role; links?: MembershipLinkInput[]; query?: string }
const ADMIN: Actor = { role: 'yonetici' }
const STUDENT: Actor = { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] }
const TEACHER: Actor = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] }
const PARENT: Actor = {
  role: 'veli',
  links: [{ kind: 'child', recordId: 's1' }],
  query: '?childId=s1',
}

type Row = { collection: CollectionName; id: string; data: Record<string, unknown> }

/** Seed kaydının yalnız B'de bulunan kopyası. */
function copy<T extends { id: string }>(
  collection: CollectionName,
  items: readonly T[],
  id: string,
  patch: Record<string, unknown> = {},
): Row {
  const source = items[0]
  if (!source) throw new Error(`örnek veride ${collection} yok`)
  return { collection, id, data: { ...source, id, ...patch } }
}

const B_STUDENT = copy('students', SEED.students, 'test-b-ogrenci', { classId: 'c1' })
const B_BRANCH = copy('branches', SEED.branches, 'test-b-sube')
const B_CLASS = copy('classes', SEED.classes, 'test-b-sinif', { branchId: 'b1' })
const B_SUBJECT = copy('subjects', SEED.subjects, 'test-b-ders')
const B_ROUTE = copy('transportRoutes', SEED.transportRoutes, 'test-b-servis')
const B_CLUB = copy('clubs', SEED.clubs, 'test-b-kulup')
const B_GOAL = copy('studentGoals', SEED.studentGoals, 'test-b-hedef', { studentId: 's1' })
const B_RENEWAL: Row = {
  collection: 'renewals',
  id: 'test-b-yenileme',
  data: {
    id: 'test-b-yenileme',
    studentId: 's1',
    fromClassId: 'c1',
    targetClassId: 'c2',
    year: 2027,
    mode: 'renew',
    amount: 2_850_000,
    status: 'Planlandı',
    createdAt: FIXED_NOW.toISOString(),
    updatedAt: FIXED_NOW.toISOString(),
  },
}

const LESSON = {
  classId: 'c1',
  teacherId: 't1',
  subjectId: 'math',
  date: '2026-10-18T06:00:00Z',
  duration: 40,
  room: '101',
}
const ROUTE = {
  title: 'Moda – Kadıköy',
  branchId: 'b1',
  plate: '34 TEST 01',
  driver: 'Test Sürücü',
  phone: '05550000000',
  capacity: 20,
  stops: 'Moda, Kampüs',
}
const MEAL = { branchId: 'b1', date: DAY, title: 'Çorba ve pilav', allergens: 'Gluten' }

/**
 * Kayıt alan komut: hedef kaydın B kopyası, gerçek gövde ve komutu çalıştırabilen A rolü. Denetim
 * isteği aynı gövdeyi A'daki kopyaya (`own` verilirse A'nın o kaydına) gönderir ve geçmelidir.
 */
type RecordCase = { target: Row; body: Record<string, unknown>; actor: Actor; own?: string }
const RECORD_CASES: Record<string, RecordCase> = {
  'goal-review': {
    target: copy('studentGoals', SEED.studentGoals, 'test-b-hedef-onay', {
      studentId: 's1',
      status: 'Onay bekliyor',
    }),
    body: { status: 'Aktif', feedback: '' },
    actor: ADMIN,
  },
  'goal-step': {
    target: B_GOAL,
    body: { title: 'Tekrar', topic: '', dueDate: '2026-10-20' },
    actor: ADMIN,
  },
  'goal-step-done': { target: B_GOAL, body: { stepId: 'step-s1-2' }, actor: STUDENT },
  'goal-suggest': { target: B_GOAL, body: {}, actor: ADMIN },
  'goal-comment': { target: B_GOAL, body: { text: 'Destekliyoruz.' }, actor: ADMIN },
  'goal-close': { target: B_GOAL, body: {}, actor: ADMIN },
  'guidance-note': {
    target: copy('guidanceCases', SEED.guidanceCases, 'test-b-rehberlik', { teacherId: 't1' }),
    body: { text: 'Görüşme yapıldı.', sharedNote: '', followUp: '2026-10-20', status: 'Takipte' },
    actor: TEACHER,
  },
  'renewal-activate': { target: B_RENEWAL, body: {}, actor: ADMIN },
  lesson: {
    target: copy('schedule', SEED.schedule, 'test-b-ders-saati'),
    body: LESSON,
    actor: ADMIN,
  },
  // Pazar günkü matematik dersi başka öğretmende; vekil dersin branşındaki t1'dir.
  substitute: {
    target: copy('schedule', SEED.schedule, 'test-b-ders-saati', {
      teacherId: 't3',
      date: LESSON.date,
    }),
    body: { teacherId: 't1', reason: 'Öğretmen raporlu' },
    actor: ADMIN,
  },
  'lesson-cancel': {
    target: copy('schedule', SEED.schedule, 'test-b-ders-saati'),
    body: {},
    actor: ADMIN,
  },
  'study-complete': {
    target: copy('studyTasks', SEED.studyTasks, 'test-b-calisma', { studentId: 's1' }),
    body: { completionNote: 'Tamamladım.' },
    actor: STUDENT,
  },
  'study-review': {
    target: copy('studyTasks', SEED.studyTasks, 'test-b-calisma', {
      status: 'Değerlendirme bekliyor',
    }),
    body: { feedback: 'Güzel çalışma.', status: 'Onaylandı' },
    actor: ADMIN,
  },
  consent: {
    target: copy('schoolEvents', SEED.schoolEvents, 'test-b-etkinlik'),
    body: { decision: 'Onaylandı', note: '' },
    actor: PARENT,
  },
  'event-cancel': {
    target: copy('schoolEvents', SEED.schoolEvents, 'test-b-etkinlik'),
    body: {},
    actor: ADMIN,
  },
  route: { target: B_ROUTE, body: ROUTE, actor: ADMIN },
  'route-archive': { target: B_ROUTE, body: {}, actor: ADMIN },
  'transport-remove': {
    target: copy('transportAssignments', SEED.transportAssignments, 'test-b-servis-atama'),
    body: {},
    actor: ADMIN,
  },
  meal: { target: copy('mealMenus', SEED.mealMenus, 'test-b-menu'), body: MEAL, actor: ADMIN },
  'club-enroll': { target: B_CLUB, body: { studentId: 's1' }, actor: ADMIN },
  'club-leave': {
    target: copy('clubMemberships', SEED.clubMemberships, 'test-b-uyelik'),
    body: {},
    actor: ADMIN,
  },
  'club-attendance': {
    target: B_CLUB,
    body: { date: DAY, marks: { s1: 'Geldi', s2: 'Geldi' } },
    actor: ADMIN,
    own: 'club-science',
  },
  'club-archive': { target: B_CLUB, body: {}, actor: ADMIN },
}

/**
 * Kimliksiz oluşturan komut: gövdenin B'ye ait kayda işaret eden kimliği (`ref` yerine konur) ve
 * o kaydın B kopyası. Denetim isteği A'daki kopyayla (`own` verilirse A'nın o kaydıyla) geçer;
 * `setup` iki kurumu da hazırlar (ör. yayımlanmış tarife).
 */
type CreateCase = {
  foreign: Row
  body: (ref: string) => Record<string, unknown>
  actor: Actor
  own?: string
  setup?: (institutionId: string) => Promise<void>
}
const CREATE_CASES: Record<string, CreateCase> = {
  goal: {
    foreign: B_STUDENT,
    body: (studentId) => ({
      studentId,
      subjectId: 'science',
      title: 'Fen netini artır',
      targetNet: 15,
      deadline: '2026-12-15',
    }),
    actor: ADMIN,
  },
  guidance: {
    foreign: B_STUDENT,
    body: (studentId) => ({
      studentId,
      teacherId: 't1',
      title: 'Çalışma alışkanlığı',
      plan: 'Haftalık görüşme planı.',
      sharedNote: '',
      followUp: '2026-10-20',
    }),
    actor: ADMIN,
  },
  exam: {
    foreign: B_SUBJECT,
    body: (subjectId) => ({
      title: 'Test denemesi',
      type: 'Okul denemesi',
      grade: 7,
      wrongPenalty: 4,
      date: '2026-10-20',
      subjectIds: [subjectId],
    }),
    actor: ADMIN,
    own: 'math',
  },
  'exam-result': {
    foreign: B_STUDENT,
    body: (studentId) => ({
      examId: 'exam-7-1',
      studentId,
      subjectId: 'math',
      correct: 10,
      wrong: 5,
      blank: 5,
      weakTopics: 'Denklemler',
    }),
    actor: ADMIN,
  },
  'exam-import': {
    foreign: B_STUDENT,
    body: (studentId) => ({
      csv: `examId;studentId;subjectId;correct;wrong;blank;weakTopics\nexam-7-1;${studentId};math;12;5;3;Denklemler`,
    }),
    actor: ADMIN,
  },
  renewal: {
    foreign: B_STUDENT,
    body: (studentId) => ({
      studentId,
      targetClassId: 'c1',
      year: 2027,
      mode: 'renew',
      total: 28_500,
      scholarship: 0,
      discount: 0,
      count: 8,
      startDate: '2026-11-15',
    }),
    actor: ADMIN,
    own: 's3',
    setup: publishTuition,
  },
  lesson: {
    foreign: B_CLASS,
    body: (classId) => ({ ...LESSON, classId }),
    actor: ADMIN,
    own: 'c1',
  },
  'study-task': {
    foreign: B_STUDENT,
    body: (studentId) => ({
      studentId,
      subjectId: 'math',
      topic: 'Denklemler',
      title: 'Haftalık tekrar',
      instructions: 'Beş soru çöz.',
      dueDate: '2026-10-12',
      minutes: 30,
    }),
    actor: ADMIN,
  },
  event: {
    foreign: B_BRANCH,
    body: (branchId) => ({
      title: 'Bilim gezisi',
      classId: '',
      branchId,
      date: '2026-10-20T09:00:00Z',
      endDate: '2026-10-20T12:00:00Z',
      location: 'Müze',
      description: 'Gözlem gezisi.',
      requiresConsent: false,
      consentDeadline: '2026-10-18',
    }),
    actor: ADMIN,
  },
  route: { foreign: B_BRANCH, body: (branchId) => ({ ...ROUTE, branchId }), actor: ADMIN },
  'transport-assign': {
    foreign: B_ROUTE,
    body: (routeId) => ({ studentId: 's1', routeId, stop: 'Moda' }),
    actor: ADMIN,
  },
  meal: { foreign: B_BRANCH, body: (branchId) => ({ ...MEAL, branchId }), actor: ADMIN },
  club: {
    foreign: B_BRANCH,
    body: (branchId) => ({
      title: 'Satranç',
      branchId,
      teacherId: 't1',
      capacity: 12,
      description: 'Haftalık satranç çalışması.',
      meeting: 'Cuma 15:30',
    }),
    actor: ADMIN,
    own: 'b1',
  },
  achievement: {
    foreign: B_CLUB,
    body: (clubId) => ({
      studentId: 's1',
      clubId,
      title: 'Turnuva birinciliği',
      description: 'Okullar arası turnuva.',
      date: DAY,
    }),
    actor: ADMIN,
    own: 'club-science',
  },
}

/** Yenilemenin hedef yılı için yayımlanmış öğrenim ücreti (`commands.test.ts` ile aynı satır). */
async function publishTuition(institutionId: string) {
  await db.insert(feeTariffs).values({
    institutionId,
    id: randomUUID(),
    academicYear: 2027,
    versionNumber: 1,
    status: 'published',
    items: [
      {
        kind: 'tuition',
        level: null,
        amountCents: 2_850_000,
        unit: 'year',
        vatBasisPoints: 1000,
        vatEffectiveDate: '2026-01-01',
        announcedAmountCents: 2_850_000,
      },
    ],
    announcedDate: '2026-05-01',
    publishedByUserId: 'test',
    publishedAt: FIXED_NOW,
  })
}

const commandsWith = (kind: 'record' | 'create') =>
  Object.entries(WORKFLOW_ROUTES)
    .filter(([, route]) =>
      kind === 'record' ? route.record !== 'none' : route.record !== 'required',
    )
    .map(([command]) => command as WorkflowCommand)

/** Komutun okuduğu ve yazabileceği koleksiyonların satır sürümleri (kurum başına). */
async function snapshot(institutionId: string, command: WorkflowCommand) {
  const collections = WORKFLOW_COMMANDS[command].collections as readonly CollectionName[]
  const stored = await loadRecords(db, institutionId, collections, { includeArchived: true })
  return stored.map((row) => `${row.collection}/${row.id}@${String(row.version)}`).sort()
}

/** B kaydının A'daki kopyası (denetim isteği için); kimliği döner. */
async function ownCopy(institutionId: string, row: Row) {
  const id = `${row.id}-a`
  await insertMissingRecords(
    db,
    institutionId,
    [{ ...row, id, data: { ...row.data, id } }],
    FIXED_NOW,
  )
  return id
}

async function cookieFor(institutionId: string, actor: Actor) {
  return member(institutionId, actor.role, actor.links ?? [])
}

function headersFor(command: WorkflowCommand, version?: number): Record<string, string> {
  return {
    ...(WORKFLOW_ROUTES[command].idempotency === 'required'
      ? { 'idempotency-key': randomUUID() }
      : {}),
    ...(version === undefined ? {} : { 'if-match': `"${String(version)}"` }),
  }
}

const shape = (response: { statusCode: number; json: () => { code?: string } }) => ({
  status: response.statusCode,
  code: response.json().code,
})

describe('IST-002: iş akışı köprüsünde başka kurum (DOM-YTK-001, DOM-YTK-011)', () => {
  useCommandsHarness()

  test('IST-002: tablolar köprünün bütün komutlarını kapsar', () => {
    assert.deepEqual(Object.keys(RECORD_CASES).sort(), commandsWith('record').sort())
    assert.deepEqual(Object.keys(CREATE_CASES).sort(), commandsWith('create').sort())
  })

  for (const command of commandsWith('record')) {
    test(`IST-002: workflows/${command}: başka kurumun kaydı 404, If-Match B sürümüyle de 404; B değişmez`, async () => {
      const spec = RECORD_CASES[command]
      assert.ok(spec)
      const a = await institution()
      const b = await institution()
      await insertMissingRecords(db, b.id, [spec.target], FIXED_NOW)
      const cookie = await cookieFor(a.id, spec.actor)
      const before = { a: await snapshot(a.id, command), b: await snapshot(b.id, command) }
      const url = (id: string) => `/api/v1/workflows/${command}/${id}${spec.actor.query ?? ''}`

      const missing = await post(url('test-kayit-yok'), cookie, spec.body, headersFor(command))
      assert.equal(missing.statusCode, 404, `${command}: olmayan kayıt ${missing.body}`)
      for (const version of [undefined, 1]) {
        const response = await post(
          url(spec.target.id),
          cookie,
          { ...spec.body, institutionId: b.id },
          headersFor(command, version),
        )
        assert.deepEqual(shape(response), shape(missing), `${command}: ${response.body}`)
        assert.equal(response.json().message, missing.json().message)
      }
      assert.deepEqual(await snapshot(b.id, command), before.b)
      assert.deepEqual(await snapshot(a.id, command), before.a)

      // Denetim: aynı gövde A'nın kendi kopyasında geçer; 404 gövdeden ya da rolden gelmez.
      const ownId = spec.own ?? (await ownCopy(a.id, spec.target))
      const allowed = await post(url(ownId), cookie, spec.body, headersFor(command))
      assert.equal(allowed.statusCode, 200, `${command}: kendi kaydı ${allowed.body}`)
      assert.deepEqual(await snapshot(b.id, command), before.b)
    })
  }

  for (const command of commandsWith('create')) {
    test(`IST-002: workflows/${command}: gövdedeki institutionId ve başka kurumun kimliği etkisiz; B değişmez`, async () => {
      const spec = CREATE_CASES[command]
      assert.ok(spec)
      const a = await institution()
      const b = await institution()
      await insertMissingRecords(db, b.id, [spec.foreign], FIXED_NOW)
      for (const id of [a.id, b.id]) await spec.setup?.(id)
      const cookie = await cookieFor(a.id, spec.actor)
      const before = { a: await snapshot(a.id, command), b: await snapshot(b.id, command) }
      const url = `/api/v1/workflows/${command}${spec.actor.query ?? ''}`

      const missing = await post(url, cookie, spec.body('test-kayit-yok'), headersFor(command))
      const foreign = await post(
        url,
        cookie,
        { ...spec.body(spec.foreign.id), institutionId: b.id },
        headersFor(command),
      )
      // B'deki kimlik A için olmayan kimliktir: yanıt aynıdır, varlık sızmaz.
      assert.deepEqual(shape(foreign), shape(missing), `${command}: ${foreign.body}`)
      assert.ok([404, 422].includes(foreign.statusCode), `${command}: ${foreign.body}`)
      assert.deepEqual(await snapshot(b.id, command), before.b)
      assert.deepEqual(await snapshot(a.id, command), before.a)

      // Denetim: aynı gövde A'nın kendi kaydıyla geçer; ret gövdeden ya da rolden gelmez.
      const ownId = spec.own ?? (await ownCopy(a.id, spec.foreign))
      const allowed = await post(url, cookie, spec.body(ownId), headersFor(command))
      assert.equal(allowed.statusCode, 200, `${command}: kendi kaydı ${allowed.body}`)
      assert.deepEqual(await snapshot(b.id, command), before.b)
    })
  }
})
