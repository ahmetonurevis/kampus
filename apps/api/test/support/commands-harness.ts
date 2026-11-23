import assert from 'node:assert/strict'
import { after, before } from 'node:test'

import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { runAssessment } from '@kampus/school-core/lib/assessment-automation.ts'

import type { App } from '../../src/app.ts'
import type { Role } from '../../src/auth.ts'
import type { Database } from '../../src/db/client.ts'
import { recordKey, type CollectionName } from '../../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../../src/db/records.ts'
import type { MembershipLinkInput } from '../../src/services/identity.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './app.ts'

/**
 * Yazma uçları testlerinin ortak donanımı (api-tasarimi.md §1, §6, §7): örnek veri kesiti ve
 * kurum, üye, istek ve sürüm yardımcıları. `commands.test.ts` (ortak envanter, Onur: yenileme)
 * ve `platform-commands.test.ts` (Oğuzhan'ın uç testleri) `useCommandsHarness()` çağırır.
 * Her test kendi kurumunu örnek veri kesitiyle kurar; başarısızlıkta kaydın değişmediği satır
 * sürümüyle doğrulanır.
 */

export const DAY = '2026-10-06'
/** Etüt planındaki ilk etüdün ertesi: yoklama artık geçmiş etüde alınır. */
export const AFTER_TUTORING = new Date('2026-10-21T10:00:00.000Z')

/** Optik değerlendirmesi yapılmış örnek veri: etüt planı eksik kazanımlardan çıkar. */
export function evaluatedSeed(): State {
  const state = createSeed(FIXED_NOW)
  let serial = 0
  runAssessment(
    state,
    { role: 'yonetici' },
    'evaluate',
    { profileId: 'optical-exam-7-1', text: 'student;booklet;answers\n2026001;A;BBBDABCDABCD' },
    (prefix) => `${prefix}-test-${++serial}`,
    '',
    FIXED_NOW.toISOString(),
  )
  return state
}

export const SEED = evaluatedSeed()
export const CLASS_IDS = ['c1', 'c2', 'c3']
export const classStudents = (classId: string) =>
  SEED.students.filter((item) => item.classId === classId && item.isActive)
/** c3 ile aynı düzeydeki sınıf: arşivde öğrencilerin aktarıldığı hedef (öğrencileri kesitte yok). */
const sameLevel = SEED.classes.find(
  (item) => item.id !== 'c3' && item.level === SEED.classes.find((c) => c.id === 'c3')?.level,
)
if (!sameLevel) throw new Error('örnek veride c3 ile aynı düzeyde sınıf yok')
export const SAME_LEVEL = sameLevel
export const SAMPLE_STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)

/** Kurumun örnek kesiti: üç sınıf ve öğrencileri, kadro, bağlı kayıtlar. */
export const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => [...CLASS_IDS, SAME_LEVEL.id].includes(item.id)),
  students: SEED.students.filter((item) => SAMPLE_STUDENT_IDS.has(item.id)),
  parents: SEED.parents.filter((item) => item.id === 'p1'),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  schedule: SEED.schedule.filter((item) => CLASS_IDS.includes(item.classId)),
  availability: SEED.availability,
  invoices: SEED.invoices.filter((item) => SAMPLE_STUDENT_IDS.has(item.studentId)),
  mockExams: SEED.mockExams,
  mockResults: SEED.mockResults,
  opticalProfiles: SEED.opticalProfiles,
  opticalEvaluations: SEED.opticalEvaluations,
  studentGoals: SEED.studentGoals,
  guidanceCases: SEED.guidanceCases,
  appointments: SEED.appointments,
  schoolEvents: SEED.schoolEvents,
  clubs: SEED.clubs,
  clubMemberships: SEED.clubMemberships,
}

export function rows(sample: Partial<Record<CollectionName, readonly Record<string, unknown>[]>>) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

const unpaid = SEED.invoices.find((item) => item.studentId === 's1' && !item.paidAt)
if (!unpaid) throw new Error('örnek veride s1 taksitleri eksik')
export const UNPAID = unpaid

/** c1'de sonucu girilmemiş öğrenci (sınav düzeyi c1'in düzeyidir). */
const resultless = classStudents('c1').find(
  (student) =>
    !SEED.mockResults.some((item) => item.studentId === student.id && item.examId === 'exam-7-1'),
)
if (!resultless) throw new Error('örnek veride sonucu olmayan c1 öğrencisi yok')
export const RESULTLESS = resultless

/** c1'de dersi, danışmanlığı ve kulübü olmayan öğretmen (kapsamı c1'i içermez). */
const outsideTeacher = SEED.teachers.find(
  (teacher) =>
    teacher.isActive &&
    !teacher.guidanceCounselor &&
    !SEED.classes.some((item) => item.id === 'c1' && item.teacherId === teacher.id) &&
    !SEED.assignments.some((item) => item.classId === 'c1' && item.teacherId === teacher.id) &&
    !SEED.clubs.some((item) => item.teacherId === teacher.id),
)
if (!outsideTeacher) throw new Error('örnek veride kapsam dışı öğretmen yok')
export const OUTSIDE_TEACHER = outsideTeacher

/** Yönetici yoklaması düzeltmedir ve gerekçe ister (DOM-AKD-035, core `attendance.record`). */
export const REASON = 'Öğretmen raporlu'

export const marksFor = (classId: string, status = 'present') =>
  Object.fromEntries(classStudents(classId).map((student) => [student.id, status]))

// Uygulama ve veritabanı `useCommandsHarness` kancalarında kurulur; `let` dışa aktarımları canlı
// bağdır, testler import ettikleri adı çağrı anında okur.
export let db: Database
export let app: App
/** Etüt yoklaması için saat ileri alınmış ikinci uygulama (aynı veritabanı). */
export let later: App
let close: () => Promise<void>

/** Çağıran `describe` içinde veritabanını ve iki uygulamayı kurar, bitince kapatır. */
export function useCommandsHarness() {
  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
    later = await buildTestApp(db, { clock: () => AFTER_TUTORING })
  })
  after(async () => {
    await later.close()
    await app.close()
    await close()
  })
}

export async function institution(overrides: Partial<InstitutionOverrides> = {}) {
  const created = await createInstitution(app, overrides)
  await insertMissingRecords(db, created.id, rows(SAMPLE), FIXED_NOW)
  return { ...created, adminCookie: await signInAs(app, created.admin) }
}

export async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
  return signInAs(app, await createMember(app, institutionId, role, links))
}

export function send(
  method: 'POST' | 'DELETE',
  url: string,
  cookie: string | null,
  body?: unknown,
  headers: Record<string, string> = {},
  target: App = app,
) {
  return target.inject({
    method,
    url,
    headers: {
      origin: TEST_ORIGIN,
      ...(cookie === null ? {} : { cookie }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  })
}

export const post = (
  url: string,
  cookie: string | null,
  body: unknown = {},
  headers: Record<string, string> = {},
) => send('POST', url, cookie, body, headers)

export async function version(institutionId: string, collection: CollectionName, id: string) {
  return (await findRecord(db, institutionId, collection, id, { includeArchived: true }))?.version
}

export async function count(institutionId: string, collection: CollectionName) {
  return (await loadRecords(db, institutionId, [collection])).length
}

export function assertError(
  response: Awaited<ReturnType<typeof post>>,
  statusCode: number,
  code?: string,
) {
  assert.equal(response.statusCode, statusCode, response.body)
  if (code !== undefined) assert.equal(response.json().code, code)
}
