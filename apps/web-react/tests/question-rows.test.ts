import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  OVERDUE_LABEL,
  durationText,
  orderQuestions,
  questionLookups,
  questionRow,
} from '../src/pages/learning/question-rows.ts'

const NOW = '2026-10-15T09:00:00.000Z'

type Seed = ReturnType<typeof createSeed>
type Question = Seed['questions'][number]

const wrap = (record: Question, joined?: { studentName?: string; className?: string }) => ({
  id: record.id,
  version: 3,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  record,
  ...(joined ? { joined } : {}),
})

const lookups = questionLookups(
  [{ id: 'math', record: { name: 'Matematik' } }],
  [{ id: 't1', record: { name: 'Selin Kaya' } }],
)

const base: Question = {
  id: 'q1',
  studentId: 's1',
  teacherId: 't1',
  subjectId: 'math',
  title: 'Üçgenler',
  text: 'Üçgenin alanı nasıl bulunur?',
  createdAt: '2026-10-14T09:00:00.000Z',
  answeredAt: null,
  answer: '',
  fileName: null,
}

test('DOM-ILT-093: yanıtsız soru "Yanıt bekliyor" olur, hedef süresi hesaplanır ve geçince gecikir', () => {
  const early = questionRow(
    wrap(base, { studentName: 'Deniz Yılmaz' }),
    lookups,
    '2026-10-14T10:00:00.000Z',
  )
  assert.equal(early.status, 'Yanıt bekliyor')
  assert.equal(early.state, 'pending')
  assert.equal(early.student, 'Deniz Yılmaz')
  assert.equal(early.subject, 'Matematik')
  assert.equal(early.teacher, 'Selin Kaya')
  assert.equal(early.version, 3)
  assert.equal(early.overdue, false)
  assert.match(early.response, /^Hedef /)
  assert.equal(early.canWithdraw, true)
  assert.equal(early.canAnswer, true)

  // Bir iş günü sonrası hedef geçmiştir (hafta sonu atlanmaz: 14 Ekim 2026 çarşamba).
  const late = questionRow(wrap(base), lookups, '2026-10-20T09:00:00.000Z')
  assert.equal(late.overdue, true)
  assert.equal(late.response, OVERDUE_LABEL)
})

test('DOM-ILT-092: yanıtlanan soruda yanıt süresi geçen süredir; ek yanıtlar sırayla listelenir', () => {
  const row = questionRow(
    wrap({
      ...base,
      answeredAt: '2026-10-14T12:20:00.000Z',
      answer: 'Taban çarpı yükseklik bölü iki.',
      followUps: [
        {
          id: 'a1',
          text: 'Ek: birimlere dikkat edin.',
          at: '2026-10-14T13:00:00.000Z',
          by: { role: 'ogretmen' as const, userId: 'u1' },
        },
      ],
    }),
    lookups,
    NOW,
  )
  assert.equal(row.status, 'Yanıtlandı')
  assert.equal(row.response, '3 sa 20 dk')
  assert.equal(row.overdue, false)
  assert.equal(row.canWithdraw, false)
  assert.equal(row.canAnswer, true)
  assert.deepEqual(
    row.answers.map((entry) => [entry.kind, entry.text]),
    [
      ['first', 'Taban çarpı yükseklik bölü iki.'],
      ['follow-up', 'Ek: birimlere dikkat edin.'],
    ],
  )
  assert.equal(row.answer, 'Taban çarpı yükseklik bölü iki.')
})

test('DOM-ILT-091: geri çekilen soru yanıtlanamaz, geri çekilemez ve gecikmiş sayılmaz', () => {
  const row = questionRow(
    wrap({ ...base, withdrawnAt: '2026-10-14T09:30:00.000Z' }),
    lookups,
    '2026-10-30T09:00:00.000Z',
  )
  assert.equal(row.status, 'Geri çekildi')
  assert.equal(row.state, 'withdrawn')
  assert.equal(row.overdue, false)
  assert.equal(row.response, '—')
  assert.equal(row.canWithdraw, false)
  assert.equal(row.canAnswer, false)
})

test('DOM-ILT-092: bir soruya en çok 10 yanıt yazılır, sınıra ulaşınca form kapanır', () => {
  const followUps = Array.from({ length: 9 }, (_, index) => ({
    id: `a${index}`,
    text: `Ek ${index}`,
    at: '2026-10-14T13:00:00.000Z',
    by: { role: 'ogretmen' as const, userId: 'u1' },
  }))
  const full = questionRow(
    wrap({ ...base, answeredAt: '2026-10-14T12:00:00.000Z', answer: 'İlk', followUps }),
    lookups,
    NOW,
  )
  assert.equal(full.answers.length, 10)
  assert.equal(full.answerLimitReached, true)
  assert.equal(full.canAnswer, false)
  const nine = questionRow(
    wrap({
      ...base,
      answeredAt: '2026-10-14T12:00:00.000Z',
      answer: 'İlk',
      followUps: followUps.slice(1),
    }),
    lookups,
    NOW,
  )
  assert.equal(nine.canAnswer, true)
})

test('bilinmeyen ders ve öğretmen "—" olur; ad eşlemesi eksik kalsa da satır çizilir', () => {
  const row = questionRow(wrap({ ...base, subjectId: 'x', teacherId: 'y' }), lookups, NOW)
  assert.equal(row.subject, '—')
  assert.equal(row.teacher, '—')
  assert.equal(row.student, '')
})

test('durationText: dakika, saat ve gün biçimleri', () => {
  assert.equal(durationText(10_000), '1 dakikadan kısa')
  assert.equal(durationText(5 * 60_000), '5 dk')
  assert.equal(durationText(60 * 60_000), '1 sa')
  assert.equal(durationText(200 * 60_000), '3 sa 20 dk')
  assert.equal(durationText((26 * 60 + 15) * 60_000), '1 gün 2 sa')
  assert.equal(durationText(-5), '1 dakikadan kısa')
})

test('orderQuestions: öğretmen kuyruğunda bekleyenler önce ve en eski üstte; öğrencide yeniden eskiye', () => {
  const make = (id: string, createdAt: string, extra: Partial<Question> = {}) =>
    questionRow(wrap({ ...base, id, createdAt, ...extra }), lookups, NOW)
  const rows = [
    make('answered-new', '2026-10-14T08:00:00.000Z', {
      answeredAt: '2026-10-14T09:00:00.000Z',
      answer: 'Tamam',
    }),
    make('pending-new', '2026-10-13T08:00:00.000Z'),
    make('withdrawn', '2026-10-12T08:00:00.000Z', { withdrawnAt: '2026-10-12T09:00:00.000Z' }),
    make('pending-old', '2026-10-10T08:00:00.000Z'),
  ]
  assert.deepEqual(
    orderQuestions(rows, 'teacher').map((row) => row.id),
    ['pending-old', 'pending-new', 'answered-new', 'withdrawn'],
  )
  assert.deepEqual(
    orderQuestions(rows, 'student').map((row) => row.id),
    ['answered-new', 'pending-new', 'withdrawn', 'pending-old'],
  )
})

test('örnek veri: bütün seed soruları satıra dönüşür ve durumu core hesaplar', () => {
  const seed = createSeed(new Date(NOW))
  const rows = seed.questions.map((record) => questionRow(wrap(record), lookups, NOW))
  assert.equal(rows.length, seed.questions.length)
  assert.equal(
    rows.filter((row) => row.state === 'answered').length,
    seed.questions.filter((record) => record.answeredAt).length,
  )
})
