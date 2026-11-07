import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { ApiError } from '../packages/api-client/src/errors.ts'
import { meetingEvents, type ProspectRecord } from '../packages/react-shared/src/prospect-model.ts'
import { PROSPECT_CHANGED_MESSAGE } from '../packages/react-shared/src/use-prospect-commands.ts'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { EMPTY_LIST_STATE } from '../apps/mobile/src/api/list-state.ts'
import { screenRegistryIssues } from '../apps/mobile/src/api/pages.ts'
import {
  PROSPECT_MEETINGS_SCREEN,
  PROSPECTS_SCREEN,
} from '../apps/mobile/src/api/prospect-screen.ts'
import {
  canOpenMeetings,
  canOpenProspects,
  checkNote,
  contactLine,
  filterMeetings,
  LOST_REASON_OPTIONS,
  meetingKindOptions,
  meetingListItem,
  pageOf,
  prospectFacts,
  prospectFailure,
  prospectHistory,
  prospectListItem,
  prospectListQuery,
  prospectPlans,
  stageChoices,
  stageFilterOptions,
  stageTone,
} from '../apps/mobile/src/api/prospect-mobile.ts'
import { SCREEN_REGISTRY, type ScreenEntry } from '../apps/mobile/src/api/screen-registry.ts'

const NOW = Date.parse('2026-10-15T09:00:00.000Z')
const ACTOR = { role: 'onburo', userId: 'u-onburo' } as const
const base = createSeed(new Date(NOW)).prospects[0] as ProspectRecord
const prospect = (patch: Partial<ProspectRecord>): ProspectRecord => ({ ...base, ...patch })
const apiError = (status: number, code: string, message = 'Sunucu iletisi') =>
  new ApiError({ status, code, message })
const modules = (patch: Record<string, boolean> = {}) => ({ crm: true, finance: true, ...patch })

describe('mobil ön büro adayları (ON-122)', () => {
  test('ON-122 kayıt satırları kurallara uyar: ön büronun iki menü yolu', () => {
    const entries: readonly ScreenEntry[] = [
      ...SCREEN_REGISTRY,
      PROSPECTS_SCREEN,
      PROSPECT_MEETINGS_SCREEN,
    ]
    const unique = entries.filter(
      (entry, at) => entries.findIndex((item) => item.screen === entry.screen) === at,
    )
    assert.deepEqual(screenRegistryIssues(unique), [])
    assert.deepEqual(
      [...PROSPECTS_SCREEN.pages, ...PROSPECT_MEETINGS_SCREEN.pages].map(
        (page) => `${page.role}/${page.path}`,
      ),
      ['onburo/adaylar', 'onburo/deneme-dersi-takvimi'],
    )
  })

  test('ON-122 kayıt satırları var olan ve varsayılan bileşen veren ekran dosyalarını yükler', () => {
    for (const [entry, name] of [
      [PROSPECTS_SCREEN, 'FrontOfficeProspects'],
      [PROSPECT_MEETINGS_SCREEN, 'FrontOfficeMeetings'],
    ] as const) {
      const path = /require\('(\.\/screens\/[\w-]+\.tsx)'\)\.default/.exec(
        entry.getComponent.toString(),
      )?.[1]
      assert.ok(path)
      const url = new URL(`../apps/mobile/src/api/${path}`, import.meta.url)
      assert.ok(existsSync(url))
      assert.match(
        readFileSync(url, 'utf8'),
        new RegExp(`^export default function ${name}\\(`, 'm'),
      )
    }
  })

  test('DOM-YTK-040: ekran yalnız ön büroda ve crm modülü açıkken açılır', () => {
    assert.equal(canOpenProspects({ role: 'onburo', modules: modules() }), true)
    assert.equal(canOpenMeetings({ role: 'onburo', modules: modules() }), true)
    assert.equal(canOpenProspects({ role: 'onburo', modules: modules({ crm: false }) }), false)
    assert.equal(canOpenMeetings({ role: 'onburo', modules: modules({ crm: false }) }), false)
    assert.equal(canOpenProspects({ role: 'yonetici', modules: modules() }), false)
    assert.equal(canOpenProspects({ role: 'veli', modules: modules() }), false)
  })

  test('DOM-KAY-005: liste sorgusu arama, aşama ve kararlı sırayı sunucuya verir', () => {
    assert.deepEqual(prospectListQuery(EMPTY_LIST_STATE, ''), {
      page: 1,
      pageSize: 10,
      sort: ['-createdAt', 'id'],
    })
    assert.deepEqual(prospectListQuery({ search: '', index: 2, filter: 'Vazgeçti' }, '  0532 '), {
      page: 3,
      pageSize: 10,
      sort: ['-createdAt', 'id'],
      q: '0532',
      filters: { stage: 'Vazgeçti' },
    })
    // Tek harf arama ve bilinmeyen aşama gönderilmez (sunucu 400 vermesin).
    assert.deepEqual(
      prospectListQuery({ search: '', index: 0, filter: 'uydurma' }, 'a'),
      prospectListQuery(EMPTY_LIST_STATE, ''),
    )
  })

  test('aşama süzgeci tümü ve her aşama; dil okulunda görüşme aşaması seviye tespitidir', () => {
    const school = stageFilterOptions('school')
    assert.equal(school[0]?.value, '')
    assert.equal(school.length, 7)
    assert.ok(
      stageFilterOptions('language_school').some(
        (option) => option.label === 'Seviye tespiti / deneme dersi planlandı',
      ),
    )
  })

  test('DOM-KAY-003: telefon 18 yaş altında velinindir ve satırda belirtilir', () => {
    assert.equal(contactLine({ phone: '0532', minor: true }), 'Veli · 0532')
    assert.equal(contactLine({ phone: '0532' }), 'Veli · 0532')
    assert.equal(contactLine({ phone: '0532', minor: false }), '0532')
    const item = prospectListItem(
      prospect({ name: 'Alara', interest: 'B1', stage: 'Teklif verildi', minor: false }),
      'language_school',
      'Merkez',
    )
    assert.deepEqual(item, {
      title: 'Alara',
      subtitle: 'B1 · Merkez',
      contact: base.phone,
      stageLabel: 'Teklif verildi',
      tone: 'amber',
      label: 'Alara, Teklif verildi, ayrıntıyı aç',
    })
    assert.equal(
      prospectListItem(prospect({ interest: 'LGS' }), 'school', undefined).subtitle,
      'LGS',
    )
  })

  test('aşama tonu: kayıt yeşil, vazgeçme kırmızı, teklif sarı, diğerleri safir', () => {
    assert.equal(stageTone('Kayıt oldu'), 'green')
    assert.equal(stageTone('Vazgeçti'), 'red')
    assert.equal(stageTone('Teklif verildi'), 'amber')
    assert.equal(stageTone('Yeni aday'), 'primary')
    assert.equal(stageTone(undefined), 'primary')
  })

  test('DOM-KAY-003, DOM-KAY-005: kart iletişim sahibini, veliyi ve vazgeçme nedenini doğru gösterir', () => {
    const minor = prospectFacts(
      prospect({ minor: true, guardianName: 'Ayşe Yılmaz', email: 'veli@ornek.test' }),
      'school',
      { branch: 'Merkez' },
    )
    const labels = minor.map(([label]) => label)
    assert.ok(labels.includes('Veli telefonu'))
    assert.ok(labels.includes('Veli e-postası'))
    assert.ok(labels.includes('Veli'))
    assert.ok(labels.includes('İlgilendiği program'))
    assert.ok(!labels.includes('Vazgeçme nedeni'))
    const adult = prospectFacts(
      prospect({
        minor: false,
        guardianName: 'Ayşe Yılmaz',
        email: undefined,
        stage: 'Vazgeçti',
        lostReason: 'price',
        lostToInstitution: 'Başka Okul',
      }),
      'language_school',
      {},
    )
    assert.deepEqual(adult.slice(0, 3), [
      ['Telefon', base.phone],
      ['Kampüs', '—'],
      ['Hedef seviye', base.interest],
    ])
    assert.ok(!adult.some(([label]) => label === 'Veli'))
    assert.ok(adult.some(([label, value]) => label === 'Vazgeçme nedeni' && value === 'Fiyat'))
    assert.ok(
      adult.some(([label, value]) => label === 'Tercih ettiği kurum' && value === 'Başka Okul'),
    )
  })

  test('DOM-KAY-033, DOM-KAY-034: planlanmış görüşme ve deneme dersi yazılır', () => {
    assert.deepEqual(
      prospectPlans(prospect({ trialAt: undefined, trialLesson: undefined }), {}),
      [],
    )
    const plans = prospectPlans(
      prospect({
        trialAt: '2026-10-20T10:00:00.000Z',
        meeting: {
          date: '2026-10-20T10:00:00.000Z',
          duration: 30,
          room: 'Oda 2',
          teacherId: null,
          scheduledAt: '2026-10-01T09:00:00.000Z',
          by: ACTOR,
        },
        trialLesson: {
          lessonId: 'l-1',
          classId: 'c-1',
          date: '2026-10-21T10:00:00.000Z',
          duration: 40,
          guardianConsentAt: null,
          scheduledAt: '2026-10-01T09:00:00.000Z',
          by: ACTOR,
        },
      }),
      { branch: 'Merkez', group: 'A2 Akşam' },
    )
    assert.equal(plans[0]?.[0], 'Tanışma görüşmesi')
    assert.match(plans[0]?.[1] ?? '', /13:00 – 13:30 · Oda 2 · Merkez$/)
    assert.equal(plans[1]?.[0], 'Deneme dersi')
    assert.match(plans[1]?.[1] ?? '', /13:00 – 13:40 · A2 Akşam$/)
  })

  test('DOM-KAY-032: iletişim geçmişi notları yazarıyla sırayla verir, en altta açılış satırı', () => {
    const history = prospectHistory(
      prospect({
        source: 'Web sitesi',
        notes: [{ id: 'n1', text: 'Arandı', date: '2026-10-01T09:00:00.000Z', author: 'Elif' }],
      }),
    )
    assert.equal(history.length, 2)
    assert.equal(history[0]?.text, 'Arandı')
    assert.match(history[0]?.meta ?? '', / · Elif$/)
    assert.equal(history[1]?.text, 'Web sitesi üzerinden aday kaydı oluşturuldu.')
  })

  test('DOM-KAY-030: aşama seçenekleri yalnız geçerli hedeflerdir; kayıtlı adayda seçenek yok', () => {
    assert.deepEqual(
      stageChoices('Yeni aday', 'school').map((choice) => choice.value),
      ['İletişime geçildi', 'Teklif verildi', 'Vazgeçti'],
    )
    assert.deepEqual(stageChoices('Kayıt oldu', 'school'), [])
    assert.deepEqual(
      stageChoices('Vazgeçti', 'school').map((choice) => choice.value),
      ['İletişime geçildi'],
    )
    assert.equal(LOST_REASON_OPTIONS.find((option) => option.value === 'price')?.label, 'Fiyat')
  })

  test('DOM-KAY-032: not 2–2000 karakter, kırpılarak gider; geçersizse istek atılmaz', () => {
    assert.deepEqual(checkNote('  Arandı  '), { ok: true, body: { text: 'Arandı' } })
    assert.deepEqual(checkNote(' a '), { ok: false, error: 'En az 2 karakter girin.' })
    const long = checkNote('x'.repeat(2001))
    assert.equal(long.ok, false)
  })

  test('DOM-KAY-030: sürüm çakışması, kardeş isteği ve alan hatası pencere içinde gösterilir', () => {
    const changed = prospectFailure(apiError(409, 'version_conflict'))
    assert.equal(changed.changed, true)
    assert.equal(changed.message, PROSPECT_CHANGED_MESSAGE)
    const shared = prospectFailure(apiError(409, 'prospect_contact_shared', 'Kardeş seçin.'))
    assert.equal(shared.contactShared, true)
    assert.equal(shared.message, 'Kardeş seçin.')
    const field = prospectFailure(apiError(422, 'validation_error'), {
      lostReason: 'Neden seçin.',
    })
    assert.equal(field.message, null)
    assert.deepEqual(field.fields, { lostReason: 'Neden seçin.' })
  })
})

describe('mobil tanışma görüşmeleri (ON-122)', () => {
  const events = meetingEvents(
    [
      prospect({ id: 'p-past', stage: 'Görüşme planlandı', trialAt: '2026-10-10T10:00:00.000Z' }),
      prospect({ id: 'p-soon', stage: 'Görüşme planlandı', trialAt: '2026-10-20T10:00:00.000Z' }),
      prospect({
        id: 'p-trial',
        stage: 'Teklif verildi',
        trialAt: undefined,
        trialLesson: {
          lessonId: 'l-1',
          classId: 'c-1',
          date: '2026-10-22T10:00:00.000Z',
          duration: 40,
          guardianConsentAt: null,
          scheduledAt: '2026-10-01T09:00:00.000Z',
          by: ACTOR,
        },
      }),
      prospect({ id: 'p-closed', stage: 'Kayıt oldu', trialAt: '2026-10-21T10:00:00.000Z' }),
    ],
    'language_school',
    { now: NOW, branches: new Map(), classes: new Map([['c-1', 'A2 Akşam']]) },
  )

  test('DOM-KAY-033: yaklaşan ve geçmiş ayrı görünür; kapalı adayın görüşmesi listelenmez', () => {
    assert.deepEqual(
      filterMeetings(events, 'upcoming', '').map((event) => event.prospectId),
      ['p-soon', 'p-trial'],
    )
    assert.deepEqual(
      filterMeetings(events, 'past', '').map((event) => event.prospectId),
      ['p-past'],
    )
  })

  test('DOM-KAY-034: tür süzgeci yalnız dil okulunda; deneme dersi ayrı süzülür', () => {
    assert.deepEqual(meetingKindOptions('school'), [])
    assert.equal(meetingKindOptions('language_school').length, 3)
    assert.deepEqual(
      filterMeetings(events, 'upcoming', 'trial').map((event) => event.id),
      ['p-trial:trial'],
    )
    assert.equal(filterMeetings(events, 'upcoming', 'uydurma').length, 2)
  })

  test('görüşme satırı bilinmeyen kampüsü ve odayı yazmaz, zamanı üstte verir', () => {
    const soon = events.find((event) => event.prospectId === 'p-soon')!
    const item = meetingListItem(soon)
    assert.equal(item.subtitle, 'Tanışma görüşmesi')
    assert.match(item.eyebrow, /13:00 – 13:30$/)
    assert.equal(item.tone, 'primary')
    const trial = meetingListItem(events.find((event) => event.kind === 'trial')!)
    assert.equal(trial.subtitle, 'Deneme dersi · A2 Akşam')
  })

  test('bellekteki liste sayfalara bölünür', () => {
    const items = Array.from({ length: 23 }, (_, at) => at)
    assert.deepEqual(pageOf(items, 0).length, 10)
    assert.deepEqual(pageOf(items, 2), [20, 21, 22])
    assert.deepEqual(pageOf(items, 5), [])
  })
})
