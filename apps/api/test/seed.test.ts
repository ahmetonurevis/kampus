import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { count } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { DEFAULT_DEMO_PASSWORD, seedDemo } from '../src/db/demo-seed.ts'
import { institutions, memberships, users } from '../src/db/schema/auth.ts'
import { membershipLinks } from '../src/db/schema/membership-links.ts'
import { buildTestApp, createTestDatabase, signInAs } from './support/app.ts'

describe('demo tohumu', () => {
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

  async function counts() {
    const [[u], [i], [m], [l]] = await Promise.all([
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(institutions),
      db.select({ n: count() }).from(memberships),
      db.select({ n: count() }).from(membershipLinks),
    ])
    return { users: u?.n, institutions: i?.n, memberships: m?.n, links: l?.n }
  }

  test('iki kez çalışınca aynı kayıtları bırakır ve demo kullanıcıları giriş yapar', async () => {
    await seedDemo(app.auth, db, DEFAULT_DEMO_PASSWORD)
    const first = await counts()
    await seedDemo(app.auth, db, DEFAULT_DEMO_PASSWORD)
    assert.deepEqual(await counts(), first)
    assert.deepEqual(first, { users: 9, institutions: 2, memberships: 10, links: 4 })

    const cookie = await signInAs(app, {
      email: 'ayse.yilmaz@kampus.example',
      password: DEFAULT_DEMO_PASSWORD,
    })
    const me = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).json()
    assert.equal(me.data.activeInstitution.name, 'Akademi Özel Okulları')
    assert.equal(me.data.activeInstitution.type, 'school')
    assert.deepEqual(
      me.data.activeMembership.links.map((link: { recordId: string }) => link.recordId),
      ['s1', 's2'],
    )

    const founder = await signInAs(app, {
      email: 'murat.yilmaz@kampus.example',
      password: DEFAULT_DEMO_PASSWORD,
    })
    const founderMe = (
      await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: founder } })
    ).json()
    assert.deepEqual(
      founderMe.data.memberships.map((item: { institutionType: string }) => item.institutionType),
      ['school', 'language_school'],
    )
  })
})
