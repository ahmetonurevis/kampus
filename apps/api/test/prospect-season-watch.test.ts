import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { ROLES } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { CollectionName, RecordData } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  type InstitutionOverrides,
} from './support/app.ts'
import { lazySession } from './support/finance-sessions.ts'

// Kayıt sezonu nöbeti (`GET /api/v1/prospects/season-watch`; DOM-KAY-037, ON-077; IST-079,
// IST-091): penceredeki görüşmeler, dil okulunda deneme dersleri ve geciken takipler; yalnız
// yönetici ve ön büro, modül `crm`. Şu an FIXED_NOW = 2026-10-06 12:00 Europe/Istanbul.

const URL = '/api/v1/prospects/season-watch'
const PHONE = '05559990001'

type Item = { collection: CollectionName; id: string; data: RecordData }
const prospect = (id: string, overrides: RecordData = {}): Item => ({
  collection: 'prospects',
  id,
  data: {
    id,
    name: `Aday ${id}`,
    phone: PHONE,
    email: `${id}@aday.example`,
    guardianName: 'Gizli Veli',
    interest: '7. Sınıf · Ortaokul',
    source: 'Web sitesi',
    branchId: 'sw-b1',
    stage: 'İletişime geçildi',
    studentId: null,
    trialAt: null,
    notes: [],
    createdAt: '2026-10-05T08:00:00.000Z',
    updatedAt: '2026-10-05T08:00:00.000Z',
    ...overrides,
  },
})
const meeting = (date: string, teacherId: string | null = 'sw-t1') => ({
  trialAt: date,
  meeting: {
    date,
    duration: 45,
    room: 'Oda 1',
    teacherId,
    scheduledAt: '2026-10-01T08:00:00.000Z',
    by: { role: 'onburo', userId: 'u1' },
  },
})
const note = (date: string) => ({
  id: `note-${date}`,
  text: 'Gizli not metni',
  date,
  author: 'Ön Büro',
})
const lookups: Item[] = [
  { collection: 'branches', id: 'sw-b1', data: { id: 'sw-b1', name: 'Merkez Kampüs' } },
  { collection: 'teachers', id: 'sw-t1', data: { id: 'sw-t1', name: 'Selin Kaya' } },
  { collection: 'classes', id: 'sw-c1', data: { id: 'sw-c1', name: 'A1 Sabah' } },
]
const lesson = (id: string, date: string, overrides: RecordData = {}): Item => ({
  collection: 'schedule',
  id,
  data: { id, classId: 'sw-c1', date, duration: 60, cancelledAt: null, ...overrides },
})
const trial = (lessonId: string, result = false) => ({
  trialLesson: {
    lessonId,
    classId: 'sw-c1',
    date: '2026-01-01T00:00:00.000Z',
    duration: 60,
    guardianConsentAt: null,
    scheduledAt: '2026-10-01T08:00:00.000Z',
    by: { role: 'onburo', userId: 'u1' },
    ...(result
      ? {
          result: {
            fit: 'suitable',
            note: 'Gizli sonuç notu',
            recordedAt: '2026-10-04T10:00:00.000Z',
            by: { role: 'ogretmen', userId: 'u2' },
          },
        }
      : {}),
  },
})

describe('kayıt sezonu nöbeti (DOM-KAY-037, ON-077)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(items: Item[], overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    const front = await createMember(app, created.id, 'onburo')
    await insertMissingRecords(db, created.id, [...lookups, ...items], FIXED_NOW)
    return {
      ...created,
      session: lazySession(app, created.admin),
      frontSession: lazySession(app, front),
    }
  }

  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })

  test('DOM-KAY-037: oturumsuz 401; bilinmeyen parametre, sorgudaki institutionId ve aralık dışı gün 400', async () => {
    assert.equal((await get(URL)).statusCode, 401)
    const a = await institution([prospect('sw-1')])
    for (const query of ['institutionId=x', 'days=0', 'days=15', 'days=1.5', 'days=bir']) {
      const response = await get(`${URL}?${query}`, await a.session())
      assert.equal(response.statusCode, 400, `${query}: ${response.body}`)
      assert.equal(response.json().code, 'validation_failed', query)
    }
  })

  test('DOM-KAY-037: yönetici ve ön büro dışındaki roller 403, veri dönmez; crm kapalıyken 403 module_disabled', async () => {
    const a = await institution([prospect('sw-1', { stage: 'Yeni aday' })])
    for (const role of ROLES.filter((value) => value !== 'yonetici' && value !== 'onburo')) {
      const cookie = await signInAs(app, await createMember(app, a.id, role))
      const response = await get(URL, cookie)
      assert.equal(response.statusCode, 403, `${role}: ${response.body}`)
      assert.equal(response.json().code, 'forbidden', role)
      assert.ok(!response.body.includes('sw-1'), role)
    }
    const closed = await institution([prospect('sw-1')], { enabledModules: { crm: false } })
    for (const cookie of [await closed.session(), await closed.frontSession()]) {
      const response = await get(URL, cookie)
      assert.equal(response.statusCode, 403, response.body)
      assert.equal(response.json().code, 'module_disabled')
    }
  })

  test('DOM-KAY-037: okulda görüşmeler ve geciken takipler; yanıt iletişim, veli, not ve ilgi taşımaz', async () => {
    const a = await institution([
      prospect('sw-today', { stage: 'Görüşme planlandı', ...meeting('2026-10-06T13:00:00.000Z') }),
      prospect('sw-later', {
        stage: 'Görüşme planlandı',
        ...meeting('2026-10-10T07:00:00.000Z', null),
      }),
      prospect('sw-outside', {
        stage: 'Görüşme planlandı',
        ...meeting('2026-10-14T07:00:00.000Z'),
      }),
      prospect('sw-first', { stage: 'Yeni aday', createdAt: '2026-10-03T08:00:00.000Z' }),
      prospect('sw-outcome', {
        stage: 'Görüşme planlandı',
        ...meeting('2026-10-04T07:00:00.000Z'),
        notes: [note('2026-10-03T08:00:00.000Z')],
      }),
      prospect('sw-noted', {
        stage: 'Görüşme planlandı',
        ...meeting('2026-10-04T07:00:00.000Z'),
        notes: [note('2026-10-04T09:00:00.000Z'), note('2026-10-02T09:00:00.000Z')],
      }),
      prospect('sw-stale', {
        stage: 'Teklif verildi',
        createdAt: '2026-09-10T08:00:00.000Z',
        updatedAt: '2026-09-26T08:00:00.000Z',
        notes: [note('2026-09-20T08:00:00.000Z')],
      }),
      prospect('sw-lost', {
        stage: 'Vazgeçti',
        lostReason: 'price',
        ...meeting('2026-10-07T07:00:00.000Z'),
      }),
      prospect('sw-enrolled', { stage: 'Kayıt oldu', studentId: 's1' }),
      // Okulda deneme kaydı (eski veri) okunmaz.
      prospect('sw-trial', { stage: 'Görüşme planlandı', ...trial('sw-l1') }),
      lesson('sw-l1', '2026-10-07T07:00:00.000Z'),
    ])
    for (const cookie of [await a.session(), await a.frontSession()]) {
      const response = await get(URL, cookie)
      assert.equal(response.statusCode, 200, response.body)
      const data = response.json().data
      assert.deepEqual(data.window, { from: '2026-10-06', to: '2026-10-12', days: 7 })
      assert.equal(data.trialsEnabled, false)
      assert.deepEqual(
        data.meetings.rows.map((row: { prospectId: string; teacherName: string | null }) => [
          row.prospectId,
          row.teacherName,
        ]),
        [
          ['sw-today', 'Selin Kaya'],
          ['sw-later', null],
        ],
      )
      assert.equal(data.meetings.rows[0].branchName, 'Merkez Kampüs')
      assert.equal(data.meetings.rows[0].room, 'Oda 1')
      assert.equal(data.trials.total, 0)
      assert.deepEqual(
        data.followUps.rows.map((row: { prospectId: string; reason: string; days: number }) => [
          row.prospectId,
          row.reason,
          row.days,
        ]),
        [
          ['sw-stale', 'stale', 10],
          ['sw-first', 'first_contact', 3],
          ['sw-outcome', 'meeting_outcome', 2],
        ],
      )
      assert.deepEqual(data.summary, {
        meetingsToday: 1,
        meetingsInWindow: 2,
        trialsToday: 0,
        trialsInWindow: 0,
        followUps: 3,
        followUpsByReason: { first_contact: 1, meeting_outcome: 1, trial_outcome: 0, stale: 1 },
        newToday: 0,
      })
      for (const secret of [
        PHONE,
        '@aday.example',
        'Gizli Veli',
        'Gizli not',
        'Ortaokul',
        'Web sitesi',
        'sw-lost',
        'sw-enrolled',
      ])
        assert.ok(!response.body.includes(secret), secret)
    }
    const narrow = await get(`${URL}?days=1`, await a.frontSession())
    assert.equal(narrow.statusCode, 200, narrow.body)
    assert.deepEqual(narrow.json().data.window, { from: '2026-10-06', to: '2026-10-06', days: 1 })
    assert.equal(narrow.json().data.meetings.total, 1)
  })

  test('DOM-KAY-037: dil okulunda deneme dersi dersin güncel kaydından; iptal edilen ders girmez, sonucun kendisi dönmez', async () => {
    const a = await institution(
      [
        prospect('sw-tr-next', { stage: 'Görüşme planlandı', ...trial('sw-l1') }),
        prospect('sw-tr-cancel', { stage: 'Görüşme planlandı', ...trial('sw-l2') }),
        prospect('sw-tr-done', { stage: 'Görüşme planlandı', ...trial('sw-l3', true) }),
        prospect('sw-tr-gone', { stage: 'Görüşme planlandı', ...trial('sw-yok') }),
        lesson('sw-l1', '2026-10-08T07:00:00.000Z'),
        lesson('sw-l2', '2026-10-07T07:00:00.000Z', { cancelledAt: '2026-10-05T07:00:00.000Z' }),
        lesson('sw-l3', '2026-10-03T07:00:00.000Z'),
      ],
      { type: 'language_school' },
    )
    const response = await get(URL, await a.frontSession())
    assert.equal(response.statusCode, 200, response.body)
    const data = response.json().data
    assert.equal(data.trialsEnabled, true)
    assert.deepEqual(data.trials.rows, [
      {
        prospectId: 'sw-tr-next',
        name: 'Aday sw-tr-next',
        stage: 'Görüşme planlandı',
        branchName: 'Merkez Kampüs',
        date: '2026-10-08T07:00:00.000Z',
        duration: 60,
        groupName: 'A1 Sabah',
        held: false,
        resultRecorded: false,
      },
    ])
    assert.deepEqual(
      data.followUps.rows.map(
        (row: { prospectId: string; reason: string; trialResultRecorded: boolean | null }) => [
          row.prospectId,
          row.reason,
          row.trialResultRecorded,
        ],
      ),
      [['sw-tr-done', 'trial_outcome', true]],
    )
    assert.ok(!response.body.includes('Gizli sonuç'))
    assert.ok(!response.body.includes('suitable'))
  })

  test('DOM-KAY-037: başka kurumun adayı, dersi ve adları nöbete girmez; arşivlenen aday sayılmaz', async () => {
    const b = await institution(
      [
        prospect('sw-b-only', { stage: 'Yeni aday', createdAt: '2026-10-01T08:00:00.000Z' }),
        prospect('sw-1', { stage: 'Görüşme planlandı', ...trial('sw-l1') }),
        lesson('sw-l1', '2026-10-08T07:00:00.000Z'),
      ],
      { type: 'language_school' },
    )
    // A'nın adayı B'deki dersi ve öğretmeni gösteriyor: A'da ders ve ad yok sayılır.
    const a = await institution(
      [
        prospect('sw-1', {
          stage: 'Görüşme planlandı',
          ...trial('sw-l1'),
          ...meeting('2026-10-07T07:00:00.000Z', 'sw-t-b'),
        }),
        prospect('sw-archived', { stage: 'Yeni aday', createdAt: '2026-10-01T08:00:00.000Z' }),
      ],
      { type: 'language_school' },
    )
    await db.insert(records).values({
      institutionId: b.id,
      collection: 'teachers',
      id: 'sw-t-b',
      data: { id: 'sw-t-b', name: 'B Öğretmeni' },
      position: 99,
    })
    await db
      .update(records)
      .set({ archivedAt: FIXED_NOW })
      .where(
        and(
          eq(records.institutionId, a.id),
          eq(records.collection, 'prospects'),
          eq(records.id, 'sw-archived'),
        ),
      )
    const response = await get(URL, await a.session())
    assert.equal(response.statusCode, 200, response.body)
    const data = response.json().data
    assert.equal(data.trials.total, 0)
    assert.deepEqual(
      data.meetings.rows.map((row: { prospectId: string; teacherName: string | null }) => [
        row.prospectId,
        row.teacherName,
      ]),
      [['sw-1', null]],
    )
    assert.equal(data.followUps.total, 0)
    for (const secret of ['sw-b-only', 'sw-archived', 'B Öğretmeni'])
      assert.ok(!response.body.includes(secret), secret)
    // Sınama geçerli: B kendi adayını ve dersini görür.
    const own = (await get(URL, await b.session())).json().data
    assert.equal(own.trials.total, 1)
    assert.equal(own.followUps.rows[0].prospectId, 'sw-b-only')
  })
})
