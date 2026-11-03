import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  RECORDING_RETENTION_MONTHS,
  canAccessRecording,
  extendedRecordingRetention,
  recordingPeriodEnd,
  recordingPurgeHeld,
  recordingRetentionUntil,
  type DayRange,
  type RecordingReader,
} from '../packages/school-core/src/skills/recording.ts'
import { deadlineForVersion } from '../packages/school-core/src/skills/assignment.ts'

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

  test('DOM-BEC-052, DOM-BEC-025 geç sonuç duyurusu, itiraz açılışı ve kararı saklamayı öteler', () => {
    const base = {
      periodEndDate: '2026-11-01',
      deadline: { dueAt: '2026-11-05T20:59:00.000Z' },
      submittedAt: now,
    }
    // Geç puanlama: itiraz süresi duyurudan (1 Aralık Salı) 5 iş günü, 8 Aralık gün sonu.
    assert.equal(
      recordingRetentionUntil({ ...base, announcedAt: '2026-12-01T10:00:00.000Z' }),
      '2027-06-08T20:59:59.999Z',
    )
    // İtiraz 19 Kasım'da açıldı: karar süresi açılıştan 5 iş günü (26 Kasım) varsayılır.
    const appealed = { ...base, announcedAt: '2026-11-13T10:00:00.000Z' }
    assert.equal(recordingRetentionUntil(appealed), '2027-05-20T20:59:59.999Z')
    assert.equal(
      recordingRetentionUntil({ ...appealed, appealFiledAt: '2026-11-19T10:00:00.000Z' }),
      '2027-05-26T20:59:59.999Z',
    )
    // Karar geç verildi (10 Ocak): kapanış karar anıdır.
    assert.equal(
      recordingRetentionUntil({
        ...appealed,
        appealFiledAt: '2026-11-19T10:00:00.000Z',
        appealDecidedAt: '2027-01-10T10:00:00.000Z',
      }),
      '2027-07-10T20:59:59.999Z',
    )
    // Dönem sonu daha geçse olaylar saklamayı değiştirmez.
    assert.equal(
      recordingRetentionUntil({
        ...base,
        periodEndDate: '2027-06-25',
        announcedAt: '2026-12-01T10:00:00.000Z',
      }),
      '2027-12-25T20:59:59.999Z',
    )
  })

  test('DOM-BEC-052, DOM-YTK-059 saklama sonu yalnız ileri alınır; gelmiş ya da rızayla işaretli saklama sonu değişmez', () => {
    const current = '2027-05-19T20:59:59.999Z'
    assert.equal(
      extendedRecordingRetention({ current, computed: '2027-06-08T20:59:59.999Z', now }),
      '2027-06-08T20:59:59.999Z',
    )
    assert.equal(
      extendedRecordingRetention({
        current: new Date(current),
        computed: '2027-05-01T20:59:59.999Z',
        now,
      }),
      null,
    )
    assert.equal(extendedRecordingRetention({ current, computed: current, now }), null)
    // Rıza geri çekilince saklama sonu `now`'a çekilir: erken silme korunur.
    assert.equal(
      extendedRecordingRetention({ current: now, computed: '2027-06-08T20:59:59.999Z', now }),
      null,
    )
    assert.equal(
      extendedRecordingRetention({ current: null, computed: '2027-06-08T20:59:59.999Z', now }),
      null,
    )
  })

  test('DOM-BEC-052 imha işi açık itirazlı ya da puanı kesinleşmemiş son sürümün kaydını bekletir; rıza geri çekildiyse beklemez', () => {
    const held = (input: Partial<Parameters<typeof recordingPurgeHeld>[0]> = {}) =>
      recordingPurgeHeld({
        versionId: 'v2',
        latestVersionId: 'v2',
        settled: true,
        appeals: [],
        consentWithdrawn: false,
        ...input,
      })
    assert.equal(held(), false)
    assert.equal(held({ settled: false }), true)
    // Yerini yeni sürüme bırakan eski sürüm puanlanmaz, beklemez.
    assert.equal(held({ versionId: 'v1', settled: false }), false)
    assert.equal(held({ appeals: [{ submissionVersionId: 'v2', outcome: null }] }), true)
    assert.equal(held({ appeals: [{ submissionVersionId: 'v2', outcome: 'rejected' }] }), false)
    assert.equal(held({ appeals: [{ submissionVersionId: 'v1', outcome: null }] }), false)
    assert.equal(
      held({
        settled: false,
        appeals: [{ submissionVersionId: 'v2', outcome: null }],
        consentWithdrawn: true,
      }),
      false,
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

  test('DOM-BEC-052, DOM-BEC-040: çok turlu ses görevinde sürümün saklama hesabı kendi turunun son tarihini kullanır; sonraki istek bağlanırken hesaplananı değiştirmez, eski (yalnız son istek) hesap yalnız kısaltırdı', () => {
    const assignmentDeadline = { dueAt: '2026-09-10T20:59:00.000Z', lateAcceptanceDays: 0 }
    const firstRound = { versionNumber: 1, dueAt: '2026-10-20T20:59:00.000Z' }
    const secondRound = { versionNumber: 2, dueAt: '2026-11-30T20:59:00.000Z' }
    // v2 ilk turda gönderildi; dönem sonu erken: saklamayı puanlama süresinden türeyen itiraz belirler.
    const v2 = { submittedAt: '2026-10-15T09:00:00.000Z' }
    const retention = (deadline: { dueAt: string | null }) =>
      recordingRetentionUntil({ periodEndDate: '2026-09-30', deadline, ...v2 })
    const submission = (rounds: { versionNumber: number; dueAt: string }[]) => ({
      resubmissionRequestedForVersion: rounds.at(-1)?.versionNumber ?? null,
      resubmissionDueAt: rounds.at(-1)?.dueAt ?? null,
      resubmissionRounds: rounds,
    })
    // Bağlanırken (attachVersionFiles) yalnız ilk tur vardır.
    const attached = retention(deadlineForVersion(assignmentDeadline, submission([firstRound]), 2))
    // İtiraz kararı sonra, v2 için ikinci istek açıkken (extendVersionRecordingRetention).
    const later = retention(
      deadlineForVersion(assignmentDeadline, submission([firstRound, secondRound]), 2),
    )
    assert.equal(later, attached)
    // Eski hesap (yalnız son istek bilinir) v2'yi atamanın tarihiyle okurdu: daha erken sonuç.
    const latestOnly = retention(
      deadlineForVersion(
        assignmentDeadline,
        { ...submission([firstRound, secondRound]), resubmissionRounds: undefined },
        2,
      ),
    )
    assert.ok(Date.parse(latestOnly) < Date.parse(attached))
    // Saklama yalnız ileri alındığı için eski hesap bağlanırken yazılanı zaten kısaltamazdı.
    assert.equal(extendedRecordingRetention({ current: attached, computed: latestOnly, now }), null)
  })
})
