import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { count, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import {
  DEFAULT_DEMO_PASSWORD,
  DEMO_MEMBERS,
  demoState,
  seedDemo,
  stateRecords,
} from '../src/db/demo-seed.ts'
import { STORED_COLLECTIONS } from '../src/db/collections.ts'
import { findRecord, loadRecords, writeRecords } from '../src/db/records.ts'
import { institutions, memberships, users } from '../src/db/schema/auth.ts'
import { membershipLinks } from '../src/db/schema/membership-links.ts'
import { records } from '../src/db/schema/records.ts'
import { buildTestApp, createTestDatabase, FIXED_NOW, signInAs } from './support/app.ts'

const LATER = new Date('2026-10-07T09:00:00.000Z')

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
    const [[u], [i], [m], [l], [r]] = await Promise.all([
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(institutions),
      db.select({ n: count() }).from(memberships),
      db.select({ n: count() }).from(membershipLinks),
      db.select({ n: count() }).from(records),
    ])
    return { users: u?.n, institutions: i?.n, memberships: m?.n, links: l?.n, records: r?.n }
  }

  test('iki kez çalışınca aynı kayıtları bırakır ve demo kullanıcıları giriş yapar', async () => {
    const seeded = await seedDemo(app.auth, db, DEFAULT_DEMO_PASSWORD, { now: FIXED_NOW })
    const first = await counts()
    const perInstitution = stateRecords(demoState('akademi', FIXED_NOW)).length
    assert.deepEqual(seeded.insertedRecords, {
      akademi: perInstitution,
      'kampus-dil': perInstitution,
    })
    assert.deepEqual(first, {
      users: 9,
      institutions: 2,
      memberships: 10,
      links: 8,
      records: perInstitution * 2,
    })

    // Sonradan değişen kayıt ikinci tohumda ezilmez; başka gün çalışmak da kayıt eklemez.
    const akademi = seeded.institutionIds.akademi
    assert.ok(akademi)
    const deniz = await findRecord(db, akademi, 'students', 's1')
    assert.ok(deniz)
    await writeRecords(
      db,
      akademi,
      [
        {
          kind: 'update',
          collection: 'students',
          id: 's1',
          data: { ...deniz.data, progress: 99 },
          expectedVersion: deniz.version,
        },
      ],
      LATER,
    )
    const again = await seedDemo(app.auth, db, DEFAULT_DEMO_PASSWORD, { now: LATER })
    assert.deepEqual(again.insertedRecords, { akademi: 0, 'kampus-dil': 0 })
    assert.deepEqual(await counts(), first)
    assert.equal((await findRecord(db, akademi, 'students', 's1'))?.data.progress, 99)

    const cookie = await signInAs(app, {
      email: 'ayse.yilmaz@kampus.example',
      password: DEFAULT_DEMO_PASSWORD,
    })
    const me = (await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } })).json()
    assert.equal(me.data.activeInstitution.name, 'Akademi Özel Okulları')
    assert.equal(me.data.activeInstitution.type, 'school')
    // Akademik yıl ilk tohumun örnek verisinden gelir; ikinci tohum ayarı ezmez.
    assert.equal(
      me.data.activeInstitution.academicYear,
      demoState('akademi', FIXED_NOW).academicYear,
    )
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

  test('kayıtlar core dizisinin sırasıyla yüklenir; ikinci tohum sırayı değiştirmez', async () => {
    const { institutionIds } = await seedDemo(app.auth, db, DEFAULT_DEMO_PASSWORD, {
      now: FIXED_NOW,
    })
    const akademi = institutionIds.akademi
    assert.ok(akademi)
    // Kimlik sırası karşılaştırılır: öteki test bir kaydın verisini değiştirmiş olabilir.
    const expected = stateRecords(demoState('akademi', FIXED_NOW))
    const check = async () => {
      const rows = await loadRecords(db, akademi, STORED_COLLECTIONS)
      for (const collection of STORED_COLLECTIONS)
        assert.deepEqual(
          rows.filter((row) => row.collection === collection).map((row) => row.id),
          expected.filter((item) => item.collection === collection).map((item) => item.id),
          collection,
        )
      return rows.map((row) => [row.collection, row.id, row.position, row.version])
    }
    const first = await check()
    await seedDemo(app.auth, db, DEFAULT_DEMO_PASSWORD, { now: FIXED_NOW })
    assert.deepEqual(await check(), first)
  })

  test('üyelik bağlantıları kurumdaki örnek kayıtlardaki kişilere işaret eder', async () => {
    const { institutionIds } = await seedDemo(app.auth, db, DEFAULT_DEMO_PASSWORD, {
      now: FIXED_NOW,
    })
    let checked = 0
    for (const member of DEMO_MEMBERS) {
      for (const membership of member.memberships) {
        const institutionId = institutionIds[membership.institution]
        assert.ok(institutionId, `${membership.institution} kurulmadı`)
        for (const link of membership.links ?? []) {
          const collection = link.kind === 'teacher' ? 'teachers' : 'students'
          const record = await findRecord(db, institutionId, collection, link.recordId)
          assert.ok(record, `${member.name}: ${link.recordId} yok`)
          if (link.kind === 'child') {
            const parentId = record.data.parentId
            assert.equal(typeof parentId, 'string')
            const parent = await findRecord(db, institutionId, 'parents', String(parentId))
            assert.equal(parent?.data.name, member.name)
          } else {
            assert.equal(record.data.name, member.name)
          }
          checked += 1
        }
      }
    }
    assert.equal(checked, 8)
    // Dil akademisi bağlantıları da kayıtlara bağlanmış olarak saklanır.
    const stored = await db
      .select({ recordId: membershipLinks.recordId })
      .from(membershipLinks)
      .where(eq(membershipLinks.institutionId, institutionIds['kampus-dil'] ?? ''))
    assert.deepEqual(stored.map((row) => row.recordId).sort(), ['s1', 's1', 's2', 't1'])
  })
})
