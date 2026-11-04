import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import {
  healthProfileContentSchema,
  type HealthProfileContent,
} from '@kampus/school-core/lib/health-profile.ts'

import { TEST_FIELD_ENCRYPTION_KEY } from '../src/config.ts'
import type { Database } from '../src/db/client.ts'
import {
  HealthProfileIntegrityError,
  loadHealthProfile,
  saveHealthProfile,
} from '../src/db/health-profiles.ts'
import { institutions } from '../src/db/schema/auth.ts'
import { studentHealthProfiles } from '../src/db/schema/student-health-profiles.ts'
import { fieldCipherFromConfig } from '../src/lib/field-crypto.ts'
import { createTestDatabase, FIXED_NOW, uniqueId } from './support/app.ts'

const cipher = fieldCipherFromConfig({ FIELD_ENCRYPTION_KEY: TEST_FIELD_ENCRYPTION_KEY })
const ALLERGEN = 'Yerfıstığı-test-alerjeni'
const content: HealthProfileContent = healthProfileContentSchema.parse({
  allergies: [{ name: ALLERGEN, severity: 'severe' }],
  chronicConditions: [{ name: 'Astım' }],
  medications: [{ name: 'Salbutamol', schedule: 'gerektiğinde', atSchool: true }],
  emergencyInstructions: 'Adrenalin oto-enjektörü çantada.',
})

describe('sağlık bilgisi deposu (IST-020, DOM-ILT-035)', () => {
  let db: Database
  let close: () => Promise<void>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
  })
  after(async () => {
    await close()
  })

  async function institution(): Promise<string> {
    const id = uniqueId('test-kurum')
    await db
      .insert(institutions)
      .values({ id, name: id, slug: id, createdAt: FIXED_NOW, enabledModules: {} })
    return id
  }

  const save = (institutionId: string, studentId: string, expectedVersion = 1) =>
    saveHealthProfile(
      db,
      institutionId,
      studentId,
      {
        content,
        legalBasis: 'explicit_consent',
        expectedVersion,
        actorUserId: 'test-u-veli',
        now: FIXED_NOW,
      },
      cipher,
    )

  test('DOM-ILT-035: yazılan bilgi çözülerek okunur; kayıt yoksa null', async () => {
    const inst = await institution()
    assert.equal(await loadHealthProfile(db, inst, 'test-s1', cipher), null)
    const saved = await save(inst, 'test-s1')
    assert.equal(saved?.version, 2)
    assert.equal(saved?.keyVersion, 1)
    const loaded = await loadHealthProfile(db, inst, 'test-s1', cipher)
    assert.deepEqual(loaded?.content, content)
    assert.equal(loaded?.legalBasis, 'explicit_consent')
    assert.equal(loaded?.updatedByUserId, 'test-u-veli')
    assert.equal(loaded?.version, 2)
  })

  test('DOM-ILT-035: veritabanında düz metin yok', async () => {
    const inst = await institution()
    await save(inst, 'test-s1')
    const { rows } = (await db.execute(
      sql`select * from student_health_profiles where institution_id = ${inst}`,
    )) as unknown as { rows: Record<string, unknown>[] }
    assert.equal(rows.length, 1)
    const raw = JSON.stringify(rows)
    for (const secret of [ALLERGEN, 'Astım', 'Salbutamol', 'oto-enjektörü', 'severe'])
      assert.ok(!raw.includes(secret), secret)
  })

  test('DOM-ILT-035: kurum yalıtımı — başka kurum okuyamaz ve yazamaz', async () => {
    const a = await institution()
    const b = await institution()
    await save(a, 'test-s1')
    assert.equal(await loadHealthProfile(db, b, 'test-s1', cipher), null)
    // B'nin sürüm 2 ile yazması A'nın satırını değiştirmez.
    assert.equal(await save(b, 'test-s1', 2), null)
    const [rowA] = await db
      .select()
      .from(studentHealthProfiles)
      .where(eq(studentHealthProfiles.institutionId, a))
    assert.equal(rowA?.version, 2)
  })

  test('DOM-ILT-035: başka kurumun ya da öğrencinin satırına kopyalanan şifreli içerik çözülmez', async () => {
    const a = await institution()
    const b = await institution()
    await save(a, 'test-s1')
    await save(a, 'test-s2')
    await save(b, 'test-s1')
    const [source] = await db
      .select({ contentCiphertext: studentHealthProfiles.contentCiphertext })
      .from(studentHealthProfiles)
      .where(
        and(
          eq(studentHealthProfiles.institutionId, a),
          eq(studentHealthProfiles.studentId, 'test-s1'),
        ),
      )
    assert.ok(source)
    for (const [inst, student] of [
      [a, 'test-s2'],
      [b, 'test-s1'],
    ] as const) {
      await db
        .update(studentHealthProfiles)
        .set({ contentCiphertext: source.contentCiphertext })
        .where(
          and(
            eq(studentHealthProfiles.institutionId, inst),
            eq(studentHealthProfiles.studentId, student),
          ),
        )
      await assert.rejects(
        loadHealthProfile(db, inst, student, cipher),
        (error: unknown) =>
          error instanceof HealthProfileIntegrityError && !error.message.includes(ALLERGEN),
      )
    }
  })

  test('DOM-ILT-035: sürüm çakışması null döner ve satırı değiştirmez', async () => {
    const inst = await institution()
    const first = await save(inst, 'test-s1')
    assert.equal(first?.version, 2)
    // İkinci "ilk yazım" (sürüm 1) var olan satırın üzerine yazmaz.
    assert.equal(await save(inst, 'test-s1', 1), null)
    // Eski sürüm reddedilir.
    const next = await saveHealthProfile(
      db,
      inst,
      'test-s1',
      {
        content: { ...content, emergencyInstructions: 'Yeni talimat' },
        legalBasis: 'vital_interest',
        expectedVersion: 2,
        actorUserId: 'test-u-admin',
        now: FIXED_NOW,
      },
      cipher,
    )
    assert.equal(next?.version, 3)
    assert.equal(next?.legalBasis, 'vital_interest')
    assert.equal(await save(inst, 'test-s1', 2), null)
    const loaded = await loadHealthProfile(db, inst, 'test-s1', cipher)
    assert.equal(loaded?.version, 3)
    assert.equal(loaded?.content.emergencyInstructions, 'Yeni talimat')
    assert.equal(loaded?.updatedByUserId, 'test-u-admin')
  })

  test('DOM-ILT-035: arşivli satır okunmaz, öğrenci için yeni kayıt açılabilir', async () => {
    const inst = await institution()
    await save(inst, 'test-s1')
    await db
      .update(studentHealthProfiles)
      .set({ archivedAt: FIXED_NOW })
      .where(eq(studentHealthProfiles.institutionId, inst))
    assert.equal(await loadHealthProfile(db, inst, 'test-s1', cipher), null)
    assert.equal((await save(inst, 'test-s1'))?.version, 2)
  })

  test('DOM-ILT-035: geçersiz hukuki dayanak veritabanı kısıtına takılır', async () => {
    const inst = await institution()
    await assert.rejects(
      db.insert(studentHealthProfiles).values({
        institutionId: inst,
        id: crypto.randomUUID(),
        studentId: 'test-s1',
        contentCiphertext: 'x',
        keyVersion: 1,
        legalBasis: 'legitimate_interest' as never,
        updatedByUserId: 'test-u-admin',
      }),
    )
  })
})
