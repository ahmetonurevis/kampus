import { createSeed } from '@kampus/school-core/data/seed.ts'

import { recordKey, type CollectionName } from '../../src/db/collections.ts'
import { FIXED_NOW } from './app.ts'

/**
 * Optik değerlendirme ve etüt testlerinin ortak örnek kesiti: örnek veriden, değerlendirilmemiş
 * (sonuçlar API'den girilir). Kimlikler örnek veridendir ve değişmez.
 */
export const SEED = createSeed(FIXED_NOW)

const CLASS_IDS = ['c1', 'c2', 'c3']
export const classStudents = (classId: string) =>
  SEED.students.filter((item) => item.classId === classId && item.isActive)
const SAMPLE_STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)

export const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => SAMPLE_STUDENT_IDS.has(item.id)),
  parents: SEED.parents.filter((item) => item.id === 'p1'),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  schedule: SEED.schedule.filter((item) => CLASS_IDS.includes(item.classId)),
  availability: SEED.availability,
  mockExams: SEED.mockExams,
  mockResults: SEED.mockResults,
  opticalProfiles: SEED.opticalProfiles,
  opticalEvaluations: SEED.opticalEvaluations,
  appointments: SEED.appointments,
  schoolEvents: SEED.schoolEvents,
}

export function sampleRows(sample = SAMPLE) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

/** c1 öğrencilerinin hepsi için cevap dosyası (A kitapçığı, çoğu yanlış: eksik kazanım çıkar). */
export function evaluationText(answers = 'BBBDABCDABCD'): string {
  return [
    'student;booklet;answers',
    ...classStudents('c1').map((student) => `${student.number};A;${answers}`),
  ].join('\n')
}

export const PLAN = {
  examId: 'exam-7-1',
  threshold: 70,
  fromDate: '2026-10-07',
  toDate: '2026-10-20',
  duration: 30,
  maxGroupSize: 12,
}

/** Etüt işlemlerinin okuduğu koleksiyonlar: önizlemenin hiçbirini değiştirmediği denetlenir. */
export const ASSESSMENT_COLLECTIONS = [
  'mockExams',
  'mockResults',
  'opticalProfiles',
  'opticalEvaluations',
  'availability',
  'tutorSessions',
  'schedule',
  'appointments',
  'schoolEvents',
] as const satisfies readonly CollectionName[]

/** Örnek optik profilin gövdesi (`automationSchemas.profile`); `mutate` cevap sütununu değiştirir. */
export function profileBody(mutate: (answer: string) => string = (answer) => answer) {
  const profile = SEED.opticalProfiles[0]
  if (!profile) throw new Error('örnek veride optik profil yok')
  const lines = profile.keyCsv.split('\n')
  return {
    examId: profile.examId,
    title: profile.title,
    format: profile.format,
    identifier: profile.identifier,
    headerLines: profile.headerLines,
    studentStart: profile.studentStart,
    studentLength: profile.studentLength,
    bookletStart: profile.bookletStart,
    bookletLength: profile.bookletLength,
    answersStart: profile.answersStart,
    answersLength: profile.answersLength,
    keyCsv: [
      lines[0],
      ...lines.slice(1).map((line) =>
        line
          .split(';')
          .map((part, index) => (index === 4 ? mutate(part) : part))
          .join(';'),
      ),
    ].join('\n'),
  }
}
