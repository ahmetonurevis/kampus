import { subjectById, subjectsForGrade } from '../data/curriculum.ts'
import { required, type SeedDate, type SeedMonth } from './seed-support.ts'
import type { createStructure } from './seed-structure.ts'

type Structure = ReturnType<typeof createStructure>

/**
 * Örnek not ve yoklama kayıtları. Öğrenci başına dört aylık dönem notu ve 32 okul günü yoklaması;
 * kazanım testi notları `seed-learning.ts`'teki `quizGrades` ile sonradan eklenir.
 */
export function createGradesAndAttendance(input: {
  now: Date
  date: SeedDate
  month: SeedMonth
  students: { id: string; classId: string }[]
  classes: Structure['classes']
}) {
  const { now, date, month, students, classes } = input
  const academicMonths: string[] = []
  for (let offset = 0; academicMonths.length < 4; offset--) {
    const candidate = new Date(month(offset, 5))
    if (![6, 7].includes(candidate.getUTCMonth()) && candidate <= now)
      academicMonths.unshift(candidate.toISOString())
  }
  const grades = students.flatMap((student, i) =>
    Array.from({ length: 4 }, (_, m) =>
      subjectsForGrade(
        required(
          classes.find((c) => c.id === student.classId),
          'öğrenci sınıfı',
        ).grade,
      ).map((subject, t) => ({
        id: `g-${student.id}-${m}-${t}`,
        studentId: student.id,
        subjectId: subject.id,
        subject: subject.name,
        title: `${subject.name} · ${['Hazırbulunuşluk', 'Kazanım değerlendirme', 'Yazılı sınav', 'Aylık değerlendirme'][m]}`,
        topic: subject.topics[m % subject.topics.length],
        score: Math.min(
          100,
          43 +
            ((i * 13 + t * 9) % 43) +
            m * 4 +
            ((classes.findIndex((c) => c.id === student.classId) % 6) - 2) * 4,
        ),
        date: academicMonths[m],
      })),
    ).flat(),
  )
  const schoolDays: string[] = []
  for (let n = 1; schoolDays.length < 32; n += 3) {
    const d = new Date(date(-n))
    if (![0, 6].includes(d.getUTCDay()) && ![6, 7].includes(d.getUTCMonth()))
      schoolDays.push(d.toISOString())
  }
  const attendance = students.flatMap((s, i) =>
    schoolDays.map((d, n) => ({
      id: `att-${s.id}-${n}`,
      studentId: s.id,
      classId: s.classId,
      date: d,
      status:
        (i + n) % (i % 17 === 0 ? 4 : 19) === 0
          ? 'absent'
          : (i + n) % 23 === 0
            ? 'late'
            : 'present',
      reason: n % 8 === 0 ? 'Veli bilgilendirildi' : '',
    })),
  )
  return { grades, attendance }
}

/** Haftalık ders programı (iki hafta) ve öğretmen uygunluk saatleri. */
export function createTimetable(input: {
  now: Date
  date: SeedDate
  classes: Structure['classes']
  assignments: Structure['assignments']
  teachers: Structure['teachers']
}) {
  const { now, date, classes, assignments, teachers } = input
  const schedule = []
  const monday = new Date(now)
  const weekday = monday.getUTCDay()
  monday.setUTCDate(monday.getUTCDate() - ((weekday + 6) % 7))
  monday.setUTCHours(6, 0, 0, 0)
  const usedSlots = new Set()
  for (let d = 0; d < 12; d++) {
    const day = new Date(monday)
    day.setUTCDate(day.getUTCDate() + d)
    if ([0, 6].includes(day.getUTCDay())) continue
    for (let period = 0; period < 6; period++)
      for (const [ci, c] of classes.entries()) {
        const options = assignments.filter((a) => a.classId === c.id)
        const rotated = [
          ...options.slice((ci + d + period) % options.length),
          ...options.slice(0, (ci + d + period) % options.length),
        ]
        const assignment = rotated.find((a) => !usedSlots.has(`${d}-${period}-${a.teacherId}`))
        if (!assignment) continue
        usedSlots.add(`${d}-${period}-${assignment.teacherId}`)
        const lessonDate = new Date(day)
        lessonDate.setUTCMinutes(period * 50 + (period >= 3 ? 40 : 0))
        schedule.push({
          id: `lesson-${c.id}-${d}-${period}`,
          classId: c.id,
          teacherId: assignment.teacherId,
          subjectId: assignment.subjectId,
          date: lessonDate.toISOString(),
          duration: 40,
          title: required(subjectById(assignment.subjectId), 'ders').name,
          room: c.room,
        })
      }
  }
  const availability = teachers.flatMap((t) =>
    [1, 2, 3, 4].map((d, n) => ({
      id: `slot-${t.id}-${n}`,
      teacherId: t.id,
      date: date(d, 13 + (n % 2)),
      duration: 30,
    })),
  )
  return { schedule, availability }
}
