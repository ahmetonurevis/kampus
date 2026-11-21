import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { responseDueAt } from '@kampus/school-core/lib/communication.ts'
import {
  DUE_SOON_MINUTES,
  OVERDUE_LABEL,
  durationText,
  matchesSla,
  orderQuestions,
  questionLookups,
  questionRow,
} from '../src/question-model.ts'

const NOW = '2026-10-15T09:00:00.000Z'

type Seed = ReturnType<typeof createSeed>
type Question = Seed['questions'][number]

const wrap = (
  record: Question,
  joined?: { studentName?: string; className?: string; teacherName?: string },
) => ({
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

test('OG-221: arşivdeki öğretmenin adı satıra bağlı gelir, kadro listesinde olmasa da "—" olmaz', () => {
  const departed = { ...base, teacherId: 't-ayrildi' }
  assert.equal(
    questionRow(wrap(departed, { teacherName: 'Mehmet Demir' }), lookups, NOW).teacher,
    'Mehmet Demir',
  )
  // Sunucu adı varsa kadro listesindeki ad değil o kullanılır; yoksa kadro listesi yedektir.
  assert.equal(
    questionRow(wrap(base, { teacherName: 'Selin Kaya (Yeni)' }), lookups, NOW).teacher,
    'Selin Kaya (Yeni)',
  )
  assert.equal(questionRow(wrap(base), lookups, NOW).teacher, 'Selin Kaya')
  assert.equal(questionRow(wrap(departed), lookups, NOW).teacher, '—')
})

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

test('DOM-ILT-013: hedefe kalan dakika yalnız bekleyen soruda hesaplanır; aşılınca negatiftir', () => {
  const due = Date.parse(responseDueAt(base.createdAt))
  const at = (offsetMinutes: number) => new Date(due + offsetMinutes * 60_000).toISOString()
  const remaining = (offsetMinutes: number) =>
    questionRow(wrap(base), lookups, at(offsetMinutes)).remainingMinutes
  assert.equal(remaining(-90), 90)
  assert.equal(remaining(0), 0)
  assert.equal(remaining(1), -1)
  const answered = questionRow(
    wrap({ ...base, answeredAt: '2026-10-14T12:20:00.000Z', answer: 'Yanıt.' }),
    lookups,
    at(-90),
  )
  assert.equal(answered.remainingMinutes, null)
  const withdrawn = questionRow(
    wrap({ ...base, withdrawnAt: '2026-10-14T09:30:00.000Z' }),
    lookups,
    at(-90),
  )
  assert.equal(withdrawn.remainingMinutes, null)
})

test('DOM-ILT-013: yanıt süresi süzgeci aşılmış ve yaklaşan soruları ayırır, yanıtlananı hiçbirine saymaz', () => {
  const due = Date.parse(responseDueAt(base.createdAt))
  const row = (offsetMinutes: number, extra: Partial<Question> = {}) =>
    questionRow(
      wrap({ ...base, ...extra }),
      lookups,
      new Date(due + offsetMinutes * 60_000).toISOString(),
    )
  const farAway = row(-(DUE_SOON_MINUTES + 1))
  const edge = row(-DUE_SOON_MINUTES)
  const justBefore = row(0)
  const overdue = row(1)
  const answered = row(1, { answeredAt: '2026-10-14T12:20:00.000Z', answer: 'Yanıt.' })

  assert.deepEqual(
    [farAway, edge, justBefore, overdue, answered].map((item) => matchesSla(item, 'all')),
    [true, true, true, true, true],
  )
  assert.deepEqual(
    [farAway, edge, justBefore, overdue, answered].map((item) => matchesSla(item, 'overdue')),
    [false, false, false, true, false],
  )
  // Hedefe tam 4 saat kalan ve hedef anındaki soru yaklaşandır; aşılmış ve uzak olan değildir.
  assert.deepEqual(
    [farAway, edge, justBefore, overdue, answered].map((item) => matchesSla(item, 'soon')),
    [false, true, true, false, false],
  )
})

test('DOM-ILT-093: kalan dakika yanıt süresine göre hesaplanır; gecikmiş eksi, yanıtlanan boştur', () => {
  const due = Date.parse(responseDueAt(base.createdAt))
  const now = new Date(due - 120 * 60_000).toISOString()
  const make = (id: string, createdAt: string, extra: Partial<Question> = {}) =>
    questionRow(wrap({ ...base, id, createdAt, ...extra }), lookups, now)
  const fresh = make('fresh', base.createdAt)
  const late = make('late', '2026-10-13T09:00:00.000Z')
  const answered = make('answered', '2026-10-14T09:00:00.000Z', {
    answeredAt: now,
    answer: 'Yanıt.',
  })
  assert.equal(fresh.remainingMinutes, 120)
  assert.ok((late.remainingMinutes ?? 0) < 0)
  assert.equal(answered.remainingMinutes, null)
})
