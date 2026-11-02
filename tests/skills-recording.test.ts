import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  RECORDING_RETENTION_MONTHS,
  canAccessRecording,
  recordingPeriodEnd,
  recordingRetentionUntil,
  type DayRange,
  type RecordingReader,
} from '../packages/school-core/src/skills/recording.ts'

const now = '2026-11-04T09:00:00.000Z'
const reader = (input: Partial<RecordingReader> = {}): RecordingReader => ({
  role: 'ogrenci',
  ownsLearner: true,
  readsSubmission: false,
  learnerBirthDate: '2011-03-15',
  ...input,
})

describe('ses kaydına erişim (DOM-BEC-053)', () => {
  test('DOM-BEC-053 kaydın sahibi dinler; sınıf arkadaşı dinleyemez', () => {
    assert.equal(canAccessRecording(reader(), now), true)
    assert.equal(canAccessRecording(reader({ ownsLearner: false }), now), false)
    // Öğrenci teslimi okuma bayrağıyla (personel kapsamı) dinleyemez.
    assert.equal(
      canAccessRecording(reader({ ownsLearner: false, readsSubmission: true }), now),
      false,
    )
  })

  test('DOM-BEC-053, DOM-DIL-090 veli yalnız 18 yaş altındaki çocuğunun kaydını dinler; doğum tarihi bilinmeyen 18 yaş altı sayılır', () => {
    const parent = (input: Partial<RecordingReader>) => reader({ role: 'veli', ...input })
    assert.equal(canAccessRecording(parent({}), now), true)
    assert.equal(canAccessRecording(parent({ learnerBirthDate: null }), now), true)
    assert.equal(canAccessRecording(parent({ learnerBirthDate: '2008-02-30' }), now), true)
    assert.equal(canAccessRecording(parent({ learnerBirthDate: '2000-01-01' }), now), false)
    // 18. doğum günü Europe/Istanbul gününde başlar.
    assert.equal(canAccessRecording(parent({ learnerBirthDate: '2008-11-04' }), now), false)
    assert.equal(canAccessRecording(parent({ learnerBirthDate: '2008-11-05' }), now), true)
    assert.equal(canAccessRecording(parent({ ownsLearner: false }), now), false)
  })

  test('DOM-BEC-053 teslimi okuyan öğretmen ve yönetici dinler; ön büro hiçbir koşulda dinleyemez', () => {
    for (const role of ['ogretmen', 'yonetici'] as const) {
      assert.equal(canAccessRecording(reader({ role, readsSubmission: true }), now), true, role)
      assert.equal(
        canAccessRecording(reader({ role, readsSubmission: false, ownsLearner: true }), now),
        false,
        role,
      )
    }
    assert.equal(
      canAccessRecording(reader({ role: 'onburo', readsSubmission: true, ownsLearner: true }), now),
      false,
    )
  })
})

describe('ses kaydının saklama süresi (DOM-BEC-052)', () => {
  const year = (startDate: string, endDate: string): DayRange => ({ startDate, endDate })

  test('DOM-BEC-052 school: dönem sonu kaydın gününü içeren ders yılının bitişidir; tanımsızsa 31 Ağustos', () => {
    const years = [year('2025-09-08', '2026-06-26'), year('2026-09-07', '2027-06-25')]
    const input = { institutionType: 'school' as const, academicYears: years, groups: [] }
    assert.equal(recordingPeriodEnd({ ...input, on: now }), '2027-06-25')
    // Yaz tatilindeki kayıt: tanımlı yıl kapsamıyor, Eylül'de başlayan yıl 31 Ağustos'ta biter.
    assert.equal(recordingPeriodEnd({ ...input, on: '2026-07-10T09:00:00.000Z' }), '2026-08-31')
    assert.equal(
      recordingPeriodEnd({ ...input, academicYears: [], on: '2026-10-01T09:00:00.000Z' }),
      '2027-08-31',
    )
    // Gün Europe/Istanbul'dur: 31 Ağustos 21.30 UTC İstanbul'da 1 Eylül'dür.
    assert.equal(
      recordingPeriodEnd({ ...input, academicYears: [], on: '2026-08-31T21:30:00.000Z' }),
      '2027-08-31',
    )
  })

  test('DOM-BEC-052 language_school: dönem sonu kaydın gününü içeren kur grubunun bitişidir; yoksa sonraki grup, o da yoksa kaydın günü', () => {
    const input = { institutionType: 'language_school' as const, academicYears: [], on: now }
    const groups = [
      year('2026-09-01', '2026-12-15'),
      year('2026-10-01', '2027-01-20'),
      year('2027-02-01', '2027-05-01'),
    ]
    assert.equal(recordingPeriodEnd({ ...input, groups }), '2027-01-20')
    assert.equal(recordingPeriodEnd({ ...input, groups: groups.slice(2) }), '2027-05-01')
    assert.equal(
      recordingPeriodEnd({ ...input, groups: [year('2026-01-01', '2026-06-01')] }),
      '2026-11-04',
    )
    assert.equal(recordingPeriodEnd({ ...input, groups: [] }), '2026-11-04')
  })

  test('DOM-BEC-052 saklama dönem sonundan 6 ay sonra, o günün Europe/Istanbul sonunda biter', () => {
    assert.equal(RECORDING_RETENTION_MONTHS, 6)
    assert.equal(
      recordingRetentionUntil({
        periodEndDate: '2027-06-25',
        deadline: { dueAt: '2026-11-05T20:59:00.000Z' },
        submittedAt: now,
      }),
      '2027-12-25T20:59:59.999Z',
    )
    // Ayın son gününü aşan gün ayın sonuna çekilir.
    assert.equal(
      recordingRetentionUntil({
        periodEndDate: '2027-08-31',
        deadline: { dueAt: null },
        submittedAt: '2027-06-01T09:00:00.000Z',
      }),
      '2028-02-29T20:59:59.999Z',
    )
  })

  test('DOM-BEC-052, DOM-BEC-025 puanlama ve itiraz süresi dönem sonundan geç kapanırsa saklama ondan başlar', () => {
    // Puanlama son teslim + 7 gün (12 Kasım), itiraz 5 iş günü (19 Kasım Perşembe gün sonu).
    const base = {
      periodEndDate: '2026-11-01',
      deadline: { dueAt: '2026-11-05T20:59:00.000Z' },
      submittedAt: now,
    }
    assert.equal(recordingRetentionUntil(base), '2027-05-19T20:59:59.999Z')
    // Verilen tatil itiraz süresini ve saklama sonunu öteler.
    assert.equal(
      recordingRetentionUntil({ ...base, holidays: ['2026-11-16'] }),
      '2027-05-20T20:59:59.999Z',
    )
  })

  test('DOM-BEC-052 saf hesap: girdi değişmez, aynı girdi aynı sonucu verir', () => {
    const groups = Object.freeze([Object.freeze(year('2026-09-01', '2026-12-15'))])
    const input = {
      institutionType: 'language_school' as const,
      academicYears: [],
      groups,
      on: now,
    }
    assert.equal(recordingPeriodEnd(input), recordingPeriodEnd(input))
    assert.throws(
      () =>
        recordingRetentionUntil({
          periodEndDate: '2026-02-30',
          deadline: { dueAt: null },
          submittedAt: now,
        }),
      RangeError,
    )
  })
})
