import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  TRIAL_RESULT_NOTE_MAX,
  type ProspectTrialLesson,
} from '@kampus/school-core/lib/prospects.ts'
import { withDayRange } from '../src/pages/crm/prospect-rows.ts'
import {
  TRIAL_DATE_FILTER,
  trialResultBlock,
  trialResultBody,
  trialResultDefaults,
  trialResultFormSchema,
  trialResultRow,
} from '../src/pages/crm/prospect-trial-results.ts'

type Prospect = ReturnType<typeof createSeed>['prospects'][number]

const NOW = Date.parse('2026-10-15T09:00:00.000Z')
const HELD = '2026-10-14T10:00:00.000Z'
const UPCOMING = '2026-10-20T10:00:00.000Z'
const base = createSeed().prospects[0] as Prospect
const actor = { role: 'onburo' as const, userId: 'u-front' }
const trial = (patch: Partial<ProspectTrialLesson> = {}): ProspectTrialLesson => ({
  lessonId: 'l-trial',
  classId: 'c1',
  date: HELD,
  duration: 45,
  guardianConsentAt: HELD,
  scheduledAt: HELD,
  by: actor,
  ...patch,
})
const prospect = (patch: Partial<Prospect>): Prospect => ({
  ...base,
  stage: 'Görüşme planlandı',
  trialLesson: trial(),
  ...patch,
})
const wrap = (record: Prospect) => ({
  id: record.id,
  version: 3,
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
  archivedAt: null,
  record,
})
const groups = new Map([['c1', 'B1 Akşam']])
const row = (record: Prospect) => trialResultRow(wrap(record), 'language_school', groups, NOW)

test('DOM-DIL-031: yapılmış dersin açık adayında sonuç yazılabilir; ders başlamadan yazılamaz', () => {
  assert.equal(trialResultBlock(prospect({}), NOW), null)
  // Core dersin başlangıcı geçmişse yapılmış sayar: tam başlangıç anında yazılabilir.
  assert.equal(trialResultBlock(prospect({}), Date.parse(HELD)), null)
  assert.match(
    trialResultBlock(prospect({ trialLesson: trial({ date: UPCOMING }) }), NOW) ?? '',
    /henüz yapılmadı/,
  )
})

test('DOM-DIL-031: kapalı aday, iptal edilmiş ders ve denemesiz aday için form kilitlenir', () => {
  assert.match(trialResultBlock(prospect({ stage: 'Kayıt oldu' }), NOW) ?? '', /kesin kayıt/)
  assert.match(trialResultBlock(prospect({ stage: 'Vazgeçti' }), NOW) ?? '', /vazgeçti/)
  assert.match(trialResultBlock(prospect({}), NOW, true) ?? '', /iptal edildi/)
  const withoutTrial = prospect({ trialLesson: undefined })
  assert.match(trialResultBlock(withoutTrial, NOW) ?? '', /deneme dersi yok/)
})

test('DOM-DIL-031, DOM-YTK-080: satır grup adını, ders anını ve sonuç rozetini gösterir', () => {
  const pending = row(prospect({ minor: true }))
  assert.ok(pending)
  assert.equal(pending.group, 'B1 Akşam')
  assert.equal(pending.trialLabel, '14 Eki 2026 Çarşamba · 13:00 – 13:45')
  assert.equal(pending.minor, true)
  assert.equal(pending.stageLabel, 'Seviye tespiti / deneme dersi planlandı')
  assert.deepEqual(
    [pending.resultLabel, pending.resultTone, pending.fit],
    ['Sonuç bekliyor', 'amber', null],
  )
  assert.equal(pending.writable, true)

  const recorded = row(
    prospect({
      minor: false,
      trialLesson: trial({
        classId: 'c-unknown',
        result: { fit: 'lower_level', note: null, recordedAt: HELD, by: actor },
      }),
    }),
  )
  assert.ok(recorded)
  assert.equal(recorded.group, '—')
  assert.equal(recorded.minor, false)
  assert.deepEqual(
    [recorded.resultLabel, recorded.resultTone, recorded.fit],
    ['Alt kur önerilir', 'purple', 'lower_level'],
  )
  const suitable = row(
    prospect({
      trialLesson: trial({ result: { fit: 'suitable', note: 'İyi', recordedAt: HELD, by: actor } }),
    }),
  )
  assert.deepEqual([suitable?.resultLabel, suitable?.resultTone], ['Uygun', 'green'])
})

test('DOM-DIL-031: sonucu olmayan satırda ders bekleniyor, kapalı adayda yazılmadı görünür', () => {
  const upcoming = row(prospect({ trialLesson: trial({ date: UPCOMING }) }))
  assert.deepEqual(
    [upcoming?.resultLabel, upcoming?.resultTone, upcoming?.writable],
    ['Ders bekleniyor', 'gray', false],
  )
  const closed = row(prospect({ stage: 'Vazgeçti' }))
  assert.deepEqual([closed?.resultLabel, closed?.writable], ['Sonuç yazılmadı', false])
  // Kapalı adayın yazılmış sonucu korunur ve gösterilir.
  const enrolled = row(
    prospect({
      stage: 'Kayıt oldu',
      trialLesson: trial({
        result: { fit: 'upper_level', note: null, recordedAt: HELD, by: actor },
      }),
    }),
  )
  assert.deepEqual([enrolled?.resultLabel, enrolled?.writable], ['Üst kur önerilir', false])
  // Deneme dersi olmayan kayıt listelenmez.
  const withoutTrial = prospect({ trialLesson: undefined })
  assert.equal(row(withoutTrial), null)
})

test('DOM-DIL-031: form kararsız gönderilmez, not 500 karakteri aşamaz; boş not gövdeye girmez', () => {
  const missing = trialResultFormSchema.safeParse({ fit: '', note: '' })
  assert.equal(missing.success, false)
  assert.equal(missing.error?.issues[0]?.message, 'Seviye uygunluğunu seçin.')
  const long = trialResultFormSchema.safeParse({
    fit: 'suitable',
    note: 'x'.repeat(TRIAL_RESULT_NOTE_MAX + 1),
  })
  assert.equal(long.success, false)
  assert.deepEqual(long.error?.issues[0]?.path, ['note'])

  const blank = trialResultFormSchema.parse({ fit: 'suitable', note: '   ' })
  assert.deepEqual(trialResultBody(blank), { fit: 'suitable' })
  const noted = trialResultFormSchema.parse({ fit: 'upper_level', note: '  Okuması güçlü. ' })
  assert.deepEqual(trialResultBody(noted), { fit: 'upper_level', note: 'Okuması güçlü.' })
})

test('DOM-DIL-031: yeniden yazmada form önceki kararla açılır; sonuç yoksa boştur', () => {
  assert.deepEqual(trialResultDefaults(undefined), { fit: '', note: '' })
  assert.deepEqual(trialResultDefaults(trial()), { fit: '', note: '' })
  assert.deepEqual(
    trialResultDefaults(
      trial({
        result: { fit: 'lower_level', note: 'Dinleme zayıf.', recordedAt: HELD, by: actor },
      }),
    ),
    { fit: 'lower_level', note: 'Dinleme zayıf.' },
  )
  assert.deepEqual(
    trialResultDefaults(
      trial({ result: { fit: 'suitable', note: null, recordedAt: HELD, by: actor } }),
    ),
    { fit: 'suitable', note: '' },
  )
})

test('IST-079: deneme dersi günü aralığı sunucuya trialLesson.date alanıyla gider', () => {
  assert.equal(TRIAL_DATE_FILTER.type, 'date')
  assert.deepEqual(
    withDayRange(
      { filters: { stage: 'Teklif verildi' } },
      { min: '2026-10-01', max: '2026-10-31' },
      'trialLesson.date',
    ),
    {
      filters: {
        stage: 'Teklif verildi',
        dateField: 'trialLesson.date',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
      },
    },
  )
  const query = { filters: {} }
  assert.equal(withDayRange(query, undefined, 'trialLesson.date'), query)
})
