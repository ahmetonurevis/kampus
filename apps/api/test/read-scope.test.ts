import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { scopeFor, type Actor } from '@kampus/school-core/lib/scope.ts'

import { RECORD_COLLECTIONS } from '../src/db/collections.ts'
import type { RecordFilter } from '../src/db/records.ts'
import { matchesRecordFilter } from '../src/services/list-filters.ts'
import { scopePrefilter } from '../src/services/read-scope.ts'
import { FIXED_NOW } from './support/app.ts'

const SEED = createSeed(FIXED_NOW)

/** Örnek verinin bütün öğretmenleri ve birer öğrenci/veli dilimi (çok çocuklu veliler dahil). */
const ACTORS: Actor[] = [
  { role: 'yonetici', links: [] },
  { role: 'onburo', links: [] },
  { role: 'ogretmen', links: [] },
  ...SEED.teachers.map((teacher): Actor => ({
    role: 'ogretmen',
    links: [{ kind: 'teacher', recordId: teacher.id }],
  })),
  ...SEED.students
    .filter((_, index) => index % 8 === 0)
    .map((student): Actor => ({
      role: 'ogrenci',
      links: [{ kind: 'student', recordId: student.id }],
    })),
  ...SEED.parents
    .filter((parent, index) => index % 8 === 0 || parent.studentIds.length > 1)
    .map((parent): Actor => ({
      role: 'veli',
      links: parent.studentIds.map((recordId) => ({ kind: 'child', recordId })),
    })),
]

function passes(row: Record<string, unknown>, filter: RecordFilter) {
  return matchesRecordFilter(row, filter)
}

describe('okuma kapsamı SQL ön süzgeci', () => {
  test('core kapsamının gerekli koşuludur: görünür her satır süzgeçten geçer', () => {
    let checked = 0
    for (const actor of ACTORS) {
      const scope = scopeFor(SEED, actor)
      for (const collection of RECORD_COLLECTIONS) {
        const prefilter = scopePrefilter(scope, collection)
        if (!prefilter) continue
        const rows: readonly Record<string, unknown>[] = SEED[collection]
        for (const row of rows) {
          if (!scope.canRead(collection, row)) continue
          checked += 1
          assert.ok(
            passes(row, prefilter),
            `${actor.role} ${JSON.stringify(actor.links)} ${collection}`,
          )
        }
      }
    }
    // Süzgeç gerçekten satır görüyor: denetim boş kümede geçmiyor.
    assert.ok(checked > 10_000, String(checked))
  })

  test('yönetici ve ön büroda süzgeç yok; boş kapsam boş değer listesi verir', () => {
    for (const role of ['yonetici', 'onburo'] as const)
      for (const collection of RECORD_COLLECTIONS)
        assert.equal(scopePrefilter(scopeFor(SEED, { role, links: [] }), collection), null)
    const unlinked = scopeFor(SEED, { role: 'veli', links: [] })
    assert.deepEqual(scopePrefilter(unlinked, 'grades'), { field: 'studentId', values: [] })
    assert.equal(scopePrefilter(unlinked, 'students'), null)
  })

  test('DOM-AKD-054: sınıf değiştiren öğrencinin eski notu eski öğretmenin ön süzgecinden geçer', () => {
    // s1 c1'den c9'a geçti; not c1'de verildi (core `gradeReader`: verildiği sınıfın öğretmeni görür).
    const moved = {
      ...SEED,
      students: SEED.students.map((item) => (item.id === 's1' ? { ...item, classId: 'c9' } : item)),
    }
    const given = { id: 'g-moved', studentId: 's1', subjectId: 'math', classId: 'c1' }
    const legacy = { id: 'g-legacy', studentId: 's1', subjectId: 'math' }
    const math = SEED.assignments.find((a) => a.classId === 'c1' && a.subjectId === 'math')
    const current = SEED.assignments.find((a) => a.classId === 'c9' && a.subjectId === 'math')
    assert.ok(math && current)
    const visible = (teacherId: string, row: Record<string, unknown>) => {
      const scope = scopeFor(moved, {
        role: 'ogretmen',
        links: [{ kind: 'teacher', recordId: teacherId }],
      })
      const prefilter = scopePrefilter(scope, 'grades')
      assert.ok(prefilter)
      const core = scope.canRead('grades', row)
      // Ön süzgeç gerekli koşuldur: core görüyorsa süzgeç de geçirir, fazladan dışlama yok.
      if (core) assert.ok(passes(row, prefilter), teacherId)
      return core
    }
    assert.equal(visible(math.teacherId, given), true)
    assert.equal(visible(math.teacherId, legacy), false)
    // Yeni öğretmen aynı branşta ve öğrenci artık kendi sınıfında: core `subjectOrHomeroom` notu da görür.
    assert.equal(visible(current.teacherId, given), true)
    assert.equal(visible(current.teacherId, legacy), true)
  })
})
