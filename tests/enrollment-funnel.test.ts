import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import {
  ENROLLMENT_FUNNEL_ROLES,
  enrollmentFunnel,
  funnelRate,
  funnelStepLabel,
  funnelSteps,
  type FunnelProspect,
  type FunnelRow,
} from '../packages/school-core/src/lib/enrollment-funnel.ts'
import { PROSPECT_SOURCES, PROSPECT_STAGES } from '../packages/school-core/src/lib/prospects.ts'

// Kayıt hunisi (DOM-KAY-040; IST-117): aday → görüşme → [deneme dersi] → kesin kayıt, birikimli;
// kaynak ve danışman kırılımı.

const now = '2026-10-06T10:00:00.000Z'
const meeting = { date: '2026-10-01T09:00:00.000Z', duration: 30, room: '101', teacherId: null }
const trialLesson = { lessonId: 'l1', classId: 'c1', date: '2026-10-02T09:00:00.000Z' }
const by = (userId: string) => ({ role: 'onburo', userId })

const prospect = (overrides: FunnelProspect = {}): FunnelProspect => ({
  source: 'Web sitesi',
  stage: 'Yeni aday',
  studentId: null,
  trialAt: null,
  createdBy: by('u-front'),
  ...overrides,
})

const stepCounts = (row: FunnelRow) => row.steps.map(({ step, count, rate }) => [step, count, rate])
const stageCount = (row: FunnelRow, stage: string) =>
  row.stages.find((item) => item.stage === stage)?.count

test('DOM-KAY-040: okulda huni aday → görüşme → kesin kayıt, birikimli; oran önceki adıma göre', () => {
  const funnel = enrollmentFunnel(
    [
      prospect(),
      prospect({ stage: 'İletişime geçildi' }),
      prospect({ stage: 'Görüşme planlandı', meeting }),
      // Görüşmesiz teklif: aşama atlanabilir, görüşme adımına sayılmaz.
      prospect({ stage: 'Teklif verildi' }),
      // Görüşmesiz kesin kayıt birikimli olarak görüşmeyi geçmiş sayılır.
      prospect({ stage: 'Kayıt oldu', studentId: 's1' }),
      prospect({ stage: 'Teklif verildi', meeting }),
      // Okulda deneme dersi adımı yoktur; kayıt dışı alan sayılmaz.
      prospect({ stage: 'İletişime geçildi', trialLesson }),
    ],
    'school',
  )
  assert.deepEqual(stepCounts(funnel.total), [
    ['prospect', 7, null],
    ['meeting', 3, 42.9],
    ['enrolled', 1, 33.3],
  ])
  assert.equal(funnel.total.prospects, 7)
  assert.equal(funnel.total.conversionRate, 14.3)
  assert.deepEqual(
    funnel.total.stages.map((item) => item.stage),
    [...PROSPECT_STAGES],
  )
  assert.equal(stageCount(funnel.total, 'Teklif verildi'), 2)
  assert.equal(stageCount(funnel.total, 'Vazgeçti'), 0)
})

test('DOM-KAY-040: dil okulunda deneme dersi adımı görüşmeyle kesin kayıt arasındadır', () => {
  const funnel = enrollmentFunnel(
    [
      prospect(),
      prospect({ stage: 'Görüşme planlandı', meeting }),
      prospect({ stage: 'Görüşme planlandı', trialLesson }),
      prospect({ stage: 'Kayıt oldu', studentId: 's1', meeting, trialLesson }),
    ],
    'language_school',
  )
  assert.deepEqual(stepCounts(funnel.total), [
    ['prospect', 4, null],
    ['meeting', 3, 75],
    ['trial', 2, 66.7],
    ['enrolled', 1, 50],
  ])
  assert.deepEqual(funnelSteps('language_school'), ['prospect', 'meeting', 'trial', 'enrolled'])
  assert.deepEqual(funnelSteps('school'), ['prospect', 'meeting', 'enrolled'])
  assert.equal(funnelStepLabel('meeting', 'language_school'), 'Seviye tespiti görüşmesi')
  assert.equal(funnelStepLabel('meeting', 'school'), 'Tanışma görüşmesi')
  assert.equal(funnelStepLabel('prospect', 'school'), 'Aday')
  assert.equal(funnelStepLabel('trial', 'language_school'), 'Deneme dersi')
  assert.equal(funnelStepLabel('enrolled', 'school'), 'Kesin kayıt')
})

test('DOM-KAY-040: vazgeçen aday gerçekleşmiş görüşmesiyle görüşme adımında kalır; eski kayıtta trialAt görüşmedir', () => {
  const funnel = enrollmentFunnel(
    [
      prospect({ stage: 'Vazgeçti', meeting }),
      // İleri tarihli görüşmesi vazgeçince kalkan aday (DOM-KAY-030).
      prospect({ stage: 'Vazgeçti' }),
      prospect({ stage: 'Teklif verildi', trialAt: '2026-09-01T09:00:00.000Z' }),
      // Kesin kayıt yalnız öğrenci kimliğiyle de tanınır.
      prospect({ stage: 'Teklif verildi', studentId: 's2' }),
      prospect({ trialAt: '' }),
    ],
    'school',
  )
  assert.deepEqual(stepCounts(funnel.total), [
    ['prospect', 5, null],
    ['meeting', 3, 60],
    ['enrolled', 1, 33.3],
  ])
  assert.equal(stageCount(funnel.total, 'Vazgeçti'), 2)
})

test('DOM-KAY-040: kaynak kırılımı bilinen kaynakları sıfırla da verir, eski kaynak sonra, kaynaksız en sonda', () => {
  const funnel = enrollmentFunnel(
    [
      prospect({ source: 'Telefon', stage: 'Kayıt oldu', studentId: 's1' }),
      prospect({ source: 'Telefon' }),
      prospect({ source: 'Gazete ilanı' }),
      prospect({ source: 'Broşür' }),
      prospect({ source: null }),
      prospect({ source: '  ' }),
    ],
    'school',
  )
  assert.deepEqual(
    funnel.bySource.map((row) => [row.source, row.prospects]),
    [
      ...PROSPECT_SOURCES.map((source) => [source, source === 'Telefon' ? 2 : 0]),
      ['Broşür', 1],
      ['Gazete ilanı', 1],
      [null, 2],
    ],
  )
  const phone = funnel.bySource.find((row) => row.source === 'Telefon')
  assert.equal(phone?.conversionRate, 50)
  const web = funnel.bySource.find((row) => row.source === 'Web sitesi')
  assert.equal(web?.conversionRate, null)
  assert.deepEqual(web && stepCounts(web), [
    ['prospect', 0, null],
    ['meeting', 0, null],
    ['enrolled', 0, null],
  ])
  const sum = funnel.bySource.reduce((total, row) => total + row.prospects, 0)
  assert.equal(sum, funnel.total.prospects)
})

test('DOM-KAY-040: danışman adayı açan personeldir; çoktan aza, eşitte kimlik sırası, açanı bilinmeyen en sonda', () => {
  const funnel = enrollmentFunnel(
    [
      prospect({ createdBy: by('u-b') }),
      prospect({ createdBy: by('u-a'), stage: 'Kayıt oldu', studentId: 's1' }),
      prospect({ createdBy: undefined }),
      prospect({ createdBy: by('u-c') }),
      prospect({ createdBy: by('u-c'), meeting }),
      prospect({ createdBy: { userId: null } }),
      prospect({ createdBy: null }),
    ],
    'school',
  )
  assert.deepEqual(
    funnel.byCounselor.map((row) => [row.counselorId, row.prospects]),
    [
      ['u-c', 2],
      ['u-a', 1],
      ['u-b', 1],
      [null, 3],
    ],
  )
  assert.equal(funnel.byCounselor[1]?.conversionRate, 100)
  const sum = funnel.byCounselor.reduce((total, row) => total + row.prospects, 0)
  assert.equal(sum, funnel.total.prospects)
})

test('DOM-KAY-040: tanınmayan eski aşama aşama sayısına girmez, aday sayısına girer; boş girdi oransız', () => {
  const funnel = enrollmentFunnel(
    [prospect({ stage: 'Arşiv' }), prospect({ stage: null })],
    'school',
  )
  assert.equal(funnel.total.prospects, 2)
  assert.equal(
    funnel.total.stages.reduce((total, item) => total + item.count, 0),
    0,
  )
  const empty = enrollmentFunnel([], 'language_school')
  assert.equal(empty.total.prospects, 0)
  assert.equal(empty.total.conversionRate, null)
  assert.ok(empty.total.steps.every((step) => step.count === 0 && step.rate === null))
  assert.deepEqual(empty.byCounselor, [])
  assert.equal(empty.bySource.length, PROSPECT_SOURCES.length)
})

test('DOM-KAY-040: örnek veriyle toplam aday sayısı ve kesin kayıtlar tutarlıdır; girdi değişmez', () => {
  const state = createSeed(new Date(now))
  const before = structuredClone(state.prospects)
  const funnel = enrollmentFunnel(state.prospects, 'school')
  assert.deepEqual(state.prospects, before)
  assert.equal(funnel.total.prospects, state.prospects.length)
  const enrolled = state.prospects.filter((item) => item.stage === 'Kayıt oldu').length
  assert.equal(funnel.total.steps.at(-1)?.count, enrolled)
  assert.equal(stageCount(funnel.total, 'Kayıt oldu'), enrolled)
  // Örnek veride açan kişi kaydı yoktur: hepsi "belirtilmemiş" danışmandadır.
  assert.deepEqual(
    funnel.byCounselor.map((row) => [row.counselorId, row.prospects]),
    [[null, state.prospects.length]],
  )
})

test('DOM-KAY-040: yüzde bir ondalığa yuvarlanır, payda 0 ise yoktur; raporu yönetici ve ön büro okur', () => {
  assert.equal(funnelRate(1, 3), 33.3)
  assert.equal(funnelRate(2, 3), 66.7)
  assert.equal(funnelRate(0, 5), 0)
  assert.equal(funnelRate(3, 0), null)
  assert.deepEqual([...ENROLLMENT_FUNNEL_ROLES], ['yonetici', 'onburo'])
})
