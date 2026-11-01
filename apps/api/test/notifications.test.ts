import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { records } from '../src/db/schema/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Uygulama içi bildirim merkezi uçları (F6a; core `lib/notifications.ts`;
 * docs/domain/iletisim-ve-veli.md DOM-ILT-020, -023, -073). Bildirimler örnek kayıt olarak
 * yazılır; üretimi kesin kayıt (`prospect-enroll.test.ts`) ve öğretmen puanı
 * (`task-grading.test.ts`) testlerindedir. Rol × kapsam, iki velinin ayrı okundu bilgisi, başka
 * kurum, modül kapalı, `If-Match` reddi ve logda başlık/ad olmaması denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>
const LATER = new Date('2026-10-06T10:30:00.000Z')

describe('bildirim merkezi uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  const logs: string[] = []

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { logs, clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const notification = (
    id: string,
    audience: 'student' | 'parent',
    studentId: string,
    minute: number,
  ) => ({
    collection: 'notifications' as const,
    id,
    data: {
      id,
      kind: 'feedback_released',
      audience,
      studentId,
      subject: { type: 'task_submission', id: `sub-${studentId}` },
      createdAt: new Date(FIXED_NOW.getTime() + minute * 60_000).toISOString(),
    },
  })

  /**
   * Deniz (`s-1`) ve Can (`s-3`). Deniz'in iki velisi ayrı hesaplıdır (DOM-ILT-073); `n-*`
   * bildirimleri: Deniz'e iki (öğrenci ve veli), Can'a bir (veli).
   */
  async function tenant(overrides: Partial<InstitutionOverrides> = {}) {
    now = FIXED_NOW
    const institution = await createInstitution(app, overrides)
    const prefix = randomUUID().slice(0, 8)
    const ids = {
      denizStudent: `n-${prefix}-1`,
      denizParent: `n-${prefix}-2`,
      canParent: `n-${prefix}-3`,
      denizParentLater: `n-${prefix}-4`,
    }
    await insertMissingRecords(
      db,
      institution.id,
      [
        ...[
          ['s-1', 'Deniz Yılmaz'],
          ['s-3', 'Can Arslan'],
        ].map(([id, name]) => ({
          collection: 'students' as const,
          id: id!,
          data: { id, name, classId: '9-A', isActive: true },
        })),
        notification(ids.denizStudent, 'student', 's-1', 1),
        notification(ids.denizParent, 'parent', 's-1', 2),
        notification(ids.canParent, 'parent', 's-3', 3),
        notification(ids.denizParentLater, 'parent', 's-1', 4),
      ],
      FIXED_NOW,
    )
    const member = (role: 'ogretmen' | 'ogrenci' | 'veli', kind: string, recordId: string) =>
      createMember(app, institution.id, role, [{ kind, recordId } as never])
    const cookies = {
      admin: await signInAs(app, institution.admin),
      teacher: await signInAs(app, await member('ogretmen', 'teacher', 't-1')),
      student: await signInAs(app, await member('ogrenci', 'student', 's-1')),
      parent: await signInAs(app, await member('veli', 'child', 's-1')),
      secondParent: await signInAs(app, await member('veli', 'child', 's-1')),
      otherParent: await signInAs(app, await member('veli', 'child', 's-3')),
    }
    return { institution, ids, cookies }
  }

  function call(
    method: 'GET' | 'POST',
    url: string,
    cookie?: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json() as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }
  const list = (cookie: string, query = '') => call('GET', `/notifications${query}`, cookie)
  const unread = async (cookie: string) =>
    (await ok(await call('GET', '/notifications/unread-count', cookie))).data.unread as number
  const read = (id: string, cookie: string, headers: Record<string, string> = {}) =>
    call('POST', `/notifications/${id}/read`, cookie, {}, headers)
  const readAll = (cookie: string) => call('POST', '/notifications/read-all', cookie, {})
  const readRows = (institutionId: string) =>
    db
      .select({ id: records.id, data: records.data, version: records.version })
      .from(records)
      .where(
        and(eq(records.institutionId, institutionId), eq(records.collection, 'notificationReads')),
      )

  test('DOM-ILT-073: veli yalnız bağlı çocuğunun veli bildirimini, öğrenci kendi bildirimini görür; en yeni önce', async () => {
    const { ids, cookies } = await tenant()
    const parentPage = await ok(await list(cookies.parent))
    assert.deepEqual(
      parentPage.data.map((n: Json) => n.id),
      [ids.denizParentLater, ids.denizParent],
    )
    assert.deepEqual(parentPage.meta, { nextCursor: null })
    assert.deepEqual(parentPage.data[0], {
      id: ids.denizParentLater,
      kind: 'feedback_released',
      topic: 'homework',
      audience: 'parent',
      studentId: 's-1',
      subject: { type: 'task_submission', id: 'sub-s-1' },
      title: 'Deniz için öğretmen geri bildirimi geldi.',
      createdAt: '2026-10-06T09:04:00.000Z',
      readAt: null,
    })
    const studentPage = await ok(await list(cookies.student))
    assert.deepEqual(
      studentPage.data.map((n: Json) => [n.id, n.title]),
      [[ids.denizStudent, 'Görevine öğretmen geri bildirimi geldi.']],
    )
    const otherPage = await ok(await list(cookies.otherParent))
    assert.deepEqual(
      otherPage.data.map((n: Json) => n.id),
      [ids.canParent],
    )
    // Personelin bildirimi yoktur; liste boştur.
    for (const cookie of [cookies.admin, cookies.teacher]) {
      assert.deepEqual(await ok(await list(cookie)), {
        data: [],
        meta: { nextCursor: null },
      })
      assert.equal(await unread(cookie), 0)
    }
  })

  test('imleçli sayfalama, okunmamış süzgeci ve sayısı; görülemeyen imleç ve bilinmeyen sorgu alanı 400', async () => {
    const { ids, cookies } = await tenant()
    const first = await ok(await list(cookies.parent, '?limit=1'))
    assert.equal(first.meta.nextCursor, ids.denizParentLater)
    assert.equal('total' in first.meta, false)
    const second = await ok(await list(cookies.parent, `?limit=1&cursor=${first.meta.nextCursor}`))
    assert.deepEqual(
      [...first.data, ...second.data].map((n: Json) => n.id),
      [ids.denizParentLater, ids.denizParent],
    )
    assert.equal(second.meta.nextCursor, null)
    assert.equal(await unread(cookies.parent), 2)
    await ok(await read(ids.denizParent, cookies.parent))
    assert.equal(await unread(cookies.parent), 1)
    const unreadPage = await ok(await list(cookies.parent, '?unread=true'))
    assert.deepEqual(
      unreadPage.data.map((n: Json) => n.id),
      [ids.denizParentLater],
    )
    assert.equal(unreadPage.meta.nextCursor, null)
    // DOM-ILT-073: başkasının bildirimi imleç olarak da kullanılamaz; olmayanla aynı yanıt.
    for (const cursor of [ids.canParent, ids.denizStudent, 'olmayan'])
      fails(await list(cookies.parent, `?cursor=${cursor}`), 400, 'validation_failed')
    fails(await list(cookies.parent, '?studentId=s-3'), 400, 'validation_failed')
    fails(await list(cookies.parent, '?limit=101'), 400, 'validation_failed')
    fails(await list(cookies.parent, '?page=2'), 400, 'validation_failed')
  })

  test('DOM-ILT-073: okundu kullanıcıya özeldir; tekrar çağrı ilk anı korur, diğer veliye yansımaz', async () => {
    const { institution, ids, cookies } = await tenant()
    const first = await ok(await read(ids.denizParent, cookies.parent))
    assert.deepEqual(first.data.entity, { collection: 'notifications', id: ids.denizParent })
    assert.equal(first.data.changes.inserted, 1)
    now = LATER
    const again = await ok(await read(ids.denizParent, cookies.parent))
    assert.equal(again.data.changes.inserted, 0)
    const rows = await readRows(institution.id)
    assert.equal(rows.length, 1)
    assert.equal((rows[0]?.data as Json).readAt, FIXED_NOW.toISOString())
    const parentView = await ok(await list(cookies.parent))
    assert.equal(
      parentView.data.find((n: Json) => n.id === ids.denizParent).readAt,
      FIXED_NOW.toISOString(),
    )
    // İkinci veli aynı bildirimi okunmamış görür; diğer velinin kimliği hiçbir alanda yok.
    const secondView = await ok(await list(cookies.secondParent))
    assert.equal(secondView.data.find((n: Json) => n.id === ids.denizParent).readAt, null)
    assert.equal(await unread(cookies.secondParent), 2)
    assert.doesNotMatch(JSON.stringify(secondView), /userId/)
  })

  test('DOM-ILT-073: başkasının bildirimi 404 notification_not_found; kayıt değişmez', async () => {
    const { institution, ids, cookies } = await tenant()
    fails(await read(ids.canParent, cookies.parent), 404, 'not_found')
    fails(await read(ids.denizStudent, cookies.parent), 404, 'not_found')
    fails(await read(ids.denizParent, cookies.student), 404, 'not_found')
    fails(await read(ids.denizParent, cookies.otherParent), 404, 'not_found')
    fails(await read(ids.denizParent, cookies.admin), 404, 'not_found')
    fails(await read('n-yok', cookies.parent), 404, 'not_found')
    assert.deepEqual(await readRows(institution.id), [])
  })

  test('başka kurumun bildirimi 404; listede görünmez, B kurumunda kayıt değişmez', async () => {
    const a = await tenant()
    const b = await tenant()
    fails(await read(b.ids.denizParent, a.cookies.parent), 404, 'not_found')
    const page = await ok(await list(a.cookies.parent))
    assert.ok(page.data.every((n: Json) => !Object.values(b.ids).includes(n.id)))
    assert.deepEqual(await readRows(b.institution.id), [])
    assert.deepEqual(await readRows(a.institution.id), [])
  })

  test('toplu okundu yalnız aktörün gördüğü okunmamışları işaretler; tekrar çağrı kayıt eklemez', async () => {
    const { institution, ids, cookies } = await tenant()
    await ok(await read(ids.denizParent, cookies.parent))
    now = LATER
    const all = await ok(await readAll(cookies.parent))
    assert.equal(all.data.entity, null)
    assert.equal(all.data.changes.inserted, 1)
    assert.equal(await unread(cookies.parent), 0)
    assert.equal(await unread(cookies.secondParent), 2)
    assert.equal(await unread(cookies.otherParent), 1)
    assert.equal(await unread(cookies.student), 1)
    const rows = await readRows(institution.id)
    assert.deepEqual(
      rows.map((r) => [(r.data as Json).notificationId, (r.data as Json).readAt]).sort(),
      [
        [ids.denizParent, FIXED_NOW.toISOString()],
        [ids.denizParentLater, LATER.toISOString()],
      ].sort(),
    )
    const again = await ok(await readAll(cookies.parent))
    assert.equal(again.data.changes.inserted, 0)
    assert.equal((await readRows(institution.id)).length, 2)
    // Personelde bildirim yoktur; işaretlenecek bir şey de yoktur.
    assert.equal((await ok(await readAll(cookies.admin))).data.changes.inserted, 0)
  })

  test('If-Match kabul edilmez (400); oturumsuz 401; bildirimler genel koleksiyon ucuna kapalı', async () => {
    const { institution, ids, cookies } = await tenant()
    fails(
      await read(ids.denizParent, cookies.parent, { 'if-match': '"1"' }),
      400,
      'if_match_not_supported',
    )
    assert.deepEqual(await readRows(institution.id), [])
    for (const [method, url] of [
      ['GET', '/notifications'],
      ['GET', '/notifications/unread-count'],
      ['POST', '/notifications/read-all'],
      ['POST', `/notifications/${ids.denizParent}/read`],
    ] as const)
      assert.equal(
        (await call(method, url, undefined, method === 'POST' ? {} : undefined)).statusCode,
        401,
      )
    for (const collection of ['notifications', 'notificationReads'])
      fails(await call('GET', `/collections/${collection}`, cookies.parent), 404, 'not_found')
  })

  test('DOM-YTK-040: iletişim modülü kapalıyken bütün bildirim uçları 403 module_disabled', async () => {
    const { institution, ids, cookies } = await tenant({ enabledModules: { communication: false } })
    fails(await list(cookies.parent), 403, 'module_disabled')
    fails(await call('GET', '/notifications/unread-count', cookies.parent), 403, 'module_disabled')
    fails(await read(ids.denizParent, cookies.parent), 403, 'module_disabled')
    fails(await readAll(cookies.parent), 403, 'module_disabled')
    assert.deepEqual(await readRows(institution.id), [])
  })

  test('DOM-YTK-040: sıra 401 → 403 module_disabled → 400; modül kapalıyken geçersiz sorgu da 403', async () => {
    const closed = await tenant({ enabledModules: { communication: false } })
    const open = await tenant()
    for (const query of ['?limit=0', '?unread=evet', '?bilinmeyen=1']) {
      assert.equal((await call('GET', `/notifications${query}`, undefined)).statusCode, 401)
      fails(
        await call('GET', `/notifications${query}`, closed.cookies.parent),
        403,
        'module_disabled',
      )
      fails(
        await call('GET', `/notifications${query}`, open.cookies.parent),
        400,
        'validation_failed',
      )
    }
  })

  test('DOM-ILT-023: log bildirim başlığını ve öğrenci adını taşımaz', async () => {
    const { ids, cookies } = await tenant()
    const from = logs.length
    await ok(await list(cookies.parent))
    await ok(await read(ids.denizParent, cookies.parent))
    await ok(await readAll(cookies.parent))
    const written = logs.slice(from).join('\n')
    assert.ok(written.length > 0)
    assert.doesNotMatch(written, /Deniz|geri bildirimi geldi/)
  })
})
