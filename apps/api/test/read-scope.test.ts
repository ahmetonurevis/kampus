import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'
import { scopeFor, type Actor } from '@kampus/school-core/lib/scope.ts'

import { RECORD_COLLECTIONS } from '../src/db/collections.ts'
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

function passes(row: Record<string, unknown>, field: string, values: readonly string[]) {
  const value = row[field]
  return Array.isArray(value) || (typeof value === 'string' && values.includes(value))
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
            passes(row, prefilter.field, prefilter.values),
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
})
