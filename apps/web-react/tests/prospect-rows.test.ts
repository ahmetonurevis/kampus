import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import {
  ALL_STAGES,
  CONTACT_LABELS,
  CREATED_FILTER,
  isOpenStage,
  prospectContactOwner,
  meetingEvents,
  meetingView,
  meetingWeek,
  meetingWeekStart,
  meetingWeekTitle,
  prospectRow,
  slotLabel,
  stageFilter,
  stageTabs,
  stageTargets,
  stageTone,
  withCreatedRange,
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
  const school = (stageFilter('school').options ?? []).map((item) => item.label)
  const language = (stageFilter('language_school').options ?? []).map((item) => item.label)
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
        trialLesson: {
          lessonId: 'l1',
          classId: 'c1',
          date: FUTURE,
          duration: 40,
          guardianConsentAt: null,
          scheduledAt: PAST,
          by: { role: 'onburo', userId: 'u-onburo' },
        },
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

test('DOM-KAY-003: telefon ve e-posta 18 yaş altı adayda velinindir; kaydında yaş bayrağı olmayan eski aday 18 yaş altı sayılır', () => {
  assert.equal(prospectContactOwner({ minor: true }), 'guardian')
  assert.equal(prospectContactOwner({ minor: false }), 'self')
  assert.equal(prospectContactOwner({}), 'guardian')
  assert.deepEqual(CONTACT_LABELS.guardian, { phone: 'Veli telefonu', email: 'Veli e-postası' })
  assert.deepEqual(CONTACT_LABELS.self, { phone: 'Telefon', email: 'E-posta' })
})

test('DOM-KAY-003: aday satırı telefonun sahibini taşır', () => {
  const row = (minor: boolean | undefined) => {
    const record = prospect({ trialAt: undefined })
    if (minor === undefined) delete record.minor
    else record.minor = minor
    return prospectRow(
      {
        id: record.id,
        version: 1,
        createdAt: new Date(NOW).toISOString(),
        updatedAt: new Date(NOW).toISOString(),
        archivedAt: null,
        record,
      },
      'language_school',
      { branches: new Map() },
    )
  }
  assert.equal(row(true).phoneOwner, 'guardian')
  assert.equal(row(undefined).phoneOwner, 'guardian')
  assert.equal(row(false).phoneOwner, 'self')
})

// --- ON-035: Vue eşitliği (Crm.vue aday listesi ve Tanışma Görüşmeleri) -------------------

test('ON-035, DOM-KAY-007: kayıt tarihi aralığı sunucuya createdAt günü olarak gider, öteki süzgeçler korunur', () => {
  const base = { page: 2, filters: { stage: 'Yeni aday' } }
  assert.equal(CREATED_FILTER.type, 'date')
  assert.deepEqual(withCreatedRange(base, { min: '2026-10-01', max: '2026-10-31' }), {
    page: 2,
    filters: {
      stage: 'Yeni aday',
      dateField: 'createdAt',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    },
  })
  // Tek uç açık aralıktır.
  assert.deepEqual(withCreatedRange({}, { min: '', max: '2026-10-31' }).filters, {
    dateField: 'createdAt',
    dateTo: '2026-10-31',
  })
})

test('ON-035: boş, biçimsiz ve ters kayıt tarihi aralığı sorguyu değiştirmez', () => {
  const base = { filters: { source: 'Telefon' } }
  assert.equal(withCreatedRange(base, undefined), base)
  assert.equal(withCreatedRange(base, ''), base)
  assert.equal(withCreatedRange(base, { min: null, max: '' }), base)
  assert.equal(withCreatedRange(base, { min: '1.10.2026', max: 'x' }), base)
  assert.equal(withCreatedRange(base, { min: '2026-10-31', max: '2026-10-01' }), base)
})

test('ON-035: aşama sekmeleri tüm adaylar ve her aşamayı sayısıyla verir; sayım yokken rozet yoktur', () => {
  const counts = {
    total: 9,
    groups: [
      { value: 'Yeni aday', count: 5 },
      { value: 'Kayıt oldu', count: 3 },
      { value: null, count: 1 },
    ],
  }
  const tabs = stageTabs(counts, 'school')
  assert.deepEqual(tabs[0], { value: ALL_STAGES, label: 'Tüm adaylar', count: 9 })
  assert.equal(tabs.length, 7)
  assert.deepEqual(
    tabs.map((tab) => tab.count),
    [9, 5, 0, 0, 0, 3, 0],
  )
  assert.ok(stageTabs(undefined, 'school').every((tab) => tab.count === undefined))
  const language = stageTabs(counts, 'language_school').map((tab) => tab.label)
  assert.ok(language.includes('Seviye tespiti / deneme dersi planlandı'))
  // Sekme değeri saklanan aşamadır; dil okulu adı yalnız etikettir.
  assert.ok(stageTabs(counts, 'language_school').some((tab) => tab.value === 'Görüşme planlandı'))
})

test('ON-035: görünüm adresten okunur; bilinmeyen değer listedir', () => {
  assert.equal(meetingView('hafta'), 'hafta')
  assert.equal(meetingView('liste'), 'liste')
  assert.equal(meetingView(null), 'liste')
  assert.equal(meetingView('ay'), 'liste')
})

test('ON-035: hafta adresteki günün pazartesisidir; geçersiz değer bugünün haftasıdır', () => {
  // 15 Ekim 2026 perşembe.
  assert.equal(meetingWeekStart(null, '2026-10-15'), '2026-10-12')
  assert.equal(meetingWeekStart('2026-10-25', '2026-10-15'), '2026-10-19')
  assert.equal(meetingWeekStart('bozuk', '2026-10-15'), '2026-10-12')
  assert.equal(meetingWeekTitle('2026-10-19'), '19 Eki – 25 Eki 2026')
})

test('ON-035, DOM-KAY-033: haftalık takvim yedi gündür; olaylar kendi gününde saat sırasıyla, bugün işaretli', () => {
  const events = meetingEvents(
    [
      prospect({ id: 'p-late', stage: 'Görüşme planlandı', trialAt: '2026-10-20T13:00:00.000Z' }),
      prospect({ id: 'p-early', stage: 'Görüşme planlandı', trialAt: '2026-10-20T07:00:00.000Z' }),
      prospect({ id: 'p-next', stage: 'Görüşme planlandı', trialAt: '2026-10-27T10:00:00.000Z' }),
      // İstanbul'da 26 Ekim 01:30: UTC günü 25 Ekim olsa da sonraki haftadadır.
      prospect({ id: 'p-edge', stage: 'Görüşme planlandı', trialAt: '2026-10-25T22:30:00.000Z' }),
    ],
    'school',
    context,
  )
  const week = meetingWeek(events, '2026-10-19', '2026-10-20')
  assert.equal(week.length, 7)
  assert.deepEqual(
    week.map((day) => day.day),
    [
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ],
  )
  assert.deepEqual(
    week[1]?.events.map((event) => event.prospectId),
    ['p-early', 'p-late'],
  )
  assert.deepEqual(
    week.map((day) => day.today),
    [false, true, false, false, false, false, false],
  )
  assert.equal(
    week.flatMap((day) => day.events).some((event) => event.prospectId === 'p-next'),
    false,
  )
  assert.equal(
    week.flatMap((day) => day.events).some((event) => event.prospectId === 'p-edge'),
    false,
  )
  assert.match(week[0]?.label ?? '', /Pazartesi/)
})
