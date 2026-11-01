import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  isOpenStage,
  meetingEvents,
  prospectRow,
  slotLabel,
  stageFilter,
  stageTargets,
  stageTone,
} from '../src/pages/crm/prospect-rows.ts'

type Prospect = ReturnType<typeof createSeed>['prospects'][number]

const NOW = Date.parse('2026-10-15T09:00:00.000Z')
const FUTURE = '2026-10-20T10:00:00.000Z'
const LATER = '2026-10-25T10:00:00.000Z'
const PAST = '2026-10-10T10:00:00.000Z'
const base = createSeed().prospects[0] as Prospect
const prospect = (patch: Partial<Prospect>): Prospect => ({ ...base, ...patch })
const context = {
  now: NOW,
  branches: new Map([[base.branchId, 'Merkez Kampüs']]),
  classes: new Map([['c1', 'A2 Akşam']]),
}

test('DOM-KAY-030: aşama hedefleri yalnız geçerli, planlama ve kesin kayıt dışı seçenektir', () => {
  assert.deepEqual(stageTargets('Yeni aday'), ['İletişime geçildi', 'Teklif verildi', 'Vazgeçti'])
  assert.deepEqual(stageTargets('Teklif verildi'), ['Vazgeçti'])
  assert.deepEqual(stageTargets('Vazgeçti'), ['İletişime geçildi'])
  assert.deepEqual(stageTargets('Kayıt oldu'), [])
})

test('DOM-KAY-032: yalnız açık aşama açıktır', () => {
  assert.equal(isOpenStage('Görüşme planlandı'), true)
  assert.equal(isOpenStage('Vazgeçti'), false)
  assert.equal(isOpenStage('Kayıt oldu'), false)
  assert.equal(isOpenStage(undefined), false)
})

test('aşama tonu bilinmeyen aşamada gri, kapalı aşamalarda yeşil/kırmızıdır', () => {
  assert.equal(stageTone('Kayıt oldu'), 'green')
  assert.equal(stageTone('Vazgeçti'), 'red')
  assert.equal(stageTone('Teklif verildi'), 'amber')
  assert.equal(stageTone('?'), 'gray')
})

test('aşama süzgeci dil okulunda görüşme aşamasını seviye tespiti olarak adlandırır', () => {
  const school = stageFilter('school').options.map((item) => item.label)
  const language = stageFilter('language_school').options.map((item) => item.label)
  assert.equal(school.length, language.length)
  assert.ok(school.includes('Görüşme planlandı'))
  assert.ok(!language.includes('Görüşme planlandı'))
})

test('aday satırı kampüs adını ilişkiden, yoksa tablodan, o da yoksa tire olarak alır', () => {
  const record = prospect({ trialAt: undefined })
  const wrap = (joined?: { branchName?: string }) => ({
    id: record.id,
    version: 1,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    archivedAt: null,
    record,
    ...(joined ? { joined } : {}),
  })
  const lookups = { branches: new Map([[record.branchId, 'Tablo Kampüsü']]) }
  assert.equal(
    prospectRow(wrap({ branchName: 'İlişki Kampüsü' }), 'school', lookups).branch,
    'İlişki Kampüsü',
  )
  assert.equal(prospectRow(wrap(), 'school', lookups).branch, 'Tablo Kampüsü')
  assert.equal(prospectRow(wrap(), 'school', { branches: new Map() }).branch, '—')
  assert.equal(prospectRow(wrap(), 'school', lookups).meetingLabel, '—')
})

test('slotLabel süreyi başlangıca ekleyip İstanbul saatiyle aralık yazar', () => {
  assert.equal(slotLabel('2026-10-20T10:00:00.000Z', 45), '13:00 – 13:45')
})

test('DOM-KAY-033: görüşme olayları yaklaşan önce yakından uzağa, geçmişler sonra yeniden eskiye sıralanır', () => {
  const events = meetingEvents(
    [
      prospect({ id: 'p-past', stage: 'Görüşme planlandı', trialAt: PAST }),
      prospect({ id: 'p-later', stage: 'Görüşme planlandı', trialAt: LATER }),
      prospect({ id: 'p-soon', stage: 'Görüşme planlandı', trialAt: FUTURE }),
    ],
    'school',
    context,
  )
  assert.deepEqual(
    events.map((event) => event.prospectId),
    ['p-soon', 'p-later', 'p-past'],
  )
  assert.deepEqual(
    events.map((event) => event.upcoming),
    [true, true, false],
  )
  assert.equal(events[0]?.timeRange, '13:00 – 13:30')
})

test('DOM-KAY-033: kapalı adayın görüşmesi listelenmez', () => {
  const events = meetingEvents(
    [
      prospect({ id: 'p-lost', stage: 'Vazgeçti', trialAt: FUTURE }),
      prospect({ id: 'p-enrolled', stage: 'Kayıt oldu', trialAt: FUTURE }),
    ],
    'school',
    context,
  )
  assert.deepEqual(events, [])
})

test('DOM-KAY-034: deneme dersi ayrı olay olur ve grup adını taşır', () => {
  const events = meetingEvents(
    [
      prospect({
        id: 'p-trial',
        stage: 'Görüşme planlandı',
        trialLesson: { lessonId: 'l1', classId: 'c1', date: FUTURE, duration: 40 },
      }),
    ],
    'language_school',
    context,
  )
  assert.equal(events.length, 1)
  assert.equal(events[0]?.kind, 'trial')
  assert.equal(events[0]?.kindLabel, 'Deneme dersi')
  assert.equal(events[0]?.place, 'A2 Akşam')
  assert.equal(events[0]?.timeRange, '13:00 – 13:40')
  assert.equal(events[0]?.branch, 'Merkez Kampüs')
})
