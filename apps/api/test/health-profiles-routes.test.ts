import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq, like, sql } from 'drizzle-orm'

import { MODULE_KEYS } from '@kampus/school-core/modules/collection-modules.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { studentGuardians } from '../src/db/schema/student-guardians.ts'
import { studentHealthProfiles } from '../src/db/schema/student-health-profiles.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
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
 * Öğrencinin sağlık ve acil bilgisi uçları (IST-020; docs/domain/iletisim-ve-veli.md DOM-ILT-035,
 * okuma denetimi docs/domain/yetki-ve-kapsam.md DOM-YTK-052). Erişim kararı core
 * `lib/health-profile.ts`'tedir (`tests/health-profile.test.ts`); burada rol ve kapsam sınırı,
 * düzeye göre yanıt, kısmi güncelleme, sürüm kilidi, şifreli saklama ve denetim satırları
 * denetlenir.
 */

type Json = ReturnType<typeof JSON.parse>
type Method = 'GET' | 'PATCH'

/** `FIXED_NOW` anında 14 yaşında. */
const MINOR_BIRTH = '2012-01-01'
/** `FIXED_NOW` anında 26 yaşında. */
const ADULT_BIRTH = '2000-01-01'

const PROFILE = {
  allergies: [{ name: 'Fıstık', severity: 'severe' }],
  chronicConditions: [{ name: 'Astım' }],
  medications: [{ name: 'Salbutamol', schedule: 'gerektiğinde', atSchool: true }],
  supportNeeds: [{ name: 'Asansör' }],
  emergencyInstructions: 'Adrenalin oto-enjektörü çantada.',
  legalBasis: 'explicit_consent',
}
const SECRETS = ['Fıstık', 'Astım', 'Salbutamol', 'Asansör', 'Adrenalin']
const FULL_FIELDS = [
  'allergies',
  'chronicConditions',
  'medications',
  'supportNeeds',
  'emergencyInstructions',
  'legalBasis',
]

describe('sağlık ve acil bilgi uçları', () => {
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

  /**
   * Deniz (`s-1`, 14 yaşında, 9-A) annesi `mother` ve kısıtlı velisi `restricted` ile; Ece (`s-2`,
   * 9-B) velisi `other`; Ali (`s-3`, 26 yaşında, 9-A) kendisi `adult` ve velisi `adultParent`.
   * 9-A'nın rehberi `homeroom`, derse girenleri `teaching`; `idle` hiçbir sınıfa bağlı değil.
   */
  async function tenant(options: { allModulesOff?: boolean } = {}) {
    const institution = await createInstitution(app, {
      ...(options.allModulesOff
        ? { enabledModules: Object.fromEntries(MODULE_KEYS.map((key) => [key, false])) }
        : {}),
    })
    const id = institution.id
    await insertMissingRecords(
      db,
      id,
      [
        ...[
          ['s-1', 'Deniz Yılmaz', '9-A'],
          ['s-2', 'Ece Yılmaz', '9-B'],
          ['s-3', 'Ali Demir', '9-A'],
        ].map(([sid, name, classId]) => ({
          collection: 'students' as const,
          id: sid!,
          data: { id: sid, name, classId, isActive: true },
        })),
        ...[
          ['t-home', 'Rehber'],
          ['t-teach', 'Derse giren'],
          ['t-idle', 'Boşta'],
        ].map(([tid, name]) => ({
          collection: 'teachers' as const,
          id: tid!,
          data: { id: tid, name, subjectId: 'sub-1', branchId: 'b-1' },
        })),
        ...[
          ['9-A', 't-home'],
          ['9-B', 't-idle'],
        ].map(([cid, teacherId]) => ({
          collection: 'classes' as const,
          id: cid!,
          data: { id: cid, grade: 9, level: '9', branchId: 'b-1', teacherId },
        })),
        {
          collection: 'assignments' as const,
          id: 'as-1',
          data: { id: 'as-1', classId: '9-A', teacherId: 't-teach' },
        },
      ],
      FIXED_NOW,
    )
    for (const [studentId, birthDate] of [
      ['s-1', MINOR_BIRTH],
      ['s-3', ADULT_BIRTH],
    ] as const)
      await db.insert(studentIdentities).values({
        institutionId: id,
        studentId,
        academicYear: 2026,
        identityKind: 'foreign',
        identityNumber: `YK-${id}-${studentId}`,
        birthDate,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      })
    const child = (recordId: string) => [{ kind: 'child' as const, recordId }]
    const student = (recordId: string) => [{ kind: 'student' as const, recordId }]
    const teacher = (recordId: string) => [{ kind: 'teacher' as const, recordId }]
    const users = {
      mother: await createMember(app, id, 'veli', child('s-1')),
      restricted: await createMember(app, id, 'veli', child('s-1')),
      other: await createMember(app, id, 'veli', child('s-2')),
      adultParent: await createMember(app, id, 'veli', child('s-3')),
      minor: await createMember(app, id, 'ogrenci', student('s-1')),
      adult: await createMember(app, id, 'ogrenci', student('s-3')),
      homeroom: await createMember(app, id, 'ogretmen', teacher('t-home')),
      teaching: await createMember(app, id, 'ogretmen', teacher('t-teach')),
      idle: await createMember(app, id, 'ogretmen', teacher('t-idle')),
      unlinked: await createMember(app, id, 'ogretmen'),
      frontDesk: await createMember(app, id, 'onburo'),
    }
    // Kısıtlı veli: koruma kararı gereği velayetsiz ve kısıtlı (DOM-ILT-070; veritabanı denetimi).
    await db
      .update(studentGuardians)
      .set({ custody: 'none', isContactRestricted: true })
      .where(eq(studentGuardians.membershipId, users.restricted.membershipId))
    const cookies = {
      admin: await signInAs(app, institution.admin),
      ...Object.fromEntries(
        await Promise.all(
          Object.entries(users).map(async ([key, user]) => [key, await signInAs(app, user)]),
        ),
      ),
    } as Record<'admin' | keyof typeof users, string>
    return { institution, users, cookies }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  function call(method: Method, url: string, cookie?: string, payload?: unknown) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie ? { cookie } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  const read = (cookie?: string, studentId = 's-1') =>
    call('GET', `/students/${studentId}/health-profile`, cookie)
  const write = (cookie: string | undefined, body: unknown, studentId = 's-1') =>
    call('PATCH', `/students/${studentId}/health-profile`, cookie, body)
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  function fails(response: Awaited<ReturnType<typeof call>>, status: number, code: string) {
    assert.equal(response.statusCode, status, response.body)
    assert.equal(response.json().code, code, response.body)
  }

  const profileRows = (institutionId: string) =>
    db
      .select()
      .from(studentHealthProfiles)
      .where(eq(studentHealthProfiles.institutionId, institutionId))
  const audits = (institutionId: string) =>
    db
      .select({
        action: auditLog.action,
        actorRole: auditLog.actorRole,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        changes: auditLog.changes,
      })
      .from(auditLog)
      .where(
        and(eq(auditLog.institutionId, institutionId), like(auditLog.action, 'health_profile.%')),
      )

  /** Yönetici ilk profili yazar (kayıt yokken sürüm 1). */
  async function seed(t: Tenant, studentId = 's-1') {
    const saved = await ok(await write(t.cookies.admin, { ...PROFILE, version: 1 }, studentId))
    assert.equal(saved.version, 2)
    return saved
  }

  test('401: oturumsuz istek her uçta reddedilir', async () => {
    const t = await tenant()
    fails(await read(), 401, 'unauthenticated')
    fails(await write(undefined, { ...PROFILE, version: 1 }), 401, 'unauthenticated')
    assert.equal((await profileRows(t.institution.id)).length, 0)
    assert.equal((await audits(t.institution.id)).length, 0)
  })

  test('DOM-ILT-035 403: ön büro okuyamaz ve yazamaz; öğretmen yazamaz; ret denetim yazmaz', async () => {
    const t = await tenant()
    await seed(t)
    const before = (await audits(t.institution.id)).length
    fails(await read(t.cookies.frontDesk), 403, 'forbidden')
    for (const cookie of [t.cookies.frontDesk, t.cookies.homeroom, t.cookies.teaching])
      fails(await write(cookie, { emergencyInstructions: 'x', version: 2 }), 403, 'forbidden')
    // Reşit olmayan öğrencinin kendisi okuyamaz ve yazamaz.
    fails(await read(t.cookies.minor), 403, 'health_profile_forbidden')
    fails(
      await write(t.cookies.minor, { emergencyInstructions: 'x', version: 2 }),
      403,
      'health_profile_write_forbidden',
    )
    assert.equal((await audits(t.institution.id)).length, before)
    const [row] = await profileRows(t.institution.id)
    assert.equal(row!.version, 2)
  })

  test('DOM-ILT-035 404: görevsiz öğretmen, ilgisiz veli, kısıtlı veli ve olmayan öğrenci', async () => {
    const t = await tenant()
    await seed(t)
    const before = (await audits(t.institution.id)).length
    for (const cookie of [
      t.cookies.idle,
      t.cookies.unlinked,
      t.cookies.other,
      t.cookies.restricted,
      t.cookies.adult,
    ])
      fails(await read(cookie), 404, 'not_found')
    for (const cookie of [t.cookies.other, t.cookies.restricted, t.cookies.adult])
      fails(await write(cookie, { emergencyInstructions: 'x', version: 2 }), 404, 'not_found')
    fails(await read(t.cookies.admin, 's-yok'), 404, 'not_found')
    fails(await write(t.cookies.admin, { ...PROFILE, version: 1 }, 's-yok'), 404, 'not_found')
    assert.equal((await audits(t.institution.id)).length, before)
    const [row] = await profileRows(t.institution.id)
    assert.equal(row!.version, 2)
  })

  test('DOM-ILT-035 403: 18 yaşını doldurmuş öğrencinin velisi okuyamaz ve yazamaz', async () => {
    const t = await tenant()
    fails(await read(t.cookies.adultParent, 's-3'), 403, 'health_profile_forbidden')
    fails(
      await write(t.cookies.adultParent, { ...PROFILE, version: 1 }, 's-3'),
      403,
      'health_profile_write_forbidden',
    )
    assert.equal((await profileRows(t.institution.id)).length, 0)
    assert.equal((await audits(t.institution.id)).length, 0)
  })

  test('DOM-ILT-035 derse giren öğretmen yalnız acil alanları görür; tam alanlar yanıtta yok', async () => {
    const t = await tenant()
    await seed(t)
    const response = await read(t.cookies.teaching)
    const data = await ok(response)
    assert.equal(data.level, 'emergency')
    assert.deepEqual(Object.keys(data.profile).sort(), ['allergies', 'emergencyInstructions'])
    // Yazma yetkisi olmayan okuyucu kaydın varlığını ya da güncelleme sayısını çıkaramaz.
    assert.deepEqual(Object.keys(data).sort(), ['level', 'profile'])
    assert.ok(!('version' in data), 'acil yanıtta version olmamalı')
    assert.deepEqual(data.profile.allergies, [{ name: 'Fıstık', severity: 'severe' }])
    assert.equal(data.profile.emergencyInstructions, PROFILE.emergencyInstructions)
    for (const hidden of ['Astım', 'Salbutamol', 'Asansör', 'legalBasis', 'chronicConditions'])
      assert.ok(!response.body.includes(hidden), `${hidden} yanıtta olmamalı`)
  })

  test('DOM-ILT-035 rehber öğretmen, yönetici, veli ve yetişkin öğrenci tam görür', async () => {
    const t = await tenant()
    await seed(t)
    await seed(t, 's-3')
    for (const [cookie, studentId] of [
      [t.cookies.homeroom, 's-1'],
      [t.cookies.admin, 's-1'],
      [t.cookies.mother, 's-1'],
      [t.cookies.adult, 's-3'],
    ] as const) {
      const data = await ok(await read(cookie, studentId))
      assert.equal(data.level, 'full')
      assert.deepEqual(data.profile.allergies, PROFILE.allergies)
      assert.deepEqual(data.profile.chronicConditions, PROFILE.chronicConditions)
      assert.deepEqual(data.profile.medications, PROFILE.medications)
      assert.deepEqual(data.profile.supportNeeds, PROFILE.supportNeeds)
      assert.equal(data.profile.legalBasis, 'explicit_consent')
      assert.equal(data.version, 2)
    }
  })

  test('DOM-ILT-035 kayıt yokken okuma boş profil ve sürüm 1 döner', async () => {
    const t = await tenant()
    const data = await ok(await read(t.cookies.mother))
    assert.equal(data.level, 'full')
    assert.equal(data.version, 1)
    assert.deepEqual(data.profile, {
      allergies: [],
      chronicConditions: [],
      medications: [],
      supportNeeds: [],
      emergencyInstructions: '',
      legalBasis: null,
      updatedAt: null,
    })
  })

  test('DOM-ILT-035 400: geçersiz gövde reddedilir ve kayıt değişmez', async () => {
    const t = await tenant()
    const before = await seed(t)
    const bad = [
      {},
      { version: 2 },
      { emergencyInstructions: 'x' },
      { emergencyInstructions: 'x', version: 0 },
      { emergencyInstructions: 'x', version: 2, notes: 'Ailede kalp hastalığı' },
      { emergencyInstructions: 'x', version: 2, institutionId: 'baska-kurum' },
      { allergies: [{ name: 'Fıstık', severity: 'cok-agir' }], version: 2 },
      {
        allergies: [
          { name: 'Fıstık', severity: 'mild' },
          { name: 'fıstık', severity: 'severe' },
        ],
        version: 2,
      },
      { emergencyInstructions: 'x'.repeat(501), version: 2 },
      { legalBasis: 'bilinmeyen', emergencyInstructions: 'x', version: 2 },
    ]
    for (const body of bad) fails(await write(t.cookies.admin, body), 400, 'validation_failed')
    const after = await ok(await read(t.cookies.admin))
    assert.deepEqual(after, before)
    const [row] = await profileRows(t.institution.id)
    assert.equal(row!.version, 2)
  })

  test('DOM-ILT-035 400: kayıt yokken hukuki dayanaksız gövde reddedilir, satır açılmaz', async () => {
    const t = await tenant()
    fails(
      await write(t.cookies.mother, { emergencyInstructions: 'x', version: 1 }),
      400,
      'validation_failed',
    )
    assert.equal((await profileRows(t.institution.id)).length, 0)
    assert.equal((await audits(t.institution.id)).length, 0)
  })

  test('DOM-ILT-035 kısmi PATCH yalnız gönderilen alanı değiştirir', async () => {
    const t = await tenant()
    await seed(t)
    const data = await ok(
      await write(t.cookies.mother, {
        emergencyInstructions: 'Okul hemşiresini arayın.',
        version: 2,
      }),
    )
    assert.equal(data.level, 'full')
    assert.equal(data.version, 3)
    assert.equal(data.profile.emergencyInstructions, 'Okul hemşiresini arayın.')
    assert.deepEqual(data.profile.allergies, PROFILE.allergies)
    assert.deepEqual(data.profile.chronicConditions, PROFILE.chronicConditions)
    assert.deepEqual(data.profile.medications, PROFILE.medications)
    assert.deepEqual(data.profile.supportNeeds, PROFILE.supportNeeds)
    assert.equal(data.profile.legalBasis, 'explicit_consent')
    // Boş liste göndermek o listeyi boşaltır; öteki alanlar kalır.
    const emptied = await ok(await write(t.cookies.mother, { allergies: [], version: 3 }))
    assert.deepEqual(emptied.profile.allergies, [])
    assert.deepEqual(emptied.profile.medications, PROFILE.medications)
    assert.equal(emptied.profile.emergencyInstructions, 'Okul hemşiresini arayın.')
    // Dayanak gönderilirse değişir.
    const basis = await ok(
      await write(t.cookies.mother, {
        supportNeeds: [],
        legalBasis: 'vital_interest',
        version: 4,
      }),
    )
    assert.equal(basis.profile.legalBasis, 'vital_interest')
    assert.deepEqual(basis.profile.medications, PROFILE.medications)
  })

  test('DOM-ILT-035 400: kayıt yokken yalnız dayanakla boş profil açılmaz', async () => {
    const t = await tenant()
    fails(
      await write(t.cookies.mother, { legalBasis: 'explicit_consent', version: 1 }),
      400,
      'validation_failed',
    )
    assert.equal((await profileRows(t.institution.id)).length, 0)
    assert.equal((await audits(t.institution.id)).length, 0)
  })

  test('DOM-ILT-035 kayıt varken yalnız dayanak değişir; içerik aynen kalır ve yeni dayanakla okunur', async () => {
    const t = await tenant()
    await seed(t)
    const [rawBefore] = await profileRows(t.institution.id)
    const data = await ok(
      await write(t.cookies.mother, { legalBasis: 'vital_interest', version: 2 }),
    )
    assert.equal(data.version, 3)
    assert.equal(data.profile.legalBasis, 'vital_interest')
    assert.deepEqual(data.profile.allergies, PROFILE.allergies)
    assert.deepEqual(data.profile.medications, PROFILE.medications)
    assert.equal(data.profile.emergencyInstructions, PROFILE.emergencyInstructions)
    // Şifreleme dayanağa bağlıdır (AAD): içerik yeniden şifrelenir, yeni dayanakla çözülür.
    const [raw] = await profileRows(t.institution.id)
    assert.equal(raw!.legalBasis, 'vital_interest')
    assert.notEqual(raw!.contentCiphertext, rawBefore!.contentCiphertext)
    assert.deepEqual(await ok(await read(t.cookies.admin)), data)
    const updates = (await audits(t.institution.id)).filter(
      (row) => row.action === 'health_profile.update',
    )
    // Sıra belirsiz: ilk yazım (6 alan) ve dayanak değişikliği (yalnız `legalBasis`).
    assert.equal(updates.length, 2)
    assert.ok(updates.some((row) => JSON.stringify(row.changes) === '{"fields":["legalBasis"]}'))
  })

  test('DOM-ILT-035 değişiklik yoksa yazılmaz: sürüm artmaz, satır ve denetim aynı kalır', async () => {
    const t = await tenant()
    const seeded = await seed(t)
    const rawBefore = await profileRows(t.institution.id)
    const auditsBefore = await audits(t.institution.id)
    // Aynı içerik ve aynı dayanak yeniden gönderilir.
    const same = await ok(
      await write(t.cookies.mother, {
        emergencyInstructions: PROFILE.emergencyInstructions,
        allergies: PROFILE.allergies,
        legalBasis: 'explicit_consent',
        version: 2,
      }),
    )
    assert.deepEqual(same, seeded)
    const onlyBasis = await ok(
      await write(t.cookies.admin, { legalBasis: 'explicit_consent', version: 2 }),
    )
    assert.deepEqual(onlyBasis, seeded)
    // Şifreleme her seferinde yeni nonce üretir; aynı bayt dizisi satırın hiç yazılmadığını gösterir.
    assert.deepEqual(await profileRows(t.institution.id), rawBefore)
    assert.deepEqual(await audits(t.institution.id), auditsBefore)
    // Sürüm 2 hâlâ geçerlidir: gerçek bir değişiklik 3'e çıkarır.
    const changed = await ok(await write(t.cookies.admin, { allergies: [], version: 2 }))
    assert.equal(changed.version, 3)
  })

  /** `health_profile.*` denetim satırının yazımını bozar: işlem geri alınmalıdır. */
  async function withFailingHealthAudit(institutionId: string, action: () => Promise<void>) {
    await db.execute(sql`
      create function test_fail_health_audit() returns trigger language plpgsql as $$
      begin raise exception 'test failure'; end $$`)
    await db.execute(
      sql.raw(`
      create trigger test_fail_health_audit before insert on audit_log for each row
      when (new.action like 'health_profile.%' and new.institution_id = '${institutionId}')
      execute function test_fail_health_audit()`),
    )
    try {
      await action()
    } finally {
      await db.execute(sql`drop trigger test_fail_health_audit on audit_log`)
      await db.execute(sql`drop function test_fail_health_audit()`)
    }
  }

  test('DOM-YTK-052 denetim satırı yazılamazsa okuma 500 döner ve yanıtta içerik yoktur', async () => {
    const t = await tenant()
    await seed(t)
    const auditsBefore = await audits(t.institution.id)
    await withFailingHealthAudit(t.institution.id, async () => {
      for (const cookie of [t.cookies.admin, t.cookies.teaching]) {
        const response = await read(cookie)
        fails(response, 500, 'internal_error')
        for (const secret of SECRETS)
          assert.ok(!response.body.includes(secret), `500 gövdesinde ${secret} var`)
        assert.ok(!response.body.includes('"profile"'), '500 gövdesinde profil var')
      }
    })
    assert.deepEqual(await audits(t.institution.id), auditsBefore)
    // Bozukluk giderilince aynı okuma çalışır.
    assert.equal((await ok(await read(t.cookies.admin))).level, 'full')
  })

  test('DOM-YTK-052 denetim satırı yazılamazsa yazma 500 döner ve satır değişmez', async () => {
    const t = await tenant()
    await seed(t)
    const rawBefore = await profileRows(t.institution.id)
    const auditsBefore = await audits(t.institution.id)
    await withFailingHealthAudit(t.institution.id, async () => {
      const response = await write(t.cookies.mother, {
        emergencyInstructions: 'Hiç yazılmamalı',
        version: 2,
      })
      fails(response, 500, 'internal_error')
      assert.ok(!response.body.includes('Hiç yazılmamalı'))
    })
    // Satır (içerik, dayanak, sürüm, şifreli değer) ve denetim aynen kalır.
    assert.deepEqual(await profileRows(t.institution.id), rawBefore)
    assert.deepEqual(await audits(t.institution.id), auditsBefore)
    const data = await ok(await read(t.cookies.admin))
    assert.equal(data.version, 2)
    assert.equal(data.profile.emergencyInstructions, PROFILE.emergencyInstructions)
  })

  test('DOM-ILT-035 aynı sürümle eşzamanlı iki PATCH: biri 200, öteki 409, sürüm bir artar', async () => {
    const t = await tenant()
    await seed(t)
    // Not: test veritabanı PGlite'tır, tek bağlantıdır; transaction'lar sıraya girer. Bu yüzden
    // test gerçek bir satır yarışını değil, iyimser kilidin sonucunu kanıtlar: aynı `version` ile
    // gelen iki isteğin yalnız biri yazılır, ikincisi 409 alır ve sürüm tam bir artar. Gerçek
    // eşzamanlı yarış (koşullu UPDATE'in `null` dönmesi ve 23505 yeniden deneme sınıfı) PostgreSQL
    // 16 takımının (`test:pg`) işidir.
    const [a, b] = await Promise.all([
      write(t.cookies.mother, { emergencyInstructions: 'Anne yazdı', version: 2 }),
      write(t.cookies.admin, { emergencyInstructions: 'Yönetici yazdı', version: 2 }),
    ])
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409])
    const winner = a.statusCode === 200 ? a : b
    const loser = a.statusCode === 200 ? b : a
    assert.equal(loser.json().code, 'version_conflict')
    assert.equal(winner.json().data.version, 3)
    const [row] = await profileRows(t.institution.id)
    assert.equal(row!.version, 3)
    const data = await ok(await read(t.cookies.admin))
    assert.equal(
      data.profile.emergencyInstructions,
      winner.json().data.profile.emergencyInstructions,
    )
    const updates = (await audits(t.institution.id)).filter(
      (item) => item.action === 'health_profile.update',
    )
    assert.equal(updates.length, 2, 'ilk yazım ve kazanan yazım; kaybeden denetim yazmaz')
  })

  test('DOM-ILT-035 yönetici, veli ve yetişkin öğrenci yazar; yazma kalıcıdır, yanıt tam görünümdür', async () => {
    const t = await tenant()
    const created = await ok(await write(t.cookies.mother, { ...PROFILE, version: 1 }), 200)
    assert.equal(created.level, 'full')
    assert.equal(created.version, 2)
    assert.equal(created.profile.updatedAt, FIXED_NOW.toISOString().replace(/\.\d+Z$/, '.000Z'))
    const again = await ok(await read(t.cookies.admin))
    assert.deepEqual(again, created)
    const adult = await ok(await write(t.cookies.adult, { ...PROFILE, version: 1 }, 's-3'))
    assert.equal(adult.version, 2)
    const [row] = await profileRows(t.institution.id).then((rows) =>
      rows.filter((item) => item.studentId === 's-1'),
    )
    assert.equal(row!.version, 2)
    assert.equal(row!.legalBasis, 'explicit_consent')
  })

  test('DOM-ILT-035 409: eski sürümle yazma reddedilir ve kayıt değişmez', async () => {
    const t = await tenant()
    await seed(t)
    await ok(await write(t.cookies.admin, { emergencyInstructions: 'Yeni', version: 2 }))
    fails(
      await write(t.cookies.mother, { emergencyInstructions: 'Eski sürümden', version: 2 }),
      409,
      'version_conflict',
    )
    // Kayıt yokken sürüm 1 dışında gelen de çakışmadır.
    const empty = await tenant()
    fails(await write(empty.cookies.admin, { ...PROFILE, version: 5 }), 409, 'version_conflict')
    assert.equal((await profileRows(empty.institution.id)).length, 0)
    const data = await ok(await read(t.cookies.admin))
    assert.equal(data.profile.emergencyInstructions, 'Yeni')
    assert.equal(data.version, 3)
  })

  test('DOM-YTK-052 her okuma doğru eylemle denetlenir; içerik denetime girmez', async () => {
    const t = await tenant()
    await seed(t)
    await ok(await read(t.cookies.admin))
    await ok(await read(t.cookies.homeroom))
    await ok(await read(t.cookies.mother))
    await ok(await read(t.cookies.teaching))
    const rows = await audits(t.institution.id)
    const of = (action: string) => rows.filter((row) => row.action === action)
    assert.deepEqual(
      of('health_profile.read')
        .map((row) => row.actorRole)
        .sort(),
      ['ogretmen', 'veli', 'yonetici'],
    )
    for (const row of of('health_profile.read')) {
      assert.equal(row.entityType, 'student')
      assert.equal(row.entityId, 's-1')
      assert.deepEqual(row.changes, { fields: FULL_FIELDS })
    }
    assert.equal(of('health_profile.read_emergency').length, 1)
    assert.deepEqual(of('health_profile.read_emergency')[0], {
      action: 'health_profile.read_emergency',
      actorRole: 'ogretmen',
      entityType: 'student',
      entityId: 's-1',
      changes: { fields: ['allergies', 'emergencyInstructions'] },
    })
    const dump = JSON.stringify(rows)
    for (const secret of SECRETS) assert.ok(!dump.includes(secret), `denetimde ${secret} var`)
  })

  test('DOM-YTK-052 kayıt yokken de okuma denetlenir', async () => {
    const t = await tenant()
    await ok(await read(t.cookies.admin))
    const rows = await audits(t.institution.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.action, 'health_profile.read')
  })

  test('DOM-YTK-052 yazma yalnız değişen alan adlarını denetime yazar', async () => {
    const t = await tenant()
    await seed(t)
    await ok(await write(t.cookies.mother, { emergencyInstructions: 'Yeni talimat', version: 2 }))
    await ok(
      await write(t.cookies.admin, {
        medications: [],
        legalBasis: 'legal_obligation',
        version: 3,
      }),
    )
    const rows = (await audits(t.institution.id)).filter(
      (row) => row.action === 'health_profile.update',
    )
    assert.equal(rows.length, 3)
    const fields = rows.map((row) => row.changes?.fields)
    assert.deepEqual(
      fields.find((item) => item?.length === 6),
      FULL_FIELDS,
    )
    assert.ok(fields.some((item) => JSON.stringify(item) === '["emergencyInstructions"]'))
    assert.ok(fields.some((item) => JSON.stringify(item) === '["medications","legalBasis"]'))
    const dump = JSON.stringify(rows)
    for (const secret of [...SECRETS, 'Yeni talimat'])
      assert.ok(!dump.includes(secret), `denetimde ${secret} var`)
    for (const row of rows) assert.equal(row.entityId, 's-1')
  })

  test('DOM-ILT-035 bütün modüller kapalıyken de uçlar çalışır (çekirdek kayıt)', async () => {
    const t = await tenant({ allModulesOff: true })
    const saved = await ok(await write(t.cookies.admin, { ...PROFILE, version: 1 }))
    assert.equal(saved.version, 2)
    const emergency = await ok(await read(t.cookies.teaching))
    assert.equal(emergency.level, 'emergency')
    assert.deepEqual(emergency.profile.allergies, PROFILE.allergies)
    assert.equal((await ok(await read(t.cookies.mother))).level, 'full')
  })

  test('DOM-ILT-035 ham satırda düz metin yok; içerik şifreli saklanır', async () => {
    const t = await tenant()
    await seed(t)
    const rows = await profileRows(t.institution.id)
    assert.equal(rows.length, 1)
    const dump = JSON.stringify(rows)
    for (const secret of SECRETS) assert.ok(!dump.includes(secret), `ham satırda ${secret} var`)
    assert.ok(rows[0]!.contentCiphertext.length > 0)
    assert.equal(rows[0]!.legalBasis, 'explicit_consent')
  })

  test('başka kurum: öğrenci 404, B değişmez; gövdedeki institutionId etkisiz', async () => {
    const a = await tenant()
    const b = await tenant()
    await insertMissingRecords(
      db,
      b.institution.id,
      [
        {
          collection: 'students' as const,
          id: 's-b',
          data: { id: 's-b', name: 'B Öğrencisi', classId: '9-A', isActive: true },
        },
      ],
      FIXED_NOW,
    )
    await seed(b, 's-b')
    const before = await profileRows(b.institution.id)
    fails(await read(a.cookies.admin, 's-b'), 404, 'not_found')
    fails(await write(a.cookies.admin, { ...PROFILE, version: 2 }, 's-b'), 404, 'not_found')
    fails(
      await write(a.cookies.admin, {
        ...PROFILE,
        version: 1,
        institutionId: b.institution.id,
      }),
      400,
      'validation_failed',
    )
    assert.deepEqual(await profileRows(b.institution.id), before)
    assert.equal((await profileRows(a.institution.id)).length, 0)
    assert.equal(
      (await audits(a.institution.id)).length,
      0,
      'reddedilen istek A kurumuna denetim yazmaz',
    )
  })
})
