import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { PROSPECT_SOURCES } from '@kampus/school-core/lib/prospects.ts'

import type { App } from '../src/app.ts'
import { ROLES } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import type { RecordData } from '../src/db/collections.ts'
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

// Kayıt hunisi (`GET /api/v1/prospects/funnel`; DOM-KAY-040, IST-117): aday → görüşme → [deneme
// dersi] → kesin kayıt, kaynak ve danışman kırılımı; yalnız yönetici ve ön büro, modül `crm`.

const URL = '/api/v1/prospects/funnel'
const meeting = { date: '2026-10-01T09:00:00.000Z', duration: 30, room: '101', teacherId: null }
const trialLesson = { lessonId: 'l1', classId: 'c1', date: '2026-10-02T09:00:00.000Z' }

type Prospect = RecordData & { id: string }
const prospect = (id: string, overrides: RecordData = {}): Prospect => ({
  id,
  name: `Aday ${id}`,
  phone: '05559990001',
  email: `${id}@aday.example`,
  source: 'Web sitesi',
  stage: 'Yeni aday',
  studentId: null,
  trialAt: null,
  notes: [],
  createdAt: '2026-10-01T08:00:00.000Z',
  ...overrides,
})

type Step = { step: string; count: number; rate: number | null }
type Row = { prospects: number; steps: Step[]; conversionRate: number | null }
const steps = (row: Row) => row.steps.map(({ step, count, rate }) => [step, count, rate])

describe('kayıt hunisi (DOM-KAY-040, IST-117)', () => {
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

  /** Kurum, ön büro üyesi ve verilen adaylar; `createdBy` için yönetici ve ön büro kimlikleri. */
  async function institution(
    build: (people: { admin: string; front: string }) => Prospect[],
    overrides: Partial<InstitutionOverrides> = {},
  ) {
    const created = await createInstitution(app, overrides)
    const front = await createMember(app, created.id, 'onburo')
    const items = build({ admin: created.admin.id, front: front.id }).map((data) => ({
      collection: 'prospects' as const,
      id: data.id,
      data,
    }))
    await insertMissingRecords(db, created.id, items, FIXED_NOW)
    return {
      ...created,
      front,
      session: lazySession(app, created.admin),
      frontSession: lazySession(app, front),
    }
  }

  const by = (userId: string) => ({ role: 'onburo', userId })
  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} })

  test('DOM-KAY-040: oturumsuz 401; bilinmeyen parametre, sorgudaki institutionId ve ters aralık 400', async () => {
    assert.equal((await get(URL)).statusCode, 401)
    const a = await institution(() => [prospect('fn-1')])
    for (const query of [
      'institutionId=x',
      'dateFrom=2026-10-05&dateTo=2026-10-01',
      'dateFrom=2026-13-01',
      'dateTo=dün',
    ]) {
      const response = await get(`${URL}?${query}`, await a.session())
      assert.equal(response.statusCode, 400, `${query}: ${response.body}`)
      assert.equal(response.json().code, 'validation_failed', query)
    }
  })

  test('DOM-KAY-040: yönetici ve ön büro dışındaki roller 403, veri dönmez; crm kapalıyken 403 module_disabled', async () => {
    const a = await institution(() => [prospect('fn-1')])
    for (const role of ROLES.filter((value) => value !== 'yonetici' && value !== 'onburo')) {
      const cookie = await signInAs(app, await createMember(app, a.id, role))
      const response = await get(URL, cookie)
      assert.equal(response.statusCode, 403, `${role}: ${response.body}`)
      assert.equal(response.json().code, 'forbidden', role)
      assert.ok(!response.body.includes('prospects'), role)
    }
    const closed = await institution(() => [prospect('fn-1')], { enabledModules: { crm: false } })
    for (const cookie of [await closed.session(), await closed.frontSession()]) {
      const response = await get(URL, cookie)
      assert.equal(response.statusCode, 403, response.body)
      assert.equal(response.json().code, 'module_disabled')
    }
  })

  test('DOM-KAY-040: okulda birikimli huni, kaynak ve danışman kırılımı; yanıt aday kişisel verisi taşımaz', async () => {
    const a = await institution(({ admin, front }) => [
      prospect('fn-1', { createdBy: by(front) }),
      prospect('fn-2', { stage: 'Görüşme planlandı', meeting, createdBy: by(front) }),
      prospect('fn-3', {
        source: 'Telefon',
        stage: 'Kayıt oldu',
        studentId: 's1',
        createdBy: by(admin),
      }),
      prospect('fn-4', { source: 'Telefon', stage: 'Vazgeçti', meeting, createdBy: by(front) }),
      // Örnek veri gibi açanı kayıtlı olmayan eski aday; tanınmayan eski kaynak.
      prospect('fn-5', { source: 'Gazete ilanı', stage: 'Teklif verildi' }),
    ])
    for (const cookie of [await a.session(), await a.frontSession()]) {
      const response = await get(URL, cookie)
      assert.equal(response.statusCode, 200, response.body)
      const data = response.json().data
      assert.equal(data.institutionType, 'school')
      assert.equal(data.total.prospects, 5)
      assert.deepEqual(steps(data.total), [
        ['prospect', 5, null],
        ['meeting', 3, 60],
        ['enrolled', 1, 33.3],
      ])
      assert.equal(data.total.conversionRate, 20)
      assert.deepEqual(
        data.total.stages.map((item: { stage: string; count: number }) => [item.stage, item.count]),
        [
          ['Yeni aday', 1],
          ['İletişime geçildi', 0],
          ['Görüşme planlandı', 1],
          ['Teklif verildi', 1],
          ['Kayıt oldu', 1],
          ['Vazgeçti', 1],
        ],
      )
      assert.deepEqual(
        data.bySource.map((row: Row & { source: string | null }) => [row.source, row.prospects]),
        [
          ...PROSPECT_SOURCES.map((source) => [
            source,
            source === 'Web sitesi' || source === 'Telefon' ? 2 : 0,
          ]),
          ['Gazete ilanı', 1],
        ],
      )
      assert.deepEqual(
        data.byCounselor.map(
          (row: Row & { counselorId: string | null; counselorName: string | null }) => [
            row.counselorId,
            row.counselorName,
            row.prospects,
            row.conversionRate,
          ],
        ),
        [
          [a.front.id, 'Test Kullanıcı', 3, 0],
          [a.admin.id, 'Test Yönetici', 1, 100],
          [null, null, 1, 0],
        ],
      )
      for (const secret of ['05559990001', '@aday.example', 'Aday fn-', 'fn-1'])
        assert.ok(!response.body.includes(secret), secret)
    }
  })

  test('DOM-KAY-040: dil okulunda deneme dersi adımı görüşmeyle kesin kayıt arasındadır', async () => {
    const a = await institution(
      () => [
        prospect('fn-1'),
        prospect('fn-2', { stage: 'Görüşme planlandı', meeting }),
        prospect('fn-3', { stage: 'Görüşme planlandı', meeting, trialLesson }),
        prospect('fn-4', { stage: 'Kayıt oldu', studentId: 's1', meeting, trialLesson }),
      ],
      { type: 'language_school' },
    )
    const response = await get(URL, await a.session())
    assert.equal(response.statusCode, 200, response.body)
    const data = response.json().data
    assert.equal(data.institutionType, 'language_school')
    assert.deepEqual(steps(data.total), [
      ['prospect', 4, null],
      ['meeting', 3, 75],
      ['trial', 2, 66.7],
      ['enrolled', 1, 50],
    ])
  })

  test('DOM-KAY-040: tarih aralığı adayın açılış gününe Europe/Istanbul ile uygulanır, iki uç dahil', async () => {
    const a = await institution(() => [
      // 2026-09-30 21:30 UTC İstanbul'da 1 Ekim 00:30'dur.
      prospect('fn-1', { createdAt: '2026-09-30T21:30:00.000Z' }),
      // 2026-09-30 20:59 UTC İstanbul'da hâlâ 30 Eylül'dür.
      prospect('fn-2', { createdAt: '2026-09-30T20:59:00.000Z' }),
      prospect('fn-3', { createdAt: '2026-10-05T20:59:00.000Z', stage: 'Kayıt oldu' }),
      prospect('fn-4', { createdAt: '2026-10-05T21:00:00.000Z' }),
      // Açılış anı olmayan eski aday aralıkta sayılmaz, aralıksız sayılır.
      prospect('fn-5', { createdAt: undefined }),
    ])
    const ranged = await get(`${URL}?dateFrom=2026-10-01&dateTo=2026-10-05`, await a.session())
    assert.equal(ranged.statusCode, 200, ranged.body)
    assert.deepEqual(steps(ranged.json().data.total), [
      ['prospect', 2, null],
      ['meeting', 1, 50],
      ['enrolled', 1, 100],
    ])
    const from = await get(`${URL}?dateFrom=2026-10-01`, await a.session())
    assert.equal(from.json().data.total.prospects, 3)
    const to = await get(`${URL}?dateTo=2026-09-30`, await a.session())
    assert.equal(to.json().data.total.prospects, 1)
    const all = await get(URL, await a.session())
    assert.equal(all.json().data.total.prospects, 5)
  })

  test('DOM-KAY-040: başka kurumun adayı huniye girmez; başka kurumun kullanıcısının adı dönmez', async () => {
    const b = await institution(({ admin }) => [
      prospect('fn-1', { stage: 'Kayıt oldu', studentId: 's1', createdBy: by(admin) }),
      prospect('fn-b-only', { source: 'Sosyal medya', createdBy: by(admin) }),
    ])
    // A'nın adayını B'nin yöneticisi açmış görünüyor (taşınmış eski kayıt): ad A'da gösterilmez.
    const a = await institution(() => [prospect('fn-1', { createdBy: by(b.admin.id) })])
    const response = await get(URL, await a.session())
    assert.equal(response.statusCode, 200, response.body)
    const data = response.json().data
    assert.equal(data.total.prospects, 1)
    assert.deepEqual(steps(data.total).at(-1), ['enrolled', 0, null])
    assert.equal(
      data.bySource.find((row: { source: string }) => row.source === 'Sosyal medya').prospects,
      0,
    )
    assert.deepEqual(
      data.byCounselor.map((row: { counselorId: string; counselorName: string | null }) => [
        row.counselorId,
        row.counselorName,
      ]),
      [[b.admin.id, null]],
    )
    // Sınama geçerli: B kendi iki adayını görür.
    const own = await get(URL, await b.session())
    assert.equal(own.json().data.total.prospects, 2)
    assert.equal(own.json().data.byCounselor[0].counselorName, 'Test Yönetici')
  })

  test('DOM-KAY-040: arşivlenen aday sayılmaz', async () => {
    const a = await institution(() => [prospect('fn-1'), prospect('fn-2', { stage: 'Kayıt oldu' })])
    await db
      .update(records)
      .set({ archivedAt: FIXED_NOW })
      .where(
        and(
          eq(records.institutionId, a.id),
          eq(records.collection, 'prospects'),
          eq(records.id, 'fn-2'),
        ),
      )
    const response = await get(URL, await a.session())
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(steps(response.json().data.total), [
      ['prospect', 1, null],
      ['meeting', 0, 0],
      ['enrolled', 0, null],
    ])
  })
})
