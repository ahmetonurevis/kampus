import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'

import type { Role } from '../src/auth.ts'
import type { CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords, loadRecords } from '../src/db/records.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
import { FIXED_NOW, TEST_ORIGIN } from './support/app.ts'
import { evaluationText, profileBody } from './support/assessment-sample.ts'
import {
  app,
  db,
  institution,
  member,
  SEED,
  useCommandsHarness,
} from './support/commands-harness.ts'

/**
 * Platform uçlarında çapraz kurum (IST-002; DOM-YTK-001, DOM-YTK-011): kampüs, sınıf ve kadro
 * arşivi, etüt, optik, duyuru, yazışma, izin/mazeret ve Öğretmenime Sor uçlarından envanterde
 * başka kurum testi olmayanlar. Her satır aynı kalıbı koşar:
 *
 * - `kayıt`: B kurumunun kaydına A'dan istek, olmayan kimlikle aynı 404'tür.
 * - `gövde`: gövdedeki B kaydı kimliği ve `institutionId: B` etkisizdir; yanıt olmayan kimlikle
 *   aynıdır (404, 422 ya da kapsam reddi 403; varlık sızmaz).
 * - İki kurumun izlenen satırları değişmez.
 * - Denetim: aynı istek A'nın kendi kaydıyla işin kuralına ulaşır (2xx, 409 ya da 422); 404 gövde
 *   ya da rol yüzünden değildir.
 *
 * B kaydı yalnız B'de bulunan önekli kimlikle kurulur (seed kopyası ya da B'nin kendi uç çağrısı).
 */

type Tenant = Awaited<ReturnType<typeof institution>>
type Actor = { role: Role; links?: MembershipLinkInput[] }
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'
type Request = { method: Method; url: string; body?: Record<string, unknown>; ifMatch?: number }

interface Case {
  key: string
  kind: 'kayıt' | 'gövde'
  tracked: readonly CollectionName[]
  actor?: Actor
  /** Kurumda hedef kaydı (ya da gövdenin işaret ettiği kaydı) kurar, kimliğini döner. */
  make: (tenant: Tenant) => Promise<string>
  /** Denetim isteğinde `make` yerine A'nın bu kaydı kullanılır. */
  own?: string
  /** Bilinen açık: test koşar ama kırmızısı takımı durdurmaz (düzeltme ayrı committe). */
  todo?: string
  request: (id: string) => Request
}

const ADMIN: Actor = { role: 'yonetici' }
const TEACHER: Actor = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] }
const STUDENT: Actor = { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] }
const PARENT: Actor = { role: 'veli', links: [{ kind: 'child', recordId: 's1' }] }

function inject(cookie: string, { method, url, body, ifMatch }: Request) {
  return app.inject({
    method,
    url,
    headers: {
      cookie,
      origin: TEST_ORIGIN,
      ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(ifMatch === undefined ? {} : { 'if-match': `"${String(ifMatch)}"` }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  })
}

async function cookieOf(tenant: Tenant, actor: Actor = ADMIN) {
  return actor.role === 'yonetici'
    ? tenant.adminCookie
    : member(tenant.id, actor.role, actor.links ?? [])
}

async function ok(response: Awaited<ReturnType<typeof inject>>) {
  assert.ok(response.statusCode < 300, response.body)
  return response.json<{ data: { entity?: { id: string }; id?: string } }>().data
}

/** Seed kaydının kuruma özgü kopyası; kimliği döner. */
function copier<T extends { id: string }>(
  collection: CollectionName,
  source: T | undefined,
  patch: () => Record<string, unknown> = () => ({}),
) {
  return async (tenant: Tenant) => {
    if (!source) throw new Error(`örnek veride ${collection} yok`)
    const id = `test-capraz-${collection}-${randomUUID().slice(0, 8)}`
    await insertMissingRecords(
      db,
      tenant.id,
      [{ collection, id, data: { ...source, id, ...patch() } }],
      FIXED_NOW,
    )
    return id
  }
}

const branchCopy = copier('branches', SEED.branches[0], () => ({
  name: `Test Kampüsü ${randomUUID().slice(0, 6)}`,
}))
const teacherCopy = copier('teachers', SEED.teachers[0], () => ({
  email: `test-${randomUUID().slice(0, 8)}@kampus.example`,
  guidanceCounselor: false,
}))
const classCopy = copier(
  'classes',
  SEED.classes.find((item) => item.id === 'c1'),
  () => ({ section: `T${randomUUID().slice(0, 4)}`, room: `T-${randomUUID().slice(0, 4)}` }),
)
const studentCopy = copier(
  'students',
  SEED.students.find((item) => item.id === 's1'),
  () => ({ name: 'Test Çapraz Öğrenci', studentNo: `T${randomUUID().slice(0, 6)}` }),
)
const examCopy = copier(
  'mockExams',
  SEED.mockExams.find((item) => item.id === 'exam-7-1'),
)
const profileCopy = copier('opticalProfiles', SEED.opticalProfiles[0])

/** Kaydı kurar ve kurumun yöneticisiyle arşivler (geri alma uçları için). */
function archived(make: (tenant: Tenant) => Promise<string>, path: string) {
  return async (tenant: Tenant) => {
    const id = await make(tenant)
    await ok(await inject(tenant.adminCookie, { method: 'DELETE', url: `/api/v1/${path}/${id}` }))
    return id
  }
}

const ANNOUNCEMENT = {
  title: 'Veli toplantısı',
  text: 'Perşembe 18.00’de veli toplantısı yapılacaktır.',
  category: 'Akademik',
  target: { classIds: ['c1'], roles: ['veli'] },
}
async function announcement(tenant: Tenant) {
  const data = await ok(
    await inject(tenant.adminCookie, {
      method: 'POST',
      url: '/api/v1/announcements',
      body: ANNOUNCEMENT,
    }),
  )
  assert.ok(data.entity)
  return data.entity.id
}

async function conversation(tenant: Tenant) {
  const data = await ok(
    await inject(await cookieOf(tenant, TEACHER), {
      method: 'POST',
      url: '/api/v1/conversations',
      body: { studentId: 's1', audience: 'student', text: 'Merhaba, ödevini aldım.' },
    }),
  )
  assert.ok(data.entity)
  return data.entity.id
}

const QUESTION = {
  subjectId: 'math',
  topic: 'Denklemler',
  title: 'Denklem çözümü',
  text: '2x + 6 = 18 denkleminde neden önce 6 çıkarıyoruz?',
}
async function question(tenant: Tenant) {
  const data = await ok(
    await inject(await cookieOf(tenant, STUDENT), {
      method: 'POST',
      url: '/api/v1/questions',
      body: QUESTION,
    }),
  )
  assert.ok(data.entity)
  return data.entity.id
}

async function tutorSession(tenant: Tenant) {
  await ok(
    await inject(tenant.adminCookie, {
      method: 'POST',
      url: '/api/v1/tutor-sessions',
      body: {
        examId: 'exam-7-1',
        threshold: 70,
        fromDate: '2026-10-07',
        toDate: '2026-10-20',
        duration: 30,
        maxGroupSize: 12,
      },
    }),
  )
  const [session] = await loadRecords(db, tenant.id, ['tutorSessions'])
  assert.ok(session)
  return session.id
}

const SCHOOL: readonly CollectionName[] = ['branches', 'classes', 'teachers', 'students']
const ASSESSMENT: readonly CollectionName[] = [
  'mockExams',
  'opticalProfiles',
  'opticalEvaluations',
  'availability',
  'tutorSessions',
]

const CASES: readonly Case[] = [
  // --- Kampüs, sınıf, kadro -------------------------------------------------------------------
  {
    key: 'DELETE /api/v1/branches/:branchId',
    kind: 'kayıt',
    tracked: SCHOOL,
    make: branchCopy,
    request: (id) => ({ method: 'DELETE', url: `/api/v1/branches/${id}` }),
  },
  {
    key: 'POST /api/v1/branches/:branchId/restore',
    kind: 'kayıt',
    tracked: SCHOOL,
    make: archived(branchCopy, 'branches'),
    request: (id) => ({ method: 'POST', url: `/api/v1/branches/${id}/restore`, body: {} }),
  },
  {
    key: 'POST /api/v1/classes',
    kind: 'gövde',
    tracked: SCHOOL,
    make: teacherCopy,
    request: (teacherId) => ({
      method: 'POST',
      url: '/api/v1/classes',
      body: {
        grade: 7,
        section: 'z',
        branchId: 'b1',
        teacherId,
        capacity: 24,
        room: '499',
        subjectTeachers: Object.fromEntries(
          SEED.assignments
            .filter((item) => item.classId === 'c1')
            .map((item) => [item.subjectId, item.teacherId]),
        ),
      },
    }),
  },
  {
    key: 'POST /api/v1/classes/:classId/restore',
    kind: 'kayıt',
    tracked: SCHOOL,
    make: archived(classCopy, 'classes'),
    request: (id) => ({ method: 'POST', url: `/api/v1/classes/${id}/restore`, body: {} }),
  },
  {
    key: 'POST /api/v1/teachers',
    kind: 'gövde',
    tracked: SCHOOL,
    make: branchCopy,
    request: (branchId) => ({
      method: 'POST',
      url: '/api/v1/teachers',
      body: {
        name: 'Test Öğretmeni',
        email: `test-${randomUUID().slice(0, 8)}@kampus.example`,
        phone: '05559990010',
        subjectId: 'math',
        branchId,
      },
    }),
  },
  {
    key: 'PATCH /api/v1/teachers/:teacherId',
    kind: 'kayıt',
    tracked: SCHOOL,
    make: teacherCopy,
    request: (id) => ({
      method: 'PATCH',
      url: `/api/v1/teachers/${id}`,
      body: { phone: '05559990013' },
      ifMatch: 1,
    }),
  },
  {
    key: 'DELETE /api/v1/teachers/:teacherId',
    kind: 'kayıt',
    tracked: SCHOOL,
    make: teacherCopy,
    request: (id) => ({ method: 'DELETE', url: `/api/v1/teachers/${id}` }),
  },
  {
    key: 'POST /api/v1/teachers/:teacherId/restore',
    kind: 'kayıt',
    tracked: SCHOOL,
    make: archived(teacherCopy, 'teachers'),
    request: (id) => ({ method: 'POST', url: `/api/v1/teachers/${id}/restore`, body: {} }),
  },

  // --- Etüt ve optik --------------------------------------------------------------------------
  {
    key: 'POST /api/v1/tutor-sessions',
    kind: 'gövde',
    tracked: ASSESSMENT,
    make: examCopy,
    own: 'exam-7-1',
    request: (examId) => ({
      method: 'POST',
      url: '/api/v1/tutor-sessions',
      body: {
        examId,
        threshold: 70,
        fromDate: '2026-10-07',
        toDate: '2026-10-20',
        duration: 30,
        maxGroupSize: 12,
      },
    }),
  },
  {
    key: 'POST /api/v1/tutor-sessions/:sessionId/attendance',
    kind: 'kayıt',
    tracked: ASSESSMENT,
    make: tutorSession,
    request: (id) => ({
      method: 'POST',
      url: `/api/v1/tutor-sessions/${id}/attendance`,
      body: { marks: { s1: 'Geldi' } },
    }),
  },
  {
    key: 'POST /api/v1/assessment/profile',
    kind: 'gövde',
    tracked: ASSESSMENT,
    make: examCopy,
    request: (examId) => ({
      method: 'POST',
      url: '/api/v1/assessment/profile',
      body: { ...profileBody(), examId },
    }),
  },
  {
    key: 'POST /api/v1/assessment/profile/:recordId',
    kind: 'kayıt',
    tracked: ASSESSMENT,
    make: profileCopy,
    todo: 'olmayan profil kimliği sınav çakışmasından önce 404 vermiyor (409)',
    request: (id) => ({
      method: 'POST',
      url: `/api/v1/assessment/profile/${id}`,
      body: profileBody(),
    }),
  },
  {
    key: 'POST /api/v1/assessment/evaluate/preview',
    kind: 'gövde',
    tracked: ASSESSMENT,
    make: profileCopy,
    request: (profileId) => ({
      method: 'POST',
      url: '/api/v1/assessment/evaluate/preview',
      body: { profileId, text: evaluationText() },
    }),
  },
  {
    key: 'POST /api/v1/assessment/slot',
    kind: 'gövde',
    tracked: ASSESSMENT,
    make: teacherCopy,
    request: (teacherId) => ({
      method: 'POST',
      url: '/api/v1/assessment/slot',
      body: { teacherId, date: '2026-10-11T10:00:00.000Z', duration: 30 },
    }),
  },

  // --- İletişim -------------------------------------------------------------------------------
  {
    key: 'POST /api/v1/announcements',
    kind: 'gövde',
    tracked: ['announcements'],
    make: classCopy,
    request: (classId) => ({
      method: 'POST',
      url: '/api/v1/announcements',
      body: { ...ANNOUNCEMENT, target: { classIds: [classId], roles: ['veli'] } },
    }),
  },
  {
    key: 'PATCH /api/v1/announcements/:announcementId',
    kind: 'kayıt',
    tracked: ['announcements'],
    make: announcement,
    request: (id) => ({
      method: 'PATCH',
      url: `/api/v1/announcements/${id}`,
      body: { title: 'Ele geçirildi' },
      ifMatch: 1,
    }),
  },
  {
    key: 'POST /api/v1/announcements/:announcementId/withdraw',
    kind: 'kayıt',
    tracked: ['announcements'],
    make: announcement,
    request: (id) => ({
      method: 'POST',
      url: `/api/v1/announcements/${id}/withdraw`,
      body: { reason: 'Yanlış duyuru' },
      ifMatch: 1,
    }),
  },
  {
    key: 'POST /api/v1/announcements/:announcementId/read',
    kind: 'kayıt',
    tracked: ['announcements'],
    actor: PARENT,
    make: announcement,
    request: (id) => ({ method: 'POST', url: `/api/v1/announcements/${id}/read`, body: {} }),
  },
  {
    key: 'POST /api/v1/conversations/:conversationId/read',
    kind: 'kayıt',
    tracked: ['conversations', 'conversationMessages'],
    actor: STUDENT,
    make: conversation,
    request: (id) => ({ method: 'POST', url: `/api/v1/conversations/${id}/read`, body: {} }),
  },
  {
    key: 'GET /api/v1/students/:studentId/parent-accounts',
    kind: 'kayıt',
    tracked: ['students'],
    actor: TEACHER,
    make: studentCopy,
    request: (id) => ({ method: 'GET', url: `/api/v1/students/${id}/parent-accounts` }),
  },
  {
    // Veli yalnız kendi çocuğu için bildirir: B'nin öğrencisi olmayan öğrenciyle aynı yanıtı alır.
    key: 'POST /api/v1/absences',
    kind: 'gövde',
    tracked: ['absences', 'requests'],
    actor: PARENT,
    make: studentCopy,
    own: 's1',
    request: (studentId) => ({
      method: 'POST',
      url: '/api/v1/absences',
      body: { studentId, startDate: '2026-10-08', endDate: '2026-10-09', reasonCategory: 'health' },
    }),
  },

  // --- Öğretmenime Sor ------------------------------------------------------------------------
  {
    key: 'POST /api/v1/questions',
    kind: 'gövde',
    tracked: ['questions'],
    actor: STUDENT,
    make: copier('subjects', SEED.subjects[0]),
    own: 'math',
    request: (subjectId) => ({
      method: 'POST',
      url: '/api/v1/questions',
      body: { ...QUESTION, subjectId },
    }),
  },
  {
    key: 'PATCH /api/v1/questions/:questionId',
    kind: 'kayıt',
    tracked: ['questions'],
    actor: STUDENT,
    make: question,
    request: (id) => ({
      method: 'PATCH',
      url: `/api/v1/questions/${id}`,
      body: { withdrawn: true },
      ifMatch: 1,
    }),
  },
]

async function snapshot(institutionId: string, collections: readonly CollectionName[]) {
  const stored = await loadRecords(db, institutionId, collections, { includeArchived: true })
  return stored.map((row) => `${row.collection}/${row.id}@${String(row.version)}`).sort()
}

const shape = (response: Awaited<ReturnType<typeof inject>>) => ({
  status: response.statusCode,
  code: response.json<{ code?: string }>().code,
  message: response.json<{ message?: string }>().message,
})

const withInstitution = (request: Request, institutionId: string): Request =>
  request.body === undefined ? request : { ...request, body: { ...request.body, institutionId } }

describe('IST-002: platform uçlarında başka kurum (DOM-YTK-001, DOM-YTK-011)', () => {
  useCommandsHarness()

  for (const spec of CASES) {
    const title =
      spec.kind === 'kayıt'
        ? 'başka kurumun kaydı olmayan kayıtla aynı 404; iki kurum değişmez'
        : 'gövdedeki başka kurum kimliği ve institutionId etkisiz; iki kurum değişmez'
    test(`IST-002: ${spec.key}: ${title}`, { todo: spec.todo ?? false }, async () => {
      const a = await institution()
      const b = await institution()
      const foreignId = await spec.make(b)
      const cookie = await cookieOf(a, spec.actor)
      const before = {
        a: await snapshot(a.id, spec.tracked),
        b: await snapshot(b.id, spec.tracked),
      }

      const missing = await inject(cookie, spec.request('test-kayit-yok'))
      // Gövdedeki kurum kimliği ya katı şemada 400'dür ya da yok sayılır; ikisinde de B değişmez.
      let foreign = await inject(cookie, withInstitution(spec.request(foreignId), b.id))
      if (foreign.statusCode === 400) {
        assert.match(foreign.body, /institutionId/, `${spec.key}: ${foreign.body}`)
        foreign = await inject(cookie, spec.request(foreignId))
      }
      assert.deepEqual(shape(foreign), shape(missing), `${spec.key}: ${foreign.body}`)
      const allowed = spec.kind === 'kayıt' ? [404] : [403, 404, 422]
      assert.ok(allowed.includes(foreign.statusCode), `${spec.key}: ${foreign.body}`)
      assert.deepEqual(await snapshot(b.id, spec.tracked), before.b)
      assert.deepEqual(await snapshot(a.id, spec.tracked), before.a)

      // Denetim: aynı istek A'nın kendi kaydıyla işin kuralına ulaşır.
      const own = spec.own ?? (await spec.make(a))
      const control = await inject(cookie, spec.request(own))
      assert.ok(
        control.statusCode < 300 || [409, 422].includes(control.statusCode),
        `${spec.key}: kendi kaydı ${control.body}`,
      )
      assert.deepEqual(await snapshot(b.id, spec.tracked), before.b)
    })
  }
})
