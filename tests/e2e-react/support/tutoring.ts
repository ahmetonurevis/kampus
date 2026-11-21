import { createSeed } from '../../../packages/school-core/src/data/seed.ts'
import {
  exampleOpticalFile,
  runAssessment,
} from '../../../packages/school-core/src/lib/assessment-automation.ts'

/** Otomatik etüt testlerinin kurum koleksiyonları. */
export const TUTORING_DATA = ['mockExams', 'opticalProfiles', 'availability'] as const

/** s1 için optik analiz: Deniz matematik kazanımlarında zayıftır (etüt adayı). */
export function evaluatedRecords(now: Date) {
  const state = createSeed(now)
  const profile = state.opticalProfiles[0]
  if (!profile) throw new Error('Seed optik profili yok.')
  const text = exampleOpticalFile(state, profile)
  let counter = 0
  runAssessment(
    state,
    { role: 'yonetici' },
    'evaluate',
    { profileId: profile.id, text },
    (prefix) => `${prefix}-e2e-${++counter}`,
    '',
    now.toISOString(),
  )
  return [
    ...state.opticalEvaluations
      .filter((item) => item.studentId === 's1')
      .map((data) => ({ collection: 'opticalEvaluations' as const, data })),
    ...state.mockResults
      .filter((item) => item.studentId === 's1')
      .map((data) => ({ collection: 'mockResults' as const, data })),
  ]
}

/** s1'in sınıfında, öğretmen t1'in matematik etüdü (yoklama/iptal testleri için hazır kayıt). */
export function tutorSession(id: string, date: Date) {
  const state = createSeed(new Date())
  const student = state.students.find((item) => item.id === 's1')
  const room = state.classes.find((item) => item.id === student?.classId)
  if (!student || !room) throw new Error('Seed öğrenci/sınıf yok.')
  const stamp = new Date().toISOString()
  return {
    collection: 'tutorSessions' as const,
    data: {
      id,
      examId: 'exam-7-1',
      branchId: room.branchId,
      grade: 7,
      subjectId: 'math',
      topic: 'Denklemler',
      studentIds: ['s1'],
      scores: [{ studentId: 's1', percent: 25 }],
      teacherId: 't1',
      date: date.toISOString(),
      duration: 30,
      room: room.room,
      roomClassId: room.id,
      capacity: 6,
      status: 'Planlandı',
      attendance: {},
      threshold: 70,
      createdAt: stamp,
      updatedAt: stamp,
    },
  }
}
