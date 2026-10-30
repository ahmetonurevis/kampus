import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { managementLookups } from '../src/pages/management/management-rows.ts'
import {
  isBreach,
  NO_RESPONSE,
  responseHours,
  responseText,
  slaRows,
  slaSummary,
} from '../src/pages/management/sla-rows.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')
const HOUR = 3_600_000
const seed = createSeed(NOW)
const wrap = <T extends { id: string }>(records: readonly T[]) =>
  records.map((record) => ({
    id: record.id,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    record,
  }))
const lookups = managementLookups({
  branches: wrap(seed.branches),
  classes: wrap(seed.classes),
  teachers: wrap(seed.teachers),
  subjects: wrap(seed.subjects),
  assignments: wrap(seed.assignments),
})
const ago = (hours: number) => new Date(+NOW - hours * HOUR).toISOString()

const [first, second] = seed.teachers
if (!first || !second) throw new Error('örnek veride iki öğretmen bekleniyor')
const template = seed.questions[0]
if (!template) throw new Error('örnek veride soru bekleniyor')
const question = (
  id: string,
  teacherId: string,
  askedHoursAgo: number,
  answeredAfterHours: number | null,
) =>
  wrap([
    {
      ...template,
      id,
      teacherId,
      createdAt: ago(askedHoursAgo),
      answeredAt: answeredAfterHours === null ? null : ago(askedHoursAgo - answeredAfterHours),
    },
  ])[0]!

test('isBreach (SLA 24 saat, Vue slaStatus): yanıtlıda yanıt süresi, bekleyende geçen süre 24 saati aşınca ihlaldir', () => {
  const now = +NOW
  assert.equal(isBreach({ createdAt: ago(23), answeredAt: null }, now), false)
  assert.equal(isBreach({ createdAt: ago(24), answeredAt: null }, now), true)
  assert.equal(isBreach({ createdAt: ago(48), answeredAt: ago(24) }, now), false) // tam 24 saatte yanıt
  assert.equal(isBreach({ createdAt: ago(48), answeredAt: ago(23) }, now), true)
  assert.equal(isBreach({ createdAt: 'bozuk', answeredAt: null }, now), false)
})

test('responseHours: yalnız yanıtlanmış sorunun süresi; yanıtsız ya da negatif süre null', () => {
  assert.equal(responseHours({ createdAt: ago(10), answeredAt: ago(7) }), 3)
  assert.equal(responseHours({ createdAt: ago(10), answeredAt: null }), null)
  assert.equal(responseHours({ createdAt: ago(5), answeredAt: ago(10) }), null)
})

test('responseText: Türkçe ondalık ve yanıt yok metni', () => {
  assert.equal(responseText(3.5), '3,5 sa')
  assert.equal(responseText(12), '12 sa')
  assert.equal(responseText(null), NO_RESPONSE)
})

test('slaRows: öğretmen başına ortalama yanıt, bekleyen, ihlal ve uyum soru kayıtlarından hesaplanır', () => {
  const questions = [
    question('q-sla-1', first.id, 30, 2), // yanıt 2 sa, uyumlu
    question('q-sla-2', first.id, 40, 30), // yanıt 30 sa, ihlal
    question('q-sla-3', first.id, 26, null), // bekliyor, süre doldu: ihlal
    question('q-sla-4', first.id, 3, null), // bekliyor, süre var
    question('q-sla-5', second.id, 5, 1), // yanıt 1 sa
  ]
  const rows = slaRows(wrap([first, second]), questions, lookups, +NOW)
  const own = rows.find((row) => row.id === first.id)
  assert.deepEqual(
    [own?.total, own?.response, own?.pending, own?.breaches, own?.slaRate],
    [4, 16, 2, 2, 50],
  )
  const other = rows.find((row) => row.id === second.id)
  assert.deepEqual(
    [other?.total, other?.response, other?.pending, other?.breaches, other?.slaRate],
    [1, 1, 0, 0, 100],
  )
  // ihlali çok olan önce gelir
  assert.deepEqual(
    rows.map((row) => row.id),
    [first.id, second.id],
  )
})

test('slaRows: sorusu olmayan öğretmenin yanıt süresi uydurulmaz, uyum 100 sayılır', () => {
  const [row] = slaRows(wrap([second]), [], lookups, +NOW)
  assert.deepEqual(
    [row?.total, row?.response, row?.pending, row?.breaches, row?.slaRate],
    [0, null, 0, 0, 100],
  )
})

test('slaRows: arşivdeki öğretmen listelenmez; başka öğretmenin sorusu sayılmaz', () => {
  const archived = wrap([{ ...first, isActive: false }, second])
  const rows = slaRows(archived, [question('q-sla-6', first.id, 30, null)], lookups, +NOW)
  assert.deepEqual(
    rows.map((row) => row.id),
    [second.id],
  )
  assert.equal(rows[0]?.total, 0)
})

test('slaRows: sınıf adları kısaltılır ve tekrarlanmaz', () => {
  const [row] = slaRows(wrap([first]), [], lookups, +NOW)
  const classes = (lookups.assignmentsByTeacher.get(first.id) ?? []).length
  assert.ok(classes > 0)
  const names = (row?.classes ?? '').split(', ')
  assert.equal(new Set(names).size, names.length)
  assert.ok(names.every((name) => !name.includes(' · ')))
})

test('slaSummary: toplamlar satırlardan türer; soru yoksa uyum null', () => {
  const rows = slaRows(
    wrap([first, second]),
    [question('q-sla-7', first.id, 30, null), question('q-sla-8', second.id, 2, 1)],
    lookups,
    +NOW,
  )
  assert.deepEqual(slaSummary(rows), {
    teachers: 2,
    questions: 2,
    pending: 1,
    breaches: 1,
    slaRate: 50,
  })
  assert.equal(slaSummary([]).slaRate, null)
})
