import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { privacyNotices } from '../src/db/schema/privacy.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'

/**
 * Yayımlı rıza metinlerinin tek istekte listesi (`GET /consent-texts`; DOM-YTK-058, DOM-YTK-060,
 * kayıt sayfasının 404 konsol hatası #39). Tekil uç ve 404'ü `consents.test.ts`'tedir; burada liste
 * ucunun kapsamı, yalnız yayımlı güncel sürümü, filtresi ve 401/400 yolları sınanır. Ayrı dosyadır:
 * `consents.test.ts` genel istek sınırına (300/dk) yakındır.
 */

type Json = ReturnType<typeof JSON.parse>
type ListItem = { text: Json; minimumVersion: number }

describe('rıza metni listesi', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  const get = (cookie: string | null, url: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })

  async function publish(cookie: string, purpose: string, extra: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy-notices',
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        'content-type': 'application/json',
        'idempotency-key': `test-consent-texts-${String(++serial).padStart(4, '0')}`,
      },
      payload: JSON.stringify({
        kind: 'consent_text',
        purpose,
        title: 'Rıza metni',
        body: 'Açık rıza metni.',
        ...extra,
      }),
    })
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as Json
  }

  async function tenant() {
    const institution = await createInstitution(app)
    const member = async (role: Role) =>
      signInAs(app, await createMember(app, institution.id, role))
    return {
      id: institution.id,
      admin: await signInAs(app, institution.admin),
      parent: await member('veli'),
      teacher: await member('ogretmen'),
      student: await member('ogrenci'),
      frontDesk: await member('onburo'),
    }
  }

  test('401: oturumsuz istek reddedilir', async () => {
    for (const url of [
      '/api/v1/consent-texts',
      '/api/v1/consent-texts?purpose=photo_video_sharing',
    ])
      assert.equal((await get(null, url)).statusCode, 401, url)
  })

  test('DOM-YTK-058 DOM-YTK-060 yalnız yayımlı güncel sürümler tek istekte; tekil uçla aynı öğe; bütün roller okur', async () => {
    const w = await tenant()
    // Metin yokken liste boştur ve hata değildir (tekil uç 404 verir).
    const empty = await get(w.parent, '/api/v1/consent-texts')
    assert.equal(empty.statusCode, 200, empty.body)
    assert.deepEqual(empty.json().data, [])

    const sharing = await publish(w.admin, 'photo_video_sharing')
    const speaking = await publish(w.admin, 'speaking_recording')
    const list = await get(w.parent, '/api/v1/consent-texts')
    assert.equal(list.statusCode, 200, list.body)
    const items = list.json().data as ListItem[]
    // Yayımlanmamış amaç listede yoktur.
    assert.deepEqual(items.map((item) => item.text.id).sort(), [sharing.id, speaking.id].sort())
    const single = await get(w.parent, '/api/v1/consent-texts/photo_video_sharing')
    assert.deepEqual(
      items.find((item) => item.text.purpose === 'photo_video_sharing'),
      single.json().data,
    )
    assert.equal((await get(w.parent, '/api/v1/consent-texts/photo_video_print')).statusCode, 404)

    for (const cookie of [w.admin, w.teacher, w.student, w.frontDesk]) {
      const response = await get(cookie, '/api/v1/consent-texts')
      assert.equal(response.statusCode, 200, response.body)
      assert.equal((response.json().data as ListItem[]).length, 2)
    }
  })

  test('DOM-YTK-060 yalnız son sürüm döner; yeniden rıza isteyen sürüm alt sınırı yükseltir; okuma sürüm çoğaltmaz', async () => {
    const w = await tenant()
    await publish(w.admin, 'photo_video_sharing')
    await publish(w.admin, 'photo_video_sharing', { title: 'Yazım düzeltmesi' })
    const widened = await publish(w.admin, 'photo_video_sharing', {
      title: 'Amaç genişledi',
      requiresReconsent: true,
    })
    const items = (await get(w.parent, '/api/v1/consent-texts')).json().data as ListItem[]
    assert.equal(items.length, 1)
    assert.equal(items[0]?.text.id, widened.id)
    assert.equal(items[0]?.text.version, 3)
    assert.equal(items[0]?.minimumVersion, 3)
    const rows = await db
      .select()
      .from(privacyNotices)
      .where(eq(privacyNotices.institutionId, w.id))
    assert.equal(rows.length, 3)
  })

  test('purpose filtresi: yayımlı amaç tek öğe, yayımlanmamış amaç boş liste; bilinmeyen parametre 400', async () => {
    const w = await tenant()
    const speaking = await publish(w.admin, 'speaking_recording')
    await publish(w.admin, 'photo_video_sharing')

    const filtered = await get(w.parent, '/api/v1/consent-texts?purpose=speaking_recording')
    assert.equal(filtered.statusCode, 200, filtered.body)
    assert.deepEqual(
      (filtered.json().data as ListItem[]).map((item) => item.text.id),
      [speaking.id],
    )
    const none = await get(w.parent, '/api/v1/consent-texts?purpose=photo_video_print')
    assert.equal(none.statusCode, 200, none.body)
    assert.deepEqual(none.json().data, [])

    for (const query of ['purpose=bilinmeyen', 'purpose=', 'page=1', 'institutionId=x', 'x=1']) {
      const response = await get(w.parent, `/api/v1/consent-texts?${query}`)
      assert.equal(response.statusCode, 400, query)
    }
  })

  test('IST-002: başka kurumun rıza metni listede dönmez', async () => {
    const a = await tenant()
    const b = await tenant()
    await publish(b.admin, 'photo_video_sharing')
    assert.deepEqual((await get(a.parent, '/api/v1/consent-texts')).json().data, [])
    const own = await publish(a.admin, 'photo_video_sharing')
    const items = (await get(a.parent, '/api/v1/consent-texts')).json().data as ListItem[]
    assert.deepEqual(
      items.map((item) => item.text.id),
      [own.id],
    )
    // B'nin listesi A'nın yayımından etkilenmez.
    assert.equal((await get(b.parent, '/api/v1/consent-texts')).json().data.length, 1)
  })
})
