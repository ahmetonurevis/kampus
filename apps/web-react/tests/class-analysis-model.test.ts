import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { classOptions } from '../src/pages/academic/class-analysis-model.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const seed = createSeed(NOW)
const branches = new Map(seed.branches.map((branch) => [branch.id, branch]))
const wrap = <T extends { id: string }>(records: readonly T[]) =>
  records.map((record) => ({
    id: record.id,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    record,
  }))

test('classOptions: yalnız etkin sınıflar, doğal sırayla ve "Sınıf · Kampüs" etiketiyle gelir', () => {
  const rows = wrap([
    { ...seed.classes[0]!, id: 'x10', name: '10-A', isActive: true },
    { ...seed.classes[0]!, id: 'x5', name: '5-A', isActive: true },
    { ...seed.classes[0]!, id: 'xoff', name: '6-A', isActive: false },
  ])
  const options = classOptions(rows, branches)
  assert.deepEqual(
    options.map((item) => item.id),
    ['x5', 'x10'],
  )
  const branchName = branches.get(seed.classes[0]!.branchId)!.name
  assert.equal(options[0]!.label, `5-A · ${branchName}`)
})

test('classOptions: kampüsü bilinmeyen sınıf yalnız adıyla listelenir; kapsam boşsa liste boştur', () => {
  const rows = wrap([{ ...seed.classes[0]!, name: '7-B', branchId: 'yok' }])
  assert.equal(classOptions(rows, branches)[0]!.label, '7-B')
  assert.deepEqual(classOptions([], branches), [])
})
