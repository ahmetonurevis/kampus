import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import { recordAttendance } from '../packages/school-core/src/lib/domain.ts'
import { dayKey } from '../packages/school-core/src/lib/format.ts'
import { updateGrade } from '../packages/school-core/src/lib/grades.ts'
import {
  redactRecord,
  scopeFor,
  visibleRecords,
  type Actor,
} from '../packages/school-core/src/lib/scope.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'

/**
 * Düzeltme geçmişinin görünürlüğü (DOM-AKD-035, DOM-AKD-051): öğrenci ve veli not ve yoklamanın
 * yalnız güncel değerini görür; `corrections` (gerekçe metni, düzelten kişi) onlardan ayıklanır.
 * Öğretmen ve yönetici kendi kapsamında görür; ön büro akademik veriyi hiç okumaz.
 */

const now = '2026-10-06T10:00:00.000Z'
const actors: Record<Role, Actor> = {
  yonetici: { role: 'yonetici', links: [] },
  onburo: { role: 'onburo', links: [] },
  ogretmen: { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] },
  ogrenci: { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] },
  veli: { role: 'veli', links: [{ kind: 'child', recordId: 's1' }] },
}
const REASON = 'Okuma hatası düzeltildi'

/** s1'in bir matematik notu ve bugünkü yoklaması düzeltilmiş örnek veri. */
function corrected() {
  const state = createSeed(new Date(now))
  const grade = state.grades.find((g) => g.studentId === 's1' && g.subjectId === 'math')
  assert.ok(grade, 'örnek veride s1 matematik notu olmalı')
  updateGrade(
    state,
    actors.yonetici,
    grade.id,
    { score: grade.score === 90 ? 91 : 90, reason: REASON },
    now,
  )
  const marks = Object.fromEntries(
    state.students.filter((s) => s.classId === 'c1' && s.isActive).map((s) => [s.id, 'present']),
  )
  recordAttendance(state, 'c1', now, marks, now)
  recordAttendance(state, 'c1', now, { ...marks, s1: 'absent' }, now, {
    reason: REASON,
    by: 'user-1',
  })
  const attendance = state.attendance.find(
    (a) => a.studentId === 's1' && dayKey(a.date) === '2026-10-06',
  )
  assert.ok(attendance?.corrections?.length)
  return { state, gradeId: grade.id, attendanceId: attendance.id }
}
const find = <T extends { id: string }>(rows: readonly T[], id: string) =>
  rows.find((row) => row.id === id)

function readAs(state: State, role: Role, gradeId: string, attendanceId: string) {
  return {
    grade: find(visibleRecords(state, actors[role], 'grades'), gradeId),
    attendance: find(visibleRecords(state, actors[role], 'attendance'), attendanceId),
  }
}

test('Öğrenci ve veli not ve yoklamanın yalnız güncel değerini görür; geçmiş ayıklanır', () => {
  const { state, gradeId, attendanceId } = corrected()
  const stored = find(state.grades, gradeId)
  for (const role of ['ogrenci', 'veli'] as const) {
    const { grade, attendance } = readAs(state, role, gradeId, attendanceId)
    assert.ok(grade && attendance, `${role} kendi kaydını görmeli`)
    assert.equal(grade.score, stored?.score, 'güncel puan döner')
    assert.equal(attendance.status, 'absent', 'güncel durum döner')
    assert.equal('corrections' in grade, false, `${role} not geçmişini görmez`)
    assert.equal('corrections' in attendance, false, `${role} yoklama geçmişini görmez`)
    // Ayıklama yalnız kopyadadır; saklanan kayıt geçmişi korur.
    assert.ok(find(state.grades, gradeId)?.corrections?.length)
    const scope = scopeFor(state, actors[role])
    assert.deepEqual(scope.hiddenFields('grades'), ['corrections'])
    assert.deepEqual(scope.hiddenFields('attendance'), ['corrections'])
    const single = redactRecord(state, actors[role], 'grades', stored ?? {})
    assert.ok(single && !('corrections' in single))
    // Gerekçe metni hiçbir alanda dönmez.
    assert.equal(JSON.stringify([grade, attendance]).includes(REASON), false)
  }
})

test('Yönetici ve dersin öğretmeni düzeltme geçmişini görür', () => {
  const { state, gradeId, attendanceId } = corrected()
  for (const role of ['yonetici', 'ogretmen'] as const) {
    const { grade, attendance } = readAs(state, role, gradeId, attendanceId)
    assert.equal(grade?.corrections?.[0]?.reason, REASON, `${role} not geçmişini görür`)
    assert.equal(attendance?.corrections?.[0]?.reason, REASON, `${role} yoklama geçmişini görür`)
    assert.equal(attendance?.corrections?.[0]?.by, 'user-1')
    assert.deepEqual(scopeFor(state, actors[role]).hiddenFields('grades'), [])
  }
})

test('Ön büro, kapsam dışı öğretmen ve başka çocuğun velisi kaydı hiç görmez', () => {
  const { state, gradeId, attendanceId } = corrected()
  assert.deepEqual(readAs(state, 'onburo', gradeId, attendanceId), {
    grade: undefined,
    attendance: undefined,
  })
  // t5 (edebiyat) 7-A'da ders vermez; s2 başka öğrencidir.
  const outsider: Actor = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't5' }] }
  const otherParent: Actor = { role: 'veli', links: [{ kind: 'child', recordId: 's2' }] }
  for (const actor of [outsider, otherParent]) {
    assert.equal(find(visibleRecords(state, actor, 'grades'), gradeId), undefined)
    assert.equal(find(visibleRecords(state, actor, 'attendance'), attendanceId), undefined)
  }
})
