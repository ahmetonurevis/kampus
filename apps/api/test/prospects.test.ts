import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { institutionSettings } from '../src/db/schema/institution-settings.ts'
import { records } from '../src/db/schema/records.ts'
import { studentIdentities } from '../src/db/schema/student-identities.ts'
import { loadStudentGuardians } from '../src/db/student-guardians.ts'
import { AppError } from '../src/errors.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { addProspectNoteCommand } from '../src/services/prospects.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  nextIp,
  signInAs,
  TEST_ORIGIN,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Aday/CRM yazma uçları (docs/domain/kayit-ve-crm.md DOM-KAY-001…009, DOM-KAY-030…034; deneme
 * dersi DOM-DIL-030). Her test kendi kurumunu örnek veri kesitiyle kurar: üç kampüs, kadro, 7-A
 * (c1, b1) ve öğrencileri, 7-A ders programı ve seed adayları pr1…pr5 (pr1 b1 Yeni aday, pr5 b2
 * Vazgeçti). FIXED_NOW 2026-10-06 09:00Z salıdır; görüşmeler cumartesi (ders yok) planlanır.
 */

const SEED = createSeed(FIXED_NOW)
type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const SAMPLE: Sample = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => item.id === 'c1'),
  students: SEED.students.filter((item) => item.classId === 'c1'),
  schedule: SEED.schedule.filter((item) => item.classId === 'c1'),
  prospects: SEED.prospects.slice(0, 5),
}
const LESSON = SEED.schedule.find(
  (item) => item.classId === 'c1' && Date.parse(item.date) > +FIXED_NOW,
)
const PR1 = SEED.prospects[0]
const SATURDAY = '2026-10-10T10:00:00.000Z'

function rows(sample: Sample) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

/** Örnek veriye ek kayıtlar ekler (koleksiyon başına birleştirir). */
function withRecords(extra: Sample): Sample {
  const merged: Sample = { ...SAMPLE }
  for (const [collection, items] of Object.entries(extra)) {
    const name = collection as CollectionName
    merged[name] = [...(merged[name] ?? []), ...(items ?? [])]
  }
  return merged
}

const PHONE = '05559990001'
const EMAIL = 'test-aday@kampus.example'
const GUARDIAN = 'Test Velisi Gizli'
const NOTE = 'Test aday görüşme notu: burs koşullarını sordu.'
const PROSPECT = {
  name: 'Test Aday',
  phone: PHONE,
  email: EMAIL,
  branchId: 'b1',
  interest: '7. Sınıf · Ortaokul',
  source: 'Web sitesi',
  guardianName: GUARDIAN,
  privacyNoticeVersion: 'aydinlatma-2026-1',
}
const MEETING = { date: SATURDAY, duration: 45, room: 'Görüşme odası' }

/** Bağın karşılaştırılan alanları (kimlik ve sürüm hariç). */
const bondOf = (link: {
  parentId: string | null
  membershipId: string | null
  relationship: string
  custody: string
  contactRestricted: boolean
  isPayer: boolean
  canPickUp: boolean
}) => ({
  parentId: link.parentId,
  membershipId: link.membershipId,
  relationship: link.relationship,
  custody: link.custody,
  contactRestricted: link.contactRestricted,
  isPayer: link.isPayer,
  canPickUp: link.canPickUp,
})

describe('aday uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-pr-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    assert.ok(LESSON, 'örnek veride 7-A’nın gelecek dersi yok')
    assert.ok(PR1)
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}, sample = SAMPLE) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows(sample), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }
  async function member(institutionId: string, role: Role) {
    const links =
      role === 'ogretmen'
        ? [{ kind: 'teacher' as const, recordId: 't1' }]
        : role === 'ogrenci'
          ? [{ kind: 'student' as const, recordId: 's1' }]
          : role === 'veli'
            ? [{ kind: 'child' as const, recordId: 's1' }]
            : []
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const frontDesk = async (institutionId: string) => (await member(institutionId, 'onburo')).cookie

  function send(
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = {},
    target: App = app,
  ) {
    // Her istek ayrı adresten gelir: dosya çok istek attığı için tek adres genel hız sınırına (300/dk) takılır.
    return target.inject({
      method,
      url,
      remoteAddress: nextIp(),
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  }
  const a_get = (cookie: string | null, url: string) =>
    app.inject({
      method: 'GET',
      url,
      remoteAddress: nextIp(),
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })
  const create = (
    cookie: string | null,
    body: unknown = PROSPECT,
    headers: Record<string, string> = key(),
  ) => send('POST', '/api/v1/prospects', cookie, body, headers)
  const ifMatch = (version: number | null): Record<string, string> =>
    version === null ? {} : { 'if-match': `"${String(version)}"` }
  const stage = (cookie: string | null, id: string, body: unknown, version: number | null) =>
    send('PATCH', `/api/v1/prospects/${id}`, cookie, body, ifMatch(version))
  const note = (cookie: string | null, id: string, body: unknown, version: number | null) =>
    send('POST', `/api/v1/prospects/${id}/notes`, cookie, body, ifMatch(version))
  const meeting = (cookie: string | null, id: string, body: unknown, version: number | null) =>
    send('POST', `/api/v1/prospects/${id}/meetings`, cookie, body, ifMatch(version))
  const trial = (cookie: string | null, id: string, body: unknown, version: number | null) =>
    send('POST', `/api/v1/prospects/${id}/trial-lessons`, cookie, body, ifMatch(version))
  const stageRevert = (cookie: string | null, id: string, body: unknown, version: number | null) =>
    send('POST', `/api/v1/prospects/${id}/stage-revert`, cookie, body, ifMatch(version))
  const consent = (cookie: string | null, id: string, body: unknown, version: number | null) =>
    send('POST', `/api/v1/prospects/${id}/marketing-consent`, cookie, body, ifMatch(version))
  const details = (cookie: string | null, id: string, body: unknown, version: number | null) =>
    send('PATCH', `/api/v1/prospects/${id}/details`, cookie, body, ifMatch(version))
  const trialResult = (
    cookie: string | null,
    id: string,
    body: unknown,
    version: number | null,
    target: App = app,
  ) => send('POST', `/api/v1/prospects/${id}/trial-result`, cookie, body, ifMatch(version), target)

  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const stored = (institutionId: string) => loadRecords(db, institutionId, ['prospects'])
  const versionOf = async (institutionId: string, id: string) => {
    const record = await findRecord(db, institutionId, 'prospects', id)
    assert.ok(record, id)
    return record.version
  }
  async function created(cookie: string, body: unknown = PROSPECT) {
    const response = await create(cookie, body)
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data
    return { id: data.entity.id as string, version: data.records[0].version as number }
  }
  /** Başarısız isteklerden sonra adayın verisi ve sürümü aynı kalır. */
  async function unchanged(institutionId: string, id: string, action: () => Promise<void>) {
    const before = await findRecord(db, institutionId, 'prospects', id)
    assert.ok(before, id)
    await action()
    const after = await findRecord(db, institutionId, 'prospects', id)
    assert.deepEqual(after?.data, before.data)
    assert.equal(after?.version, before.version)
  }

  // --- Kimlik, rol, modül ----------------------------------------------------------------------

  test('DOM-KAY-009: oturumsuz istek 401', async () => {
    assertError(await create(null), 401)
    assertError(await stage(null, 'pr1', { stage: 'Teklif verildi' }, 1), 401)
    assertError(await note(null, 'pr1', { text: NOTE }, 1), 401)
    assertError(await meeting(null, 'pr1', MEETING, 1), 401)
    assertError(await trial(null, 'pr1', { lessonId: 'x' }, 1), 401)
  })

  test('DOM-KAY-035, DOM-YTK-001: öğretmen, öğrenci ve veli aday yazamaz (403); aday değişmez', async () => {
    const a = await institution()
    await unchanged(a.id, 'pr1', async () => {
      for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
        const { cookie } = await member(a.id, role)
        assertError(await create(cookie), 403, 'forbidden')
        assertError(await stage(cookie, 'pr1', { stage: 'Teklif verildi' }, 1), 403, 'forbidden')
        assertError(await note(cookie, 'pr1', { text: NOTE }, 1), 403, 'forbidden')
        assertError(await meeting(cookie, 'pr1', MEETING, 1), 403, 'forbidden')
      }
    })
    assert.equal((await stored(a.id)).length, 5)
  })

  test('DOM-YTK-040: crm modülü kapalıyken aday uçları 403 module_disabled', async () => {
    const a = await institution({ type: 'language_school', enabledModules: { crm: false } })
    await unchanged(a.id, 'pr1', async () => {
      const cookie = a.adminCookie
      assertError(await create(cookie), 403, 'module_disabled')
      assertError(
        await stage(cookie, 'pr1', { stage: 'Teklif verildi' }, 1),
        403,
        'module_disabled',
      )
      assertError(await note(cookie, 'pr1', { text: NOTE }, 1), 403, 'module_disabled')
      assertError(await meeting(cookie, 'pr1', MEETING, 1), 403, 'module_disabled')
      assertError(await trial(cookie, 'pr1', { lessonId: LESSON?.id }, 1), 403, 'module_disabled')
    })
  })

  // --- Aday ekleme -------------------------------------------------------------------------------

  test('DOM-KAY-001, DOM-KAY-009: ön büro aday ekler; 201, Location, Yeni aday, aydınlatma sürümü; denetimde kişisel veri yok', async () => {
    const a = await institution()
    const b = await institution()
    const desk = await member(a.id, 'onburo')
    const response = await create(desk.cookie)
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.entity.id
    assert.equal(response.headers.location, `/api/v1/collections/prospects/${id}`)
    const record = await findRecord(db, a.id, 'prospects', id)
    assert.equal(record?.data.stage, 'Yeni aday')
    assert.equal(record?.data.minor, true)
    assert.equal(record?.data.guardianName, GUARDIAN)
    assert.equal(record?.data.studentId, null)
    assert.deepEqual(record?.data.privacyNotice, {
      version: 'aydinlatma-2026-1',
      shownAt: FIXED_NOW.toISOString(),
    })
    assert.deepEqual(record?.data.createdBy, { role: 'onburo', userId: desk.id })
    // Aday akademik veya finansal kayıt üretmez (DOM-KAY-001).
    assert.equal((await loadRecords(db, a.id, ['students'])).length, SAMPLE.students?.length)
    assert.equal((await loadRecords(db, a.id, ['invoices', 'contracts'])).length, 0)
    assert.equal((await stored(b.id)).length, 5)
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'prospect.create')))
    assert.equal(audit.length, 1)
    assert.equal(audit[0]?.entityId, id)
    for (const value of [PHONE, EMAIL, GUARDIAN])
      assert.equal(JSON.stringify(audit).includes(value), false)
    // Yönetici de ekler; okuma köprüsünde ön büro adayı görür.
    await created(a.adminCookie, {
      ...PROSPECT,
      name: 'Test İkinci',
      phone: '05559990002',
      email: '',
    })
    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/collections/prospects/${id}`,
      headers: { origin: TEST_ORIGIN, cookie: desk.cookie },
    })
    assert.equal(listed.statusCode, 200, listed.body)
  })

  test('DOM-KAY-009: aynı Idempotency-Key ilk yanıtı tekrarlar; anahtarsız istek 400, If-Match 400', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    const headers = key()
    const first = await create(cookie, PROSPECT, headers)
    assert.equal(first.statusCode, 201, first.body)
    const again = await create(cookie, PROSPECT, headers)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    assert.equal((await stored(a.id)).length, 6)
    assertError(await create(cookie, PROSPECT, {}), 400, 'idempotency_key_required')
    assertError(
      await create(cookie, PROSPECT, { ...key(), 'if-match': '"1"' }),
      400,
      'if_match_not_supported',
    )
    // Aynı anahtar, farklı gövde: 422, ikinci aday açılmaz.
    assertError(
      await create(cookie, { ...PROSPECT, name: 'Başka Aday' }, headers),
      422,
      'idempotency_key_reused',
    )
    assert.equal((await stored(a.id)).length, 6)
  })

  test('DOM-KAY-009: geçersiz gövde 400 ve kural reddi 422; aday açılmaz, gövdedeki institutionId reddedilir', async () => {
    const a = await institution()
    const b = await institution()
    const cookie = await frontDesk(a.id)
    for (const body of [
      { ...PROSPECT, phone: '5551234' },
      { ...PROSPECT, privacyNoticeVersion: '' },
      { ...PROSPECT, nationalId: '12345678901' },
      { ...PROSPECT, institutionId: b.id },
      { ...PROSPECT, source: 'Reklam' },
    ]) {
      const invalid = await create(cookie, body)
      assertError(invalid, 400, 'validation_failed')
      assert.equal(invalid.body.includes(PHONE), false)
    }
    // Okul adayı yetişkin sayılamaz; pasif/olmayan kampüs ve referanssız veli referansı 422.
    const adult = await create(cookie, { ...PROSPECT, minor: false })
    assertError(adult, 422, 'prospect_guardian_required')
    assert.deepEqual(adult.json().issues[0].path, ['minor'])
    assertError(await create(cookie, { ...PROSPECT, branchId: 'b-yok' }), 422, 'branch_unavailable')
    assertError(
      await create(cookie, { ...PROSPECT, source: 'Veli referansı' }),
      422,
      'referrer_required',
    )
    assert.equal((await stored(a.id)).length, 5)
    assert.equal((await stored(b.id)).length, 5)
  })

  test('DOM-KAY-002, DOM-KAY-031: mükerrer aday 409; ret eşleşen adayın kimliğini taşımaz; kardeş seçilince açılır', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    const first = await created(cookie)
    // Aynı ad (büyük/küçük harf, boşluk farkı) ve aynı telefon: mükerrer.
    const duplicate = await create(cookie, { ...PROSPECT, name: '  test  ADAY ', email: '' })
    assertError(duplicate, 409, 'prospect_duplicate')
    assert.deepEqual(duplicate.json().issues[0].path, ['phone'])
    // Seed adayının e-postasıyla farklı ad: iletişim paylaşılıyor, kardeş seçilmeli.
    const shared = await create(cookie, {
      ...PROSPECT,
      name: 'Test Kardeş',
      phone: '05559990003',
      email: PR1?.email,
    })
    assertError(shared, 409, 'prospect_contact_shared')
    for (const response of [duplicate, shared]) {
      for (const leaked of [first.id, 'pr1', PHONE, PR1?.email ?? '', PR1?.name ?? ''])
        assert.equal(response.body.includes(leaked), false, `yanıtta: ${leaked}`)
      assert.deepEqual(Object.keys(response.json()).sort(), [
        'code',
        'issues',
        'message',
        'requestId',
      ])
    }
    assert.equal((await stored(a.id)).length, 6)
    const sibling = await created(cookie, {
      ...PROSPECT,
      name: 'Test Kardeş',
      phone: PHONE,
      siblingOfId: first.id,
    })
    const record = await findRecord(db, a.id, 'prospects', sibling.id)
    assert.equal(record?.data.siblingOfId, first.id)
    // Başka kurumun adayı kardeş seçilemez ve tekilliği etkilemez.
    const b = await institution()
    const foreign = await create(await frontDesk(b.id), {
      ...PROSPECT,
      name: 'Test Kardeş',
      siblingOfId: first.id,
    })
    assertError(foreign, 422, 'sibling_not_found')
    await created(await frontDesk(b.id))
  })

  test('DOM-KAY-031, DOM-KAY-033, DOM-DIL-030: başka kurumun öğrencisi, öğretmeni, grubu ve dersi kullanılamaz; kural 422 / 404 ve aday değişmez', async () => {
    // Kimlikler yalnız B kurumundadır; örnek veri kimlikleri (t1, s1…) iki kurumda da bulunduğundan
    // kurum sınırını kanıtlamaz.
    const teacher = SEED.teachers[0]
    const pupil = SEED.students[0]
    const group = SEED.classes.find((item) => item.id === 'c1')
    assert.ok(teacher && pupil && group && LESSON)
    const onlyB = withRecords({
      teachers: [{ ...teacher, id: 't-b-only', isActive: true }],
      students: [{ ...pupil, id: 's-b-only', isActive: true }],
      classes: [{ ...group, id: 'c-b-only' }],
      schedule: [{ ...LESSON, id: 'lesson-b-only', classId: 'c-b-only' }],
    })
    const a = await institution(
      { type: 'language_school' },
      withRecords({
        // A kurumunda ders var, ama grubu yalnız B'dedir (programdan kalmış başka kurum kimliği).
        schedule: [{ ...LESSON, id: 'lesson-a-foreign-group', classId: 'c-b-only' }],
      }),
    )
    const b = await institution({ type: 'language_school' }, onlyB)
    const insider = await frontDesk(a.id)
    const child = await created(insider, {
      ...PROSPECT,
      minor: true,
      interest: 'B1 · Genel İngilizce',
    })
    const referral = {
      ...PROSPECT,
      minor: true,
      name: 'Test Referanslı',
      phone: '05559990004',
      email: '',
      source: 'Veli referansı',
      referrerStudentId: 's-b-only',
    }
    await unchanged(a.id, child.id, async () => {
      const before = (await stored(a.id)).length
      assertError(await create(insider, referral), 422, 'referrer_not_found')
      assert.equal((await stored(a.id)).length, before)
      assertError(
        await meeting(insider, child.id, { ...MEETING, teacherId: 't-b-only' }, child.version),
        422,
        'meeting_teacher_unavailable',
      )
      const foreignLesson = await trial(
        insider,
        child.id,
        { lessonId: 'lesson-b-only', guardianConsent: true },
        child.version,
      )
      assertError(foreignLesson, 404, 'not_found')
      assertError(
        await trial(
          insider,
          child.id,
          { lessonId: 'lesson-a-foreign-group', guardianConsent: true },
          child.version,
        ),
        422,
        'trial_group_unavailable',
      )
    })
    // Kontrol: aynı kimlikler kendi kurumlarında geçerlidir (testin boş geçmediğini gösterir).
    const own = await frontDesk(b.id)
    const ownChild = await created(own, {
      ...PROSPECT,
      minor: true,
      interest: 'B1 · Genel İngilizce',
    })
    assert.equal((await create(own, referral)).statusCode, 201)
    const planned = await meeting(
      own,
      ownChild.id,
      { ...MEETING, teacherId: 't-b-only' },
      ownChild.version,
    )
    assert.equal(planned.statusCode, 200, planned.body)
    const ownTrial = await trial(
      own,
      ownChild.id,
      { lessonId: 'lesson-b-only', guardianConsent: true },
      await versionOf(b.id, ownChild.id),
    )
    assert.equal(ownTrial.statusCode, 200, ownTrial.body)
  })

  // --- Aşama -------------------------------------------------------------------------------------

  test('DOM-KAY-030: aşama If-Match ile ileri gider; geri dönüş 422, aynı aşama 409, Kayıt oldu 422; aday değişmez', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    assertError(
      await stage(cookie, 'pr1', { stage: 'Teklif verildi' }, null),
      400,
      'if_match_required',
    )
    const moved = await stage(cookie, 'pr1', { stage: 'Teklif verildi' }, version)
    assert.equal(moved.statusCode, 200, moved.body)
    const next: number = moved.json().data.records[0].version
    assert.equal(next, version + 1)
    await unchanged(a.id, 'pr1', async () => {
      assertError(
        await stage(cookie, 'pr1', { stage: 'İletişime geçildi' }, next),
        422,
        'prospect_stage_backward',
      )
      assertError(
        await stage(cookie, 'pr1', { stage: 'Teklif verildi' }, next),
        409,
        'prospect_stage_unchanged',
      )
      assertError(
        await stage(cookie, 'pr1', { stage: 'Kayıt oldu' }, next),
        422,
        'prospect_enroll_required',
      )
      const noReason = await stage(cookie, 'pr1', { stage: 'Vazgeçti' }, next)
      assertError(noReason, 422, 'prospect_lost_reason_required')
      assertError(
        await stage(cookie, 'pr1', { stage: 'Vazgeçti', lostReason: 'pahali' }, next),
        400,
        'validation_failed',
      )
    })
    const lost = await stage(cookie, 'pr1', { stage: 'Vazgeçti', lostReason: 'price' }, next)
    assert.equal(lost.statusCode, 200, lost.body)
    const record = await findRecord(db, a.id, 'prospects', 'pr1')
    assert.equal(record?.data.stage, 'Vazgeçti')
    assert.equal(record?.data.lostReason, 'price')
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'prospect.stage')))
    assert.equal(audit.length, 2)
  })

  test('DOM-KAY-030, DOM-KAY-031: vazgeçen aday yeniden açılırken iletişimi paylaşan açık aday varsa kardeş ister', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    // pr5 (Vazgeçti) ile aynı telefonu taşıyan farklı adlı açık aday.
    const pr5 = SEED.prospects[4]
    assert.ok(pr5)
    const other = await created(cookie, {
      ...PROSPECT,
      name: 'Test Kardeş',
      phone: pr5.phone,
      email: '',
    })
    const version = await versionOf(a.id, 'pr5')
    await unchanged(a.id, 'pr5', async () => {
      const blocked = await stage(cookie, 'pr5', { stage: 'İletişime geçildi' }, version)
      assertError(blocked, 409, 'prospect_contact_shared')
      assert.equal(blocked.body.includes(other.id), false)
      assertError(
        await stage(cookie, 'pr5', { stage: 'İletişime geçildi', siblingOfId: 'pr1' }, version),
        422,
        'sibling_not_found',
      )
    })
    const reopened = await stage(
      cookie,
      'pr5',
      { stage: 'İletişime geçildi', siblingOfId: other.id },
      version,
    )
    assert.equal(reopened.statusCode, 200, reopened.body)
    const record = await findRecord(db, a.id, 'prospects', 'pr5')
    assert.equal(record?.data.stage, 'İletişime geçildi')
    assert.equal(record?.data.siblingOfId, other.id)
    assert.equal(record?.data.lostReason, undefined)
  })

  test('DOM-KAY-030: başka kurumun ve olmayan aday sürüm ne olursa olsun 404; yetkili yanlış sürüm 409; yetkisiz rol 403', async () => {
    const a = await institution()
    const b = await institution()
    const outsider = await frontDesk(b.id)
    const insider = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    const id = (await created(insider)).id
    const idVersion = await versionOf(a.id, id)
    await unchanged(a.id, id, async () => {
      for (const tried of [idVersion, idVersion + 4]) {
        assertError(await stage(outsider, id, { stage: 'Teklif verildi' }, tried), 404, 'not_found')
        assertError(await note(outsider, id, { text: NOTE }, tried), 404, 'not_found')
        assertError(await meeting(outsider, id, MEETING, tried), 404, 'not_found')
      }
      assertError(
        await stage(insider, id, { stage: 'Teklif verildi' }, idVersion + 1),
        409,
        'version_conflict',
      )
      assertError(await note(insider, id, { text: NOTE }, idVersion + 1), 409, 'version_conflict')
      assertError(await meeting(insider, id, MEETING, idVersion + 1), 409, 'version_conflict')
      // Yanlış sürümdeki kural hatası da 409 olur: istemcinin gördüğü kayıt bayattır.
      assertError(
        await stage(insider, id, { stage: 'Kayıt oldu' }, idVersion + 1),
        409,
        'version_conflict',
      )
      const teacher = (await member(a.id, 'ogretmen')).cookie
      assertError(
        await stage(teacher, id, { stage: 'Teklif verildi' }, idVersion + 1),
        403,
        'forbidden',
      )
    })
    await unchanged(a.id, 'pr1', async () => {
      assertError(await stage(insider, 'pr-yok', { stage: 'Teklif verildi' }, 1), 404, 'not_found')
      assertError(await note(insider, 'pr-yok', { text: NOTE }, 1), 404, 'not_found')
      // b kurumunun kendi pr1'i vardır; a'nın pr1'i b'den değiştirilemez, b'nin pr1'i değişir.
      const own = await stage(outsider, 'pr1', { stage: 'Teklif verildi' }, version)
      assert.equal(own.statusCode, 200, own.body)
    })
    assert.equal((await findRecord(db, b.id, 'prospects', 'pr1'))?.data.stage, 'Teklif verildi')
  })

  // --- Not ---------------------------------------------------------------------------------------

  test('DOM-KAY-032: not eklenir; yazar adı oturumdan, gövdedeki authorName 400; kapalı adaya not 409', async () => {
    const a = await institution()
    const desk = await member(a.id, 'onburo')
    const version = await versionOf(a.id, 'pr1')
    await unchanged(a.id, 'pr1', async () => {
      assertError(await note(desk.cookie, 'pr1', { text: NOTE }, null), 400, 'if_match_required')
      const forged = await note(
        desk.cookie,
        'pr1',
        { text: NOTE, authorName: 'Sahte Yazar' },
        version,
      )
      assertError(forged, 400, 'validation_failed')
      assertError(await note(desk.cookie, 'pr1', { text: 'x' }, version), 400, 'validation_failed')
    })
    const added = await note(desk.cookie, 'pr1', { text: NOTE }, version)
    assert.equal(added.statusCode, 201, added.body)
    assert.equal(added.headers.location, '/api/v1/collections/prospects/pr1')
    const record = await findRecord(db, a.id, 'prospects', 'pr1')
    const notes = record?.data.notes as {
      text: string
      author: string
      by: unknown
      date: string
    }[]
    assert.equal(notes[0]?.text, NOTE)
    assert.equal(notes[0]?.author, 'Test Kullanıcı')
    assert.deepEqual(notes[0]?.by, { role: 'onburo', userId: desk.id })
    assert.equal(notes[0]?.date, FIXED_NOW.toISOString())
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'prospect.note')))
    assert.equal(audit.length, 1)
    assert.equal(JSON.stringify(audit).includes(NOTE), false)
    // Vazgeçen aday (pr5) kapalıdır.
    await unchanged(a.id, 'pr5', async () => {
      assertError(
        await note(desk.cookie, 'pr5', { text: NOTE }, await versionOf(a.id, 'pr5')),
        409,
        'prospect_closed',
      )
    })
  })

  test('DOM-KAY-032: oturum kullanıcısı bulunamazsa not boş yazarla yazılmaz; düz hata fırlar (500), kayıt değişmez', async () => {
    const a = await institution()
    const desk = await member(a.id, 'onburo')
    const ghost: ServiceContext = {
      db,
      institutionId: a.id,
      actor: { userId: 'test-user-yok', role: 'onburo', membershipId: desk.membershipId },
      now: FIXED_NOW,
      log: app.log,
    }
    const version = await versionOf(a.id, 'pr1')
    await unchanged(a.id, 'pr1', async () => {
      const reason = await addProspectNoteCommand(
        ghost,
        'pr1',
        { text: NOTE },
        { idempotency: null, expectedVersion: version },
      ).then(
        () => null,
        (error: unknown) => error,
      )
      // AppError olmayan düz Error: hata işleyicisi 500 internal_error'a çevirir, ayrıntı logda kalır.
      assert.ok(reason instanceof Error, String(reason))
      assert.equal(reason instanceof AppError, false)
    })
    const record = await findRecord(db, a.id, 'prospects', 'pr1')
    assert.equal((record?.data.notes as unknown[]).length, 1)
  })

  // --- Görüşme -----------------------------------------------------------------------------------

  test('DOM-KAY-033: görüşme planlanır ve aşama Görüşme planlandı olur; aynı oda çakışması 409, geçmiş an 422', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    const planned = await meeting(cookie, 'pr1', { ...MEETING, teacherId: 't1' }, version)
    assert.equal(planned.statusCode, 200, planned.body)
    const record = await findRecord(db, a.id, 'prospects', 'pr1')
    assert.equal(record?.data.stage, 'Görüşme planlandı')
    assert.equal(record?.data.trialAt, SATURDAY)
    assert.equal((record?.data.meeting as { teacherId: string }).teacherId, 't1')
    // pr4 de b1'dedir: aynı odada 10:30 (45 dk'lık görüşmeyle örtüşür) 409.
    const other = await versionOf(a.id, 'pr4')
    await unchanged(a.id, 'pr4', async () => {
      const clash = await meeting(
        cookie,
        'pr4',
        { ...MEETING, date: '2026-10-10T10:30:00.000Z', room: 'görüşme ODASI' },
        other,
      )
      assertError(clash, 409, 'meeting_conflict')
      assert.deepEqual(clash.json().issues[0].path, ['date'])
      assertError(
        await meeting(cookie, 'pr4', { ...MEETING, room: 'Oda 2', teacherId: 't1' }, other),
        409,
        'meeting_conflict',
      )
      assertError(
        await meeting(cookie, 'pr4', { ...MEETING, date: '2026-10-05T10:00:00.000Z' }, other),
        422,
        'meeting_in_past',
      )
      assertError(
        await meeting(cookie, 'pr4', { ...MEETING, duration: 5 }, other),
        400,
        'validation_failed',
      )
    })
    // Başka odada ve öğretmensiz aynı saat serbesttir; Teklif verildi aşaması geri gitmez.
    const free = await meeting(cookie, 'pr4', { ...MEETING, room: 'Oda 2' }, other)
    assert.equal(free.statusCode, 200, free.body)
    assert.equal((await findRecord(db, a.id, 'prospects', 'pr4'))?.data.stage, 'Teklif verildi')
  })

  // --- Deneme dersi --------------------------------------------------------------------------------

  test('DOM-DIL-030: okul kurumunda deneme dersi ucu her rol için 404; aday değişmez', async () => {
    const a = await institution()
    await unchanged(a.id, 'pr1', async () => {
      const version = await versionOf(a.id, 'pr1')
      const cookies = [
        a.adminCookie,
        await frontDesk(a.id),
        (await member(a.id, 'ogretmen')).cookie,
        (await member(a.id, 'veli')).cookie,
      ]
      for (const cookie of cookies)
        assertError(
          await trial(cookie, 'pr1', { lessonId: LESSON?.id, guardianConsent: true }, version),
          404,
          'not_found',
        )
    })
  })

  test('DOM-DIL-030, DOM-KAY-034: dil okulunda deneme dersi veli onayıyla planlanır; onaysız 422, yetkisiz rol 403', async () => {
    const a = await institution({ type: 'language_school' })
    const cookie = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    const body = { lessonId: LESSON?.id, guardianConsent: true }
    await unchanged(a.id, 'pr1', async () => {
      // Seed adayının veli adı yoktur; yeni aday veli adıyla açılır.
      assertError(await trial(cookie, 'pr1', body, version), 422, 'trial_guardian_contact_required')
      assertError(await trial(cookie, 'pr1', body, null), 400, 'if_match_required')
      assertError(
        await trial((await member(a.id, 'veli')).cookie, 'pr1', body, version),
        403,
        'forbidden',
      )
    })
    const child = await created(cookie, {
      ...PROSPECT,
      minor: true,
      interest: 'B1 · Genel İngilizce',
    })
    await unchanged(a.id, child.id, async () => {
      const noConsent = await trial(cookie, child.id, { lessonId: LESSON?.id }, child.version)
      assertError(noConsent, 422, 'trial_guardian_consent_required')
      assert.deepEqual(noConsent.json().issues[0].path, ['guardianConsent'])
      assertError(
        await trial(
          cookie,
          child.id,
          { lessonId: 'lesson-yok', guardianConsent: true },
          child.version,
        ),
        404,
        'not_found',
      )
    })
    const planned = await trial(cookie, child.id, body, child.version)
    assert.equal(planned.statusCode, 200, planned.body)
    const record = await findRecord(db, a.id, 'prospects', child.id)
    assert.equal(record?.data.stage, 'Görüşme planlandı')
    const lesson = record?.data.trialLesson as { lessonId: string; guardianConsentAt: string }
    assert.equal(lesson.lessonId, LESSON?.id)
    assert.equal(lesson.guardianConsentAt, FIXED_NOW.toISOString())
    // Deneme kaydı yoklamaya yazılmaz.
    assert.equal((await loadRecords(db, a.id, ['attendance'])).length, 0)
  })

  test('DOM-DIL-030, DOM-KAY-034: deneme dersi dolu, kullanılmış ya da kampüs dışı grup derste 409/422; aday değişmez', async () => {
    const group = SEED.classes.find((item) => item.id === 'c1')
    assert.ok(LESSON && group)
    const pastDate = '2026-10-05T09:10:00.000Z'
    const a = await institution(
      { type: 'language_school' },
      withRecords({
        classes: [{ ...group, id: 'test-c-b2', branchId: 'b2' }],
        schedule: [
          { ...LESSON, id: 'test-lesson-past', date: pastDate },
          { ...LESSON, id: 'test-lesson-b2', classId: 'test-c-b2' },
        ],
        prospects: [
          {
            ...PR1,
            id: 'test-pr-used',
            trialLesson: {
              lessonId: 'test-lesson-past',
              classId: 'c1',
              date: pastDate,
              duration: LESSON.duration,
              guardianConsentAt: pastDate,
              scheduledAt: pastDate,
              by: { role: 'onburo', userId: 'test-user' },
            },
          },
        ],
      }),
    )
    const cookie = await frontDesk(a.id)
    const body = { lessonId: LESSON.id, guardianConsent: true }
    const people = []
    for (const [index, name] of ['Test Bir', 'Test İki', 'Test Üç'].entries())
      people.push(
        await created(cookie, {
          ...PROSPECT,
          name,
          phone: `0555999020${String(index)}`,
          email: '',
          minor: true,
          interest: 'B1 · Genel İngilizce',
        }),
      )
    const [first, second, third] = people
    assert.ok(first && second && third)
    // Gerçekleşmiş deneme dersi olan aday ikinci kez planlayamaz.
    await unchanged(a.id, 'test-pr-used', async () => {
      assertError(
        await trial(cookie, 'test-pr-used', body, await versionOf(a.id, 'test-pr-used')),
        409,
        'trial_already_used',
      )
    })
    // Adayın kampüsü (b1) dışındaki grubun dersi.
    await unchanged(a.id, first.id, async () => {
      assertError(
        await trial(cookie, first.id, { ...body, lessonId: 'test-lesson-b2' }, first.version),
        422,
        'trial_group_unavailable',
      )
    })
    // Bir derse en fazla iki deneme katılımcısı: üçüncü aday 409, yazılmaz.
    for (const person of [first, second]) {
      const planned = await trial(cookie, person.id, body, person.version)
      assert.equal(planned.statusCode, 200, planned.body)
    }
    await unchanged(a.id, third.id, async () => {
      const full = await trial(cookie, third.id, body, third.version)
      assertError(full, 409, 'trial_lesson_full')
      assert.deepEqual(full.json().issues[0].path, ['lessonId'])
    })
    const filled = (await stored(a.id)).filter(
      (row) => (row.data.trialLesson as { lessonId?: string } | undefined)?.lessonId === LESSON.id,
    )
    assert.equal(filled.length, 2)
  })

  // --- Log ---------------------------------------------------------------------------------------

  test('DOM-KAY-002, DOM-KAY-032: telefon, e-posta, veli adı, not metni ve mükerrer adayın kimliği loga düşmez', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs, clock: () => FIXED_NOW })
    try {
      const first = await send('POST', '/api/v1/prospects', cookie, PROSPECT, key(), logged)
      assert.equal(first.statusCode, 201, first.body)
      const { entity, records } = first.json().data
      const duplicate = await send('POST', '/api/v1/prospects', cookie, PROSPECT, key(), logged)
      assertError(duplicate, 409, 'prospect_duplicate')
      const added = await send(
        'POST',
        `/api/v1/prospects/${entity.id}/notes`,
        cookie,
        { text: NOTE },
        ifMatch(records[0].version),
        logged,
      )
      assert.equal(added.statusCode, 201, added.body)
      const invalid = await send(
        'POST',
        '/api/v1/prospects',
        cookie,
        { ...PROSPECT, phone: 'gizli-telefon-05551112233' },
        key(),
        logged,
      )
      assertError(invalid, 400, 'validation_failed')
      const lines = logs.flatMap((line) => line.split('\n')).filter(Boolean)
      assert.ok(lines.some((line) => line.includes('"operation.applied"')))
      const text = lines.join('\n')
      for (const value of [PHONE, EMAIL, GUARDIAN, NOTE, 'gizli-telefon', PROSPECT.name])
        assert.equal(text.includes(value), false, `logda: ${value}`)
      // Mükerrer reddinde eşleşen adayın kimliği yalnız onu açan isteğin logunda olabilir.
      const rejectedLines = lines.filter((line) => line.includes(duplicate.json().requestId))
      assert.ok(rejectedLines.length > 0)
      for (const line of rejectedLines) assert.equal(line.includes(entity.id), false)
    } finally {
      await logged.close()
    }
  })

  test('DOM-KAY-007: aday listesi kaynak eşitlik süzgeciyle daraltılır; bilinmeyen kaynak boş döner', async () => {
    const a = await institution()
    const cookie = await frontDesk(a.id)
    const sources = SEED.prospects.slice(0, 5).map((item) => item.source)
    const expected = sources.filter((source) => source === sources[0]).length
    const list = (query: string) =>
      app.inject({
        method: 'GET',
        url: `/api/v1/collections/prospects?${query}`,
        headers: { origin: TEST_ORIGIN, cookie },
      })
    const matched = await list(`source=${encodeURIComponent(String(sources[0]))}`)
    assert.equal(matched.statusCode, 200, matched.body)
    assert.equal(matched.json().meta.total, expected)
    for (const item of matched.json().data) assert.equal(item.record.source, sources[0])
    const none = await list('source=Olmayan%20kaynak')
    assert.equal(none.statusCode, 200)
    assert.equal(none.json().meta.total, 0)
  })

  test('DOM-KAY-007: kaynak süzgeci ve groupBy=source başka kurumun adaylarını saymaz', async () => {
    const a = await institution()
    // B kurumunda aynı kaynaktan daha çok aday vardır (pr1…pr15: 'Web sitesi' 3 kez).
    const b = await institution(
      {},
      { ...SAMPLE, prospects: SEED.prospects.slice(0, 15) as Sample['prospects'] },
    )
    const cookieA = await frontDesk(a.id)
    const cookieB = await frontDesk(b.id)
    const source = String(SEED.prospects[0]?.source)
    const get = (url: string, cookie: string) =>
      app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })
    const listA = await get(
      `/api/v1/collections/prospects?source=${encodeURIComponent(source)}`,
      cookieA,
    )
    assert.equal(listA.statusCode, 200, listA.body)
    assert.equal(listA.json().meta.total, 1, 'A yalnız kendi adayını sayar')
    const listB = await get(
      `/api/v1/collections/prospects?source=${encodeURIComponent(source)}`,
      cookieB,
    )
    assert.equal(listB.json().meta.total, 3)
    const groupsA = await get('/api/v1/collections/prospects/counts?groupBy=source', cookieA)
    assert.equal(groupsA.statusCode, 200, groupsA.body)
    const countsA = Object.fromEntries(
      (groupsA.json().data as { value: string; count: number }[]).map((item) => [
        item.value,
        item.count,
      ]),
    )
    assert.equal(countsA[source], 1)
    assert.equal(
      Object.values(countsA).reduce((sum, count) => sum + count, 0),
      5,
    )
    const groupsB = await get('/api/v1/collections/prospects/counts?groupBy=source', cookieB)
    assert.equal(
      (groupsB.json().data as { value: string; count: number }[]).find(
        (item) => item.value === source,
      )?.count,
      3,
    )
  })

  // --- Kesin kayıt -------------------------------------------------------------------------------

  const TUITION = {
    kind: 'tuition',
    level: null,
    amountCents: 10_000_001,
    unit: 'year',
    vatBasisPoints: 1000,
    vatEffectiveDate: '2026-01-01',
    announcedAmountCents: 10_000_001,
  }
  const TC = '10000000146'
  const ENROLLMENT = {
    classId: 'c1',
    installmentCount: 3,
    firstDueDate: '2026-11-15',
    identity: { kind: 'tc', number: TC, birthDate: '2013-03-01' },
    guardian: { name: 'Test Kayıt Velisi', phone: '05559990009', relationship: 'mother' },
  }
  /** Eğitim yılının tarifesini yönetici yayımlar; kurum tarifesiz başlar (DOM-FIN-002). */
  async function publishTariff(
    cookie: string,
    tariff: { items?: unknown[]; discounts?: unknown[] } = {},
    unit = 'year',
  ) {
    const created = await send('POST', '/api/v1/fee-tariffs', cookie, {
      academicYear: FIXED_NOW.getUTCFullYear(),
      items: tariff.items ?? [{ ...TUITION, unit }],
      discounts: tariff.discounts ?? [],
    })
    assert.equal(created.statusCode, 201, created.body)
    const { id, version } = created.json().data
    tariffId = id
    const published = await send(
      'POST',
      `/api/v1/fee-tariffs/${String(id)}/publish`,
      cookie,
      { announcedDate: '2026-05-01', mebbisRecordedDate: null },
      ifMatch(version),
    )
    assert.equal(published.statusCode, 200, published.body)
  }
  async function publishTariffForYear(cookie: string, academicYear: number) {
    const draft = await send('POST', '/api/v1/fee-tariffs', cookie, {
      academicYear,
      items: [TUITION],
    })
    assert.equal(draft.statusCode, 201, draft.body)
    tariffId = draft.json().data.id
    const published = await send(
      'POST',
      `/api/v1/fee-tariffs/${String(draft.json().data.id)}/publish`,
      cookie,
      { announcedDate: '2026-05-01', mebbisRecordedDate: null },
      ifMatch(draft.json().data.version),
    )
    assert.equal(published.statusCode, 200, published.body)
  }
  async function pricedInstitution(
    overrides: Partial<InstitutionOverrides> = {},
    tariff: { items?: unknown[]; discounts?: unknown[] } = {},
    unit = 'year',
  ) {
    const created = await institution(overrides)
    await publishTariff(created.adminCookie, tariff, unit)
    return created
  }
  /** Son yayımlanan tarifenin kimliği; gövdede verilmeyen testler için. */
  let tariffId = '00000000-0000-4000-8000-000000000000'
  const enroll = (
    cookie: string | null,
    id: string,
    body: Record<string, unknown>,
    version: number | null,
    headers: Record<string, string> = key(),
  ) =>
    send(
      'POST',
      `/api/v1/prospects/${id}/enroll`,
      cookie,
      { tariffId, ...body },
      {
        ...ifMatch(version),
        ...headers,
      },
    )
  const enrollmentRows = async (institutionId: string) => ({
    parents: await loadRecords(db, institutionId, ['parents']),
    invoices: await loadRecords(db, institutionId, ['invoices']),
    contracts: await loadRecords(db, institutionId, ['contracts']),
    students: await loadRecords(db, institutionId, ['students']),
    identities: await db
      .select()
      .from(studentIdentities)
      .where(eq(studentIdentities.institutionId, institutionId)),
  })
  /** Reddedilen kesin kayıttan sonra aday değişmez, borç, öğrenci ve kimlik oluşmaz. */
  async function noEnrollment(institutionId: string, id: string, action: () => Promise<void>) {
    const before = await enrollmentRows(institutionId)
    await unchanged(institutionId, id, action)
    assert.deepEqual(await enrollmentRows(institutionId), before)
  }

  test('DOM-KAY-035: kesin kayıt oturumsuz 401, yetkisiz rol 403, modül kapalı 403; kayıt oluşmaz', async () => {
    assertError(await enroll(null, 'pr1', ENROLLMENT, 1), 401)
    const a = await pricedInstitution()
    await noEnrollment(a.id, 'pr1', async () => {
      for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
        const { cookie } = await member(a.id, role)
        assertError(await enroll(cookie, 'pr1', ENROLLMENT, 1), 403, 'forbidden')
      }
    })
    const closed = await institution({ type: 'language_school', enabledModules: { crm: false } })
    await noEnrollment(closed.id, 'pr1', async () => {
      assertError(await enroll(closed.adminCookie, 'pr1', ENROLLMENT, 1), 403, 'module_disabled')
    })
  })

  test('DOM-FIN-002: yayımlanmış tarife yoksa kesin kayıt 422; yalnız taslak yetmez', async () => {
    const a = await institution()
    const version = await versionOf(a.id, 'pr1')
    await noEnrollment(a.id, 'pr1', async () => {
      assertError(
        await enroll(a.adminCookie, 'pr1', ENROLLMENT, version),
        422,
        'tariff_not_published',
      )
    })
    const draft = await send('POST', '/api/v1/fee-tariffs', a.adminCookie, {
      academicYear: FIXED_NOW.getUTCFullYear(),
      items: [TUITION],
    })
    assert.equal(draft.statusCode, 201, draft.body)
    await noEnrollment(a.id, 'pr1', async () => {
      assertError(
        await enroll(a.adminCookie, 'pr1', ENROLLMENT, version),
        422,
        'tariff_not_published',
      )
    })
  })

  test('DOM-KAY-001, DOM-FIN-010, DOM-FIN-011, DOM-FIN-012: ön büro kesin kayıt yapar; tutar tarifeden, taksit toplamı nete eşit', async () => {
    const a = await pricedInstitution()
    const cookie = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    const response = await enroll(cookie, 'pr1', ENROLLMENT, version)
    assert.equal(response.statusCode, 201, response.body)
    const studentId = response.json().data.entity.id as string
    assert.equal(response.json().data.entity.collection, 'students')
    assert.equal(response.headers.location, `/api/v1/collections/students/${studentId}`)
    assert.equal(response.body.includes(TC), false)

    const prospect = await findRecord(db, a.id, 'prospects', 'pr1')
    assert.equal(prospect?.data.stage, 'Kayıt oldu')
    assert.equal(prospect?.data.studentId, studentId)
    const student = await findRecord(db, a.id, 'students', studentId)
    assert.equal(student?.data.classId, 'c1')

    const { invoices, contracts, parents } = await enrollmentRows(a.id)
    const mine = invoices.filter((row) => row.data.studentId === studentId)
    assert.equal(mine.length, 3)
    assert.equal(
      mine.reduce((sum, row) => sum + Number(row.data.amount), 0),
      TUITION.amountCents,
    )
    const contract = contracts.find((row) => row.data.studentId === studentId)
    assert.equal(contract?.data.amount, TUITION.amountCents)
    assert.equal(contract?.data.grossCents, TUITION.amountCents)
    assert.equal(contract?.data.tariffVersion, 1)
    assert.equal(contract?.data.title, 'Özel okul eğitim sözleşmesi')
    assert.deepEqual(
      contract?.data.invoiceIds,
      mine.map((row) => row.id),
    )
    const parent = parents.find((row) => row.id === student?.data.parentId)
    assert.equal(parent?.data.name, ENROLLMENT.guardian.name)
    assert.equal(parent?.data.relationship, 'mother')
    // Veli–öğrenci bağı aynı işlemde yazılır: velayet sahibi ve ödeyici, hesapsız (DOM-ILT-070, -074).
    const links = await loadStudentGuardians(db, a.id, studentId)
    assert.deepEqual(links.map(bondOf), [
      {
        parentId: parent?.id,
        membershipId: null,
        relationship: 'mother',
        custody: 'full',
        contactRestricted: false,
        isPayer: true,
        canPickUp: false,
      },
    ])
    const linkAudit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'guardian.link')))
    assert.equal(linkAudit.length, 1)
    assert.equal(linkAudit[0]?.entityId, links[0]?.id)
    assert.equal(JSON.stringify(linkAudit[0]).includes(String(prospect?.data.phone)), false)

    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'prospect.enroll')))
    assert.equal(audit.length, 1)
    assert.equal(audit[0]?.entityId, studentId)
    const text = JSON.stringify(audit[0])
    assert.equal(text.includes(String(prospect?.data.phone)), false)
    assert.equal(text.includes(TC), false)
  })

  test('DOM-KAY-012, DOM-YTK-020: kimlik genel okumada yok; yalnız personele maskeli döner', async () => {
    const a = await pricedInstitution()
    const response = await enroll(a.adminCookie, 'pr1', ENROLLMENT, await versionOf(a.id, 'pr1'))
    assert.equal(response.statusCode, 201, response.body)
    const studentId = response.json().data.entity.id as string

    const stored = await findRecord(db, a.id, 'students', studentId)
    assert.equal(JSON.stringify(stored?.data).includes(TC), false)
    const read = await a_get(a.adminCookie, `/api/v1/collections/students/${studentId}`)
    assert.equal(read.statusCode, 200, read.body)
    assert.equal(read.body.includes(TC), false)

    const url = `/api/v1/students/${studentId}/identity`
    const identity = await a_get(await frontDesk(a.id), url)
    assert.equal(identity.statusCode, 200, identity.body)
    assert.equal(identity.json().data.maskedNumber, '*******0146')
    assert.equal(identity.json().data.birthDate, '2013-03-01')
    assert.equal(identity.body.includes(TC), false)
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const)
      assertError(await a_get((await member(a.id, role)).cookie, url), 403, 'forbidden')
    assertError(await a_get(null, url), 401)
    const b = await institution()
    assertError(await a_get(b.adminCookie, url), 404)
  })

  test('DOM-KAY-011: aynı kimlikle ikinci aday aynı yıl kayda alınamaz (409), yanıt kimlik taşımaz', async () => {
    const a = await pricedInstitution()
    const cookie = await frontDesk(a.id)
    const first = await enroll(cookie, 'pr1', ENROLLMENT, await versionOf(a.id, 'pr1'))
    assert.equal(first.statusCode, 201, first.body)
    const { id, version } = await created(cookie)
    await noEnrollment(a.id, id, async () => {
      const second = await enroll(cookie, id, ENROLLMENT, version)
      assertError(second, 409, 'student_identity_duplicate')
      assert.equal(second.body.includes(TC), false)
    })
  })

  test('DOM-FIN-020, DOM-FIN-021: indirim ilan ücretinden düşer; ilansız ve tavanı aşan reddedilir', async () => {
    const a = await pricedInstitution(
      {},
      {
        items: [{ ...TUITION, amountCents: 20_000_000, announcedAmountCents: 20_000_000 }],
        discounts: [
          { kind: 'early_payment', percentBasisPoints: 1_000, amountCents: null },
          { kind: 'corporate', percentBasisPoints: 4_500, amountCents: null },
        ],
      },
    )
    const cookie = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    await noEnrollment(a.id, 'pr1', async () => {
      assertError(
        await enroll(cookie, 'pr1', { ...ENROLLMENT, discounts: ['referral'] }, version),
        422,
        'discount_not_in_tariff',
      )
      assertError(
        await enroll(
          cookie,
          'pr1',
          { ...ENROLLMENT, discounts: ['early_payment', 'corporate'] },
          version,
        ),
        422,
        'discount_cap_exceeded',
      )
    })
    const done = await enroll(
      cookie,
      'pr1',
      { ...ENROLLMENT, discounts: ['early_payment'] },
      version,
    )
    assert.equal(done.statusCode, 201, done.body)
    const { contracts } = await enrollmentRows(a.id)
    const contract = contracts.at(-1)
    assert.equal(contract?.data.grossCents, 20_000_000)
    assert.equal(contract?.data.netCents, 18_000_000)
    assert.deepEqual(contract?.data.discounts, [{ kind: 'early_payment', amountCents: 2_000_000 }])
  })

  test('DOM-FIN-003: ek hizmet ayrı borç kalemidir', async () => {
    const meal = {
      ...TUITION,
      kind: 'meal',
      amountCents: 1_000_000,
      announcedAmountCents: null,
    }
    const a = await pricedInstitution({}, { items: [TUITION, meal] })
    const done = await enroll(
      a.adminCookie,
      'pr1',
      { ...ENROLLMENT, extras: ['meal'] },
      await versionOf(a.id, 'pr1'),
    )
    assert.equal(done.statusCode, 201, done.body)
    const { invoices, contracts } = await enrollmentRows(a.id)
    const extra = invoices.find((row) => row.data.feeKind === 'meal')
    assert.equal(extra?.data.amount, 1_000_000)
    assert.equal(contracts.at(-1)?.data.amount, TUITION.amountCents + 1_000_000)
  })

  test('DOM-KAY-013, DOM-FIN-022: mevcut veli önerilir ve bağlanır; kardeş indirimi uygulanır', async () => {
    const a = await pricedInstitution(
      {},
      { discounts: [{ kind: 'sibling', percentBasisPoints: 1_000, amountCents: null }] },
    )
    const cookie = await frontDesk(a.id)
    const phone = String((await findRecord(db, a.id, 'prospects', 'pr1'))?.data.phone)
    const sibling = await created(cookie, {
      ...PROSPECT,
      name: 'Test Kardeş',
      phone,
      email: '',
      siblingOfId: 'pr1',
    })
    const first = await enroll(cookie, 'pr1', ENROLLMENT, await versionOf(a.id, 'pr1'))
    assert.equal(first.statusCode, 201, first.body)
    const elder = await findRecord(db, a.id, 'students', first.json().data.entity.id)
    const parentId = String(elder?.data.parentId)
    const matches = await a_get(cookie, `/api/v1/prospects/${sibling.id}/guardian-matches`)
    assert.equal(matches.statusCode, 200, matches.body)
    assert.deepEqual(
      matches.json().data.map((item: { parentId: string }) => item.parentId),
      [parentId],
    )
    assert.equal(matches.body.includes(phone), false)

    const parentsBefore = (await enrollmentRows(a.id)).parents.length
    const body = {
      ...ENROLLMENT,
      identity: { ...ENROLLMENT.identity, number: '11111111110' },
      guardian: { existingParentId: parentId },
      discounts: ['sibling'],
    }
    const second = await enroll(cookie, sibling.id, body, sibling.version)
    assert.equal(second.statusCode, 201, second.body)
    const { parents, contracts } = await enrollmentRows(a.id)
    assert.equal(parents.length, parentsBefore)
    assert.equal(
      (parents.find((row) => row.id === parentId)?.data.studentIds as string[]).length,
      2,
    )
    assert.deepEqual(contracts.at(-1)?.data.discounts, [
      { kind: 'sibling', amountCents: Math.floor(TUITION.amountCents / 10) },
    ])
    // Kardeşin bağı aynı veli kaydına yazılır; her öğrencinin kendi ödeyicisi vardır (DOM-ILT-074).
    for (const studentId of [elder?.id, second.json().data.entity.id as string]) {
      const links = await loadStudentGuardians(db, a.id, String(studentId))
      assert.equal(links.length, 1)
      assert.equal(links[0]?.parentId, parentId)
      assert.equal(links[0]?.isPayer, true)
      assert.equal(links[0]?.custody, 'full')
    }
    assertError(await a_get(cookie, '/api/v1/prospects/yok/guardian-matches'), 404)
    assertError(
      await a_get((await member(a.id, 'veli')).cookie, `/api/v1/prospects/pr2/guardian-matches`),
      403,
    )
  })

  test('DOM-FIN-010: form açıkken tarife değiştiyse 409 tariff_changed; kayıt yazılmaz', async () => {
    const a = await pricedInstitution()
    const version = await versionOf(a.id, 'pr1')
    await noEnrollment(a.id, 'pr1', async () => {
      assertError(
        await enroll(
          a.adminCookie,
          'pr1',
          { ...ENROLLMENT, tariffId: crypto.randomUUID() },
          version,
        ),
        409,
        'tariff_changed',
      )
    })
  })

  test('DOM-FIN-031: aynı Idempotency-Key ikinci borç açmaz, ilk yanıtı döner', async () => {
    const a = await pricedInstitution()
    const cookie = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    const headers = key()
    const first = await enroll(cookie, 'pr1', ENROLLMENT, version, headers)
    assert.equal(first.statusCode, 201, first.body)
    const counts = await enrollmentRows(a.id)
    const second = await enroll(cookie, 'pr1', ENROLLMENT, version, headers)
    assert.equal(second.statusCode, 201, second.body)
    assert.deepEqual(second.json().data, first.json().data)
    assert.deepEqual(await enrollmentRows(a.id), counts)
  })

  test('DOM-KAY-035: kayıtlı ve vazgeçmiş aday 409; dolu sınıf 422', async () => {
    const a = await pricedInstitution()
    const cookie = await frontDesk(a.id)
    const first = await enroll(cookie, 'pr1', ENROLLMENT, await versionOf(a.id, 'pr1'))
    assert.equal(first.statusCode, 201, first.body)
    const other = { ...ENROLLMENT, identity: { ...ENROLLMENT.identity, number: '11111111110' } }
    const version = await versionOf(a.id, 'pr1')
    await noEnrollment(a.id, 'pr1', async () => {
      assertError(await enroll(cookie, 'pr1', other, version), 409, 'prospect_already_enrolled')
    })
    const pr5 = await versionOf(a.id, 'pr5')
    await noEnrollment(a.id, 'pr5', async () => {
      assertError(await enroll(cookie, 'pr5', other, pr5), 409, 'prospect_closed')
    })

    const students = SAMPLE.students ?? []
    const full = SAMPLE.classes?.map((item) => ({ ...item, capacity: students.length }))
    const b = await institution({}, { ...SAMPLE, classes: full ?? [] })
    await publishTariff(b.adminCookie)
    const fullVersion = await versionOf(b.id, 'pr1')
    await noEnrollment(b.id, 'pr1', async () => {
      assertError(
        await enroll(b.adminCookie, 'pr1', ENROLLMENT, fullVersion),
        422,
        'class_capacity_full',
      )
    })
  })

  test('DOM-KAY-012: başlıklar ve gövde doğrulanır; geçersiz kimlik, serbest tutar, eski yakınlık değeri ve bilinmeyen alan 400', async () => {
    const a = await pricedInstitution()
    const cookie = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    await noEnrollment(a.id, 'pr1', async () => {
      assertError(await enroll(cookie, 'pr1', ENROLLMENT, null), 400, 'if_match_required')
      assertError(
        await enroll(cookie, 'pr1', ENROLLMENT, version, {}),
        400,
        'idempotency_key_required',
      )
      assertError(await enroll(cookie, 'pr1', ENROLLMENT, version + 1), 409, 'version_conflict')
      for (const body of [
        { ...ENROLLMENT, institutionId: 'baska' },
        { ...ENROLLMENT, totalCents: 10_000 },
        { ...ENROLLMENT, installmentCount: 13 },
        { ...ENROLLMENT, firstDueDate: '2026-02-30' },
        { ...ENROLLMENT, identity: { ...ENROLLMENT.identity, number: '10000000147' } },
        { ...ENROLLMENT, guardian: { name: 'X', phone: '1', relationship: 'mother' } },
        // Yasal vasi `legal_guardian`'dır; ödeyici adı `guardian` yakınlık değildir.
        { ...ENROLLMENT, guardian: { ...ENROLLMENT.guardian, relationship: 'guardian' } },
        { ...ENROLLMENT, discounts: ['serbest'] },
      ])
        assertError(await enroll(cookie, 'pr1', body, version), 400, 'validation_failed')
      assertError(
        await enroll(cookie, 'pr1', { ...ENROLLMENT, guardian: null }, version),
        422,
        'guardian_required',
      )
    })
  })

  test('class_campus_mismatch: başka kampüsün sınıfı açık onaysız 422 (classId); allowOtherCampus ile 201', async () => {
    const otherClass = SEED.classes.find(
      (item) => item.branchId !== PR1?.branchId && item.grade === 7,
    )
    assert.ok(otherClass)
    const a = await institution({}, withRecords({ classes: [otherClass] }))
    await publishTariff(a.adminCookie)
    const cookie = await frontDesk(a.id)
    const body = { ...ENROLLMENT, classId: otherClass.id }
    const version = await versionOf(a.id, 'pr1')
    for (const consent of [{}, { allowOtherCampus: false }]) {
      await noEnrollment(a.id, 'pr1', async () => {
        const refused = await enroll(cookie, 'pr1', { ...body, ...consent }, version)
        assertError(refused, 422, 'class_campus_mismatch')
        assert.deepEqual(refused.json().issues?.[0]?.path, ['classId'])
      })
    }
    const accepted = await enroll(cookie, 'pr1', { ...body, allowOtherCampus: true }, version)
    assert.equal(accepted.statusCode, 201, accepted.body)
    const students = await loadRecords(db, a.id, ['students'])
    const student = students.find((row) => row.data.classId === otherClass.id)
    assert.ok(student, 'öğrenci başka kampüsün sınıfına yazılır')
  })

  test('DOM-YTK-001: başka kurumun adayı ve sınıfı 404; öteki kurum değişmez', async () => {
    const a = await pricedInstitution()
    const b = await institution()
    const cookie = await frontDesk(a.id)
    const { id } = await created(b.adminCookie)
    await noEnrollment(b.id, id, async () => {
      assertError(await enroll(cookie, id, ENROLLMENT, 1), 404, 'not_found')
    })
    const version = await versionOf(a.id, 'pr1')
    await noEnrollment(a.id, 'pr1', async () => {
      assertError(
        await enroll(cookie, 'pr1', { ...ENROLLMENT, classId: 'yok' }, version),
        404,
        'not_found',
      )
    })
  })

  test('DOM-FIN-006, DOM-KAY-012: dil okulunda saat paketi; 18 yaş üstü kursiyer ödeyicidir', async () => {
    const a = await pricedInstitution(
      { type: 'language_school' },
      {
        items: [
          { ...TUITION, unit: 'lesson_hour', amountCents: 50_000, announcedAmountCents: null },
        ],
      },
    )
    const cookie = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    const adult = {
      ...ENROLLMENT,
      identity: { ...ENROLLMENT.identity, birthDate: '2000-01-01' },
      guardian: null,
    }
    await noEnrollment(a.id, 'pr1', async () => {
      assertError(await enroll(cookie, 'pr1', adult, version), 422, 'lesson_hours_required')
    })
    const done = await enroll(cookie, 'pr1', { ...adult, lessonHours: 40 }, version)
    assert.equal(done.statusCode, 201, done.body)
    const contract = (await enrollmentRows(a.id)).contracts.at(-1)
    assert.equal(contract?.data.title, 'Dil kursu eğitim sözleşmesi')
    assert.equal(contract?.data.grossCents, 2_000_000)
    assert.equal(contract?.data.payer, 'student')
    // Yetişkin kursiyerin kendisi veli değildir: veli bağı yazılmaz (DOM-YTK-030).
    const studentId = done.json().data.entity.id as string
    assert.deepEqual(await loadStudentGuardians(db, a.id, studentId), [])
    const linkAudit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'guardian.link')))
    assert.equal(linkAudit.length, 0)
  })

  test('DOM-KAY-012: dil okulunda yetişkin kursiyere veli verilmez (422); yaş grubu seçimiyle uyuşmayan doğum tarihi 422', async () => {
    const a = await pricedInstitution(
      { type: 'language_school' },
      {
        items: [
          { ...TUITION, unit: 'lesson_hour', amountCents: 50_000, announcedAmountCents: null },
        ],
      },
    )
    const cookie = await frontDesk(a.id)
    const adult = {
      ...ENROLLMENT,
      lessonHours: 10,
      identity: { ...ENROLLMENT.identity, birthDate: '2000-01-01' },
    }
    const version = await versionOf(a.id, 'pr1')
    await noEnrollment(a.id, 'pr1', async () => {
      const refused = await enroll(cookie, 'pr1', adult, version)
      assertError(refused, 422, 'guardian_not_applicable')
      assert.deepEqual(refused.json().issues?.[0]?.path, ['guardian'])
    })
    // Ön büro adayı 18 yaş altı olarak açtı; yetişkin doğum tarihi uyuşmaz.
    const minor = await created(cookie, { ...PROSPECT, name: 'Test Küçük Kursiyer', minor: true })
    await noEnrollment(a.id, minor.id, async () => {
      const mismatch = await enroll(cookie, minor.id, { ...adult, guardian: null }, minor.version)
      assertError(mismatch, 422, 'birth_date_minor_mismatch')
      assert.deepEqual(mismatch.json().issues?.[0]?.path, ['identity', 'birthDate'])
    })
    const done = await enroll(cookie, minor.id, { ...ENROLLMENT, lessonHours: 10 }, minor.version)
    assert.equal(done.statusCode, 201, done.body)
    assert.equal((await enrollmentRows(a.id)).contracts.at(-1)?.data.payer, 'guardian')
  })

  test('DOM-KAY-013, parent_not_guardian: yetişkin kursiyerin kendi satırı kardeşe önerilmez; seçilirse 422 ve kayıt yazılmaz', async () => {
    const a = await pricedInstitution(
      { type: 'language_school' },
      {
        items: [
          { ...TUITION, unit: 'lesson_hour', amountCents: 50_000, announcedAmountCents: null },
        ],
      },
    )
    const cookie = await frontDesk(a.id)
    const adultProspect: Record<string, unknown> = {
      ...PROSPECT,
      name: 'Test Yetişkin',
      minor: false,
    }
    delete adultProspect.guardianName
    const adult = await created(cookie, adultProspect)
    const young = await created(cookie, {
      ...PROSPECT,
      name: 'Test Küçük Kardeş',
      email: '',
      minor: true,
      siblingOfId: adult.id,
    })
    const grown = await enroll(
      cookie,
      adult.id,
      {
        ...ENROLLMENT,
        lessonHours: 10,
        identity: { ...ENROLLMENT.identity, birthDate: '2000-01-01' },
        guardian: null,
      },
      adult.version,
    )
    assert.equal(grown.statusCode, 201, grown.body)
    const student = await findRecord(db, a.id, 'students', grown.json().data.entity.id)
    const selfId = String(student?.data.parentId)
    assert.equal((await findRecord(db, a.id, 'parents', selfId))?.data.relationship, 'self')

    const matches = await a_get(cookie, `/api/v1/prospects/${young.id}/guardian-matches`)
    assert.equal(matches.statusCode, 200, matches.body)
    assert.deepEqual(matches.json().data, [])
    await noEnrollment(a.id, young.id, async () => {
      const refused = await enroll(
        cookie,
        young.id,
        {
          ...ENROLLMENT,
          lessonHours: 10,
          identity: { ...ENROLLMENT.identity, number: '11111111110' },
          guardian: { existingParentId: selfId },
        },
        young.version,
      )
      assertError(refused, 422, 'parent_not_guardian')
      assert.deepEqual(refused.json().issues?.[0]?.path, ['guardian'])
    })
  })

  test('DOM-KAY-012, DOM-KAY-003: okulda 18 yaşını doldurmuş öğrencide veli zorunlu; iletişim velide kalır, öğrencinin kendi iletişimi isteğe bağlıdır', async () => {
    const a = await pricedInstitution()
    const cookie = await frontDesk(a.id)
    const adult = { ...ENROLLMENT, identity: { ...ENROLLMENT.identity, birthDate: '2000-01-01' } }
    const version = await versionOf(a.id, 'pr1')
    await noEnrollment(a.id, 'pr1', async () => {
      const refused = await enroll(cookie, 'pr1', { ...adult, guardian: null }, version)
      assertError(refused, 422, 'guardian_required')
      assert.deepEqual(refused.json().issues?.[0]?.path, ['guardian'])
    })
    await noEnrollment(a.id, 'pr1', async () => {
      const invalid = await enroll(
        cookie,
        'pr1',
        { ...adult, studentContact: { phone: '123' } },
        version,
      )
      assert.equal(invalid.statusCode, 400, invalid.body)
    })
    const studentContact = { phone: '05551234567', email: 'test-ogrenci@kampus.example' }
    const done = await enroll(cookie, 'pr1', { ...adult, studentContact }, version)
    assert.equal(done.statusCode, 201, done.body)
    const student = await findRecord(db, a.id, 'students', done.json().data.entity.id)
    assert.equal(student?.data.phone, studentContact.phone)
    assert.equal(student?.data.email, studentContact.email)
    const parent = await findRecord(db, a.id, 'parents', String(student?.data.parentId))
    assert.equal(parent?.data.email, PR1?.email)
    assert.equal(parent?.data.phone, ENROLLMENT.guardian.phone)
    const contract = (await enrollmentRows(a.id)).contracts.at(-1)
    assert.equal(contract?.data.payer, 'guardian')
  })

  test('DOM-YTK-040: crm modülü kapalıyken kimlik özeti 403 module_disabled', async () => {
    const closed = await institution({ enabledModules: { crm: false } })
    assertError(
      await a_get(closed.adminCookie, '/api/v1/students/s1/identity'),
      403,
      'module_disabled',
    )
  })

  test('DOM-KAY-003: 18 yaş altında iletişim veliye yazılır, öğrenciye yazılmaz; mevcut velinin eksiği tamamlanır, öğretmen veli e-postasını görmez', async () => {
    const existing = {
      id: 'test-veli-mevcut',
      name: 'Test Mevcut Veli',
      studentIds: ['s1'],
      phone: '05551234567',
    }
    const a = await institution({}, withRecords({ parents: [existing] }))
    await publishTariff(a.adminCookie)
    const cookie = await frontDesk(a.id)
    const prospect = await findRecord(db, a.id, 'prospects', 'pr1')
    const done = await enroll(
      cookie,
      'pr1',
      { ...ENROLLMENT, guardian: { existingParentId: existing.id } },
      await versionOf(a.id, 'pr1'),
    )
    assert.equal(done.statusCode, 201, done.body)
    const student = await findRecord(db, a.id, 'students', String(done.json().data.entity.id))
    assert.equal(student?.data.email, '')
    assert.equal(student?.data.phone, '')
    const parent = await findRecord(db, a.id, 'parents', existing.id)
    // Var olan telefon ve ad değişmez; eksik e-posta adayınkiyle tamamlanır.
    assert.equal(parent?.data.phone, existing.phone)
    assert.equal(parent?.data.name, existing.name)
    assert.equal(parent?.data.email, prospect?.data.email)

    // Yeni veliye adayın e-postası yazılır; telefon formdan gelir.
    const b = await pricedInstitution()
    const created = await enroll(
      await frontDesk(b.id),
      'pr1',
      ENROLLMENT,
      await versionOf(b.id, 'pr1'),
    )
    assert.equal(created.statusCode, 201, created.body)
    const other = await findRecord(db, b.id, 'students', String(created.json().data.entity.id))
    const newParent = await findRecord(db, b.id, 'parents', String(other?.data.parentId))
    assert.equal(other?.data.email, '')
    assert.equal(newParent?.data.email, prospect?.data.email)
    assert.equal(newParent?.data.phone, ENROLLMENT.guardian.phone)

    const teacherView = await a_get(
      (await member(a.id, 'ogretmen')).cookie,
      `/api/v1/collections/parents/${existing.id}`,
    )
    assert.equal(teacherView.statusCode, 200, teacherView.body)
    assert.equal(teacherView.body.includes(String(prospect?.data.email)), false)
    assert.equal(teacherView.body.includes(existing.phone), false)
  })

  test('DOM-YTK-020: veli telefonu öğrenciye gitmez; yönetici ve velinin kendisi görür', async () => {
    const a = await pricedInstitution()
    const done = await enroll(a.adminCookie, 'pr1', ENROLLMENT, await versionOf(a.id, 'pr1'))
    assert.equal(done.statusCode, 201, done.body)
    const studentId = String(done.json().data.entity.id)
    const student = await findRecord(db, a.id, 'students', studentId)
    const url = `/api/v1/collections/parents/${String(student?.data.parentId)}`
    const phone = ENROLLMENT.guardian.phone

    const own = await signInAs(
      app,
      await createMember(app, a.id, 'ogrenci', [{ kind: 'student', recordId: studentId }]),
    )
    const hidden = await a_get(own, url)
    assert.equal(hidden.statusCode, 200, hidden.body)
    assert.equal(hidden.body.includes(phone), false)
    assert.equal(hidden.body.includes('mother'), false)

    const admin = await a_get(a.adminCookie, url)
    assert.equal(admin.statusCode, 200, admin.body)
    assert.equal(admin.body.includes(phone), true)
    const parent = await signInAs(
      app,
      await createMember(app, a.id, 'veli', [{ kind: 'child', recordId: studentId }]),
    )
    assert.equal((await a_get(parent, url)).body.includes(phone), true)
  })

  test('DOM-KAY-011: kimlik tekilliği yıla bağlı değildir; pasif kaydın kimliği yeniden kullanılır', async () => {
    const a = await pricedInstitution()
    const cookie = await frontDesk(a.id)
    const first = await enroll(cookie, 'pr1', ENROLLMENT, await versionOf(a.id, 'pr1'))
    assert.equal(first.statusCode, 201, first.body)
    const elderId = String(first.json().data.entity.id)

    // Eğitim yılı ilerlese de aynı kişi aktifken ikinci kayıt açılamaz.
    await db
      .update(institutionSettings)
      .set({ academicYear: FIXED_NOW.getUTCFullYear() + 1 })
      .where(eq(institutionSettings.institutionId, a.id))
    await publishTariffForYear(a.adminCookie, FIXED_NOW.getUTCFullYear() + 1)
    const next = await created(cookie)
    await noEnrollment(a.id, next.id, async () => {
      assertError(
        await enroll(cookie, next.id, ENROLLMENT, next.version),
        409,
        'student_identity_duplicate',
      )
    })

    // Öğrenci pasifleşince (mezuniyet) aynı kimlik yeniden kayıt olur, eski satır arşivlenir.
    const elder = await findRecord(db, a.id, 'students', elderId)
    await db
      .update(records)
      .set({ data: { ...elder?.data, isActive: false } })
      .where(
        and(
          eq(records.institutionId, a.id),
          eq(records.collection, 'students'),
          eq(records.id, elderId),
        ),
      )
    const again = await enroll(cookie, next.id, ENROLLMENT, next.version)
    assert.equal(again.statusCode, 201, again.body)
    const rows = await db
      .select({ studentId: studentIdentities.studentId, archivedAt: studentIdentities.archivedAt })
      .from(studentIdentities)
      .where(eq(studentIdentities.institutionId, a.id))
    assert.equal(rows.length, 2)
    assert.ok(rows.find((row) => row.studentId === elderId)?.archivedAt)
  })

  // --- Deneme dersi sonucu (DOM-DIL-031) -------------------------------------------------------

  /** Deneme dersi bitmiş sayılır: sunucu saati dersin bir saat sonrasıdır. */
  const AFTER_LESSON = () => new Date(Date.parse(LESSON?.date ?? '') + 3_600_000)

  /** Dil okulunda veli onaylı bir deneme dersi planlanmış aday ve dersten sonraki saatte bir uygulama. */
  async function plannedTrial() {
    const a = await institution({ type: 'language_school' })
    const front = await frontDesk(a.id)
    const child = await created(front, {
      ...PROSPECT,
      minor: true,
      interest: 'B1 · Genel İngilizce',
    })
    const planned = await trial(
      front,
      child.id,
      { lessonId: LESSON?.id, guardianConsent: true },
      child.version,
    )
    assert.equal(planned.statusCode, 200, planned.body)
    const later = await buildTestApp(db, { clock: AFTER_LESSON })
    return { a, front, child, later, version: await versionOf(a.id, child.id) }
  }

  test('DOM-DIL-031: öğretmen deneme sonucunu yazar; aşama değişmez, sürüm artar, denetimde not yok', async () => {
    const { a, child, later, version } = await plannedTrial()
    try {
      const teacher = (await member(a.id, 'ogretmen')).cookie
      const written = await trialResult(
        teacher,
        child.id,
        { fit: 'lower_level', note: 'Konuşmada alt kur daha rahat eder.' },
        version,
        later,
      )
      assert.equal(written.statusCode, 200, written.body)
      const record = await findRecord(db, a.id, 'prospects', child.id)
      assert.equal(record?.version, version + 1)
      assert.equal(record?.data.stage, 'Görüşme planlandı')
      const result = (record?.data.trialLesson as { result: Record<string, unknown> }).result
      assert.equal(result.fit, 'lower_level')
      assert.equal(result.note, 'Konuşmada alt kur daha rahat eder.')
      assert.equal(result.recordedAt, AFTER_LESSON().toISOString())
      assert.equal((result.by as { role: string }).role, 'ogretmen')
      // Öğrenci oluşmaz, yoklamaya yazılmaz.
      assert.equal((await loadRecords(db, a.id, ['attendance'])).length, 0)
      assert.equal((await loadRecords(db, a.id, ['students'])).length, SAMPLE.students?.length)
      // Denetim kaydı alan adını taşır, not metnini taşımaz (guvenlik-kvkk).
      const audit = await db.select().from(auditLog).where(eq(auditLog.institutionId, a.id))
      assert.ok(JSON.stringify(audit).includes('prospect.trialResult'))
      assert.ok(!JSON.stringify(audit).includes('Konuşmada alt kur'))
      // Sonuç yeniden yazılabilir; son karar geçerlidir.
      const again = await trialResult(teacher, child.id, { fit: 'suitable' }, version + 1, later)
      assert.equal(again.statusCode, 200, again.body)
      const final = await findRecord(db, a.id, 'prospects', child.id)
      const finalResult = (final?.data.trialLesson as { result: Record<string, unknown> }).result
      assert.equal(finalResult.fit, 'suitable')
      assert.equal(finalResult.note, null)
    } finally {
      await later.close()
    }
  })

  test('DOM-DIL-031: oturumsuz 401; öğretmen dışı roller 403; başlık, gövde ve ders zamanı denetlenir; aday değişmez', async () => {
    const { a, front, child, later, version } = await plannedTrial()
    try {
      const teacher = (await member(a.id, 'ogretmen')).cookie
      const good = { fit: 'suitable' }
      assertError(await trialResult(null, child.id, good, version, later), 401)
      await unchanged(a.id, child.id, async () => {
        for (const cookie of [
          a.adminCookie,
          front,
          (await member(a.id, 'ogrenci')).cookie,
          (await member(a.id, 'veli')).cookie,
        ])
          assertError(await trialResult(cookie, child.id, good, version, later), 403, 'forbidden')
        assertError(
          await trialResult(teacher, child.id, good, null, later),
          400,
          'if_match_required',
        )
        assertError(await trialResult(teacher, child.id, { fit: 'belki' }, version, later), 400)
        assertError(await trialResult(teacher, child.id, {}, version, later), 400)
        assertError(
          await trialResult(
            teacher,
            child.id,
            { fit: 'suitable', stage: 'Kayıt oldu' },
            version,
            later,
          ),
          400,
        )
        assertError(
          await trialResult(
            teacher,
            child.id,
            { fit: 'suitable', note: 'x'.repeat(501) },
            version,
            later,
          ),
          400,
        )
        assertError(await trialResult(teacher, child.id, good, version + 5, later), 409)
        // Ders henüz yapılmadı: sunucu saati dersten önce.
        assertError(await trialResult(teacher, child.id, good, version), 409, 'trial_not_held')
        // Denemesi olmayan aday öğretmene yok gibidir.
        assertError(await trialResult(teacher, 'pr1', good, 1, later), 404, 'not_found')
      })
    } finally {
      await later.close()
    }
  })

  test('DOM-DIL-031, DOM-YTK-001: kapsam dışı öğretmen, başka kurum, okul kurumu ve kapalı modülde 404/403; aday değişmez', async () => {
    const { a, child, later, version } = await plannedTrial()
    try {
      // Dersi vermeyen öğretmen: sınıf kapsamı yok, aday 404.
      const outsiderLink = SEED.teachers.find((item) => item.id !== 't1')
      assert.ok(outsiderLink)
      const outsider = await createMember(app, a.id, 'ogretmen', [
        { kind: 'teacher', recordId: outsiderLink.id },
      ])
      const outsiderCookie = await signInAs(app, outsider)
      await unchanged(a.id, child.id, async () => {
        assertError(
          await trialResult(outsiderCookie, child.id, { fit: 'suitable' }, version, later),
          404,
          'not_found',
        )
      })
      // Başka kurumun öğretmeni bu adayı bulamaz.
      const b = await institution({ type: 'language_school' })
      const foreign = (await member(b.id, 'ogretmen')).cookie
      await unchanged(a.id, child.id, async () => {
        assertError(
          await trialResult(foreign, child.id, { fit: 'suitable' }, version, later),
          404,
          'not_found',
        )
      })
      // Okul kurumunda uç her rol için 404'tür.
      const school = await institution()
      for (const role of ['yonetici', 'ogretmen'] as const) {
        const cookie =
          role === 'yonetici' ? school.adminCookie : (await member(school.id, role)).cookie
        assertError(
          await trialResult(cookie, 'pr1', { fit: 'suitable' }, 1, later),
          404,
          'not_found',
        )
      }
      // crm modülü kapalıyken 403.
      const closed = await institution({ type: 'language_school', enabledModules: { crm: false } })
      const closedTeacher = (await member(closed.id, 'ogretmen')).cookie
      assertError(
        await trialResult(closedTeacher, 'pr1', { fit: 'suitable' }, 1, later),
        403,
        'module_disabled',
      )
    } finally {
      await later.close()
    }
  })

  test('DOM-DIL-031, DOM-YTK-080: öğretmen adayı yalnız kendi deneme grubunda ve telefon, veli ve not olmadan okur', async () => {
    const { a, child } = await plannedTrial()
    const teacher = (await member(a.id, 'ogretmen')).cookie
    const listed = await a_get(teacher, '/api/v1/collections/prospects')
    assert.equal(listed.statusCode, 200, listed.body)
    const items = listed.json().data as { record: Record<string, unknown> }[]
    assert.deepEqual(
      items.map((item) => item.record.id),
      [child.id],
    )
    const record = items[0]?.record ?? {}
    for (const hidden of [
      'phone',
      'email',
      'guardianName',
      'notes',
      'source',
      'marketingConsent',
      'privacyNotice',
    ])
      assert.ok(!(hidden in record), `${hidden} öğretmene dönmemeli`)
    assert.ok('trialLesson' in record)
    // Yönetici adayı tüm alanlarıyla görür.
    const adminView = await a_get(a.adminCookie, `/api/v1/collections/prospects/${child.id}`)
    assert.equal(adminView.statusCode, 200, adminView.body)
    assert.ok('phone' in adminView.json().data.record)
    // Okul kurumunda öğretmen aday koleksiyonuna hiç erişemez (deneme dersi yoktur).
    const school = await institution()
    const schoolTeacher = (await member(school.id, 'ogretmen')).cookie
    assert.equal((await a_get(schoolTeacher, '/api/v1/collections/prospects')).statusCode, 403)
    assert.equal(
      (await a_get(schoolTeacher, '/api/v1/collections/prospects/counts?groupBy=stage')).statusCode,
      403,
    )
    // Denemesi olmayan aday öğretmene tek kayıt okumasında da 404.
    const hiddenOne = await a_get(teacher, '/api/v1/collections/prospects/pr1')
    assert.equal(hiddenOne.statusCode, 404, hiddenOne.body)
  })

  // --- Aşama geri alma (DOM-KAY-030) ------------------------------------------------------------

  test('DOM-KAY-030: yönetici gerekçeyle aşamayı geri alır; sürüm artar, gerekçe kartta, denetimde yok', async () => {
    const a = await institution()
    const version = await versionOf(a.id, 'pr4')
    const reason = 'Teklif yanlışlıkla işaretlendi.'
    const done = await stageRevert(
      a.adminCookie,
      'pr4',
      { stage: 'İletişime geçildi', reason },
      version,
    )
    assert.equal(done.statusCode, 200, done.body)
    const record = await findRecord(db, a.id, 'prospects', 'pr4')
    assert.equal(record?.version, version + 1)
    assert.equal(record?.data.stage, 'İletişime geçildi')
    const reverts = record?.data.stageReverts as {
      from: string
      to: string
      reason: string
      by: { role: string }
    }[]
    assert.equal(reverts.length, 1)
    assert.deepEqual(
      [reverts[0]?.from, reverts[0]?.to, reverts[0]?.reason, reverts[0]?.by.role],
      ['Teklif verildi', 'İletişime geçildi', reason, 'yonetici'],
    )
    const audit = await db.select().from(auditLog).where(eq(auditLog.institutionId, a.id))
    assert.ok(JSON.stringify(audit).includes('prospect.stageRevert'))
    assert.ok(!JSON.stringify(audit).includes('yanlışlıkla işaretlendi'))
    // Aynı sürümle ikinci istek eski sürüm olduğu için 409; kayıt yeniden değişmez.
    await unchanged(a.id, 'pr4', async () => {
      assertError(
        await stageRevert(a.adminCookie, 'pr4', { stage: 'Yeni aday', reason }, version),
        409,
        'version_conflict',
      )
    })
  })

  test('DOM-KAY-030: oturumsuz 401; ön büro, öğretmen, öğrenci ve veli 403; başlık, gövde ve kural reddi aday değiştirmez', async () => {
    const a = await institution()
    const version = await versionOf(a.id, 'pr4')
    const good = { stage: 'Yeni aday', reason: 'Gerekçe.' }
    assertError(await stageRevert(null, 'pr4', good, version), 401)
    await unchanged(a.id, 'pr4', async () => {
      for (const role of ['onburo', 'ogretmen', 'ogrenci', 'veli'] as const)
        assertError(
          await stageRevert((await member(a.id, role)).cookie, 'pr4', good, version),
          403,
          'forbidden',
        )
      const admin = a.adminCookie
      assertError(await stageRevert(admin, 'pr4', good, null), 400, 'if_match_required')
      assertError(await stageRevert(admin, 'pr4', { stage: 'Yeni aday' }, version), 400)
      assertError(await stageRevert(admin, 'pr4', { ...good, reason: 'x' }, version), 400)
      assertError(await stageRevert(admin, 'pr4', { ...good, stage: 'Vazgeçti' }, version), 400)
      assertError(await stageRevert(admin, 'pr4', { ...good, extra: 1 }, version), 400)
      // Aynı ya da ileri aşama ve görüşmesiz Görüşme planlandı 422.
      assertError(
        await stageRevert(admin, 'pr4', { ...good, stage: 'Teklif verildi' }, version),
        422,
        'prospect_stage_not_backward',
      )
      assertError(
        await stageRevert(admin, 'pr4', { ...good, stage: 'Görüşme planlandı' }, version),
        422,
        'prospect_meeting_required',
      )
      assertError(await stageRevert(admin, 'pr-yok', good, 1), 404, 'not_found')
    })
    // Vazgeçen aday önce yeniden açılır (409); sürüm ne olursa olsun yetkisiz rol 403 alır.
    const lost = await versionOf(a.id, 'pr5')
    assertError(await stageRevert(a.adminCookie, 'pr5', good, lost), 409, 'prospect_closed')
  })

  test('DOM-YTK-040: crm modülü kapalıyken aşama geri alma 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { crm: false } })
    await unchanged(a.id, 'pr4', async () => {
      assertError(
        await stageRevert(a.adminCookie, 'pr4', { stage: 'Yeni aday', reason: 'Gerekçe.' }, 1),
        403,
        'module_disabled',
      )
    })
  })

  // --- Ticari ileti onayı (DOM-KAY-004) ---------------------------------------------------------

  test('DOM-KAY-004: ön büro onayı verir, yönetici geri alır; geçmiş kalıcıdır, denetimde iletişim yok', async () => {
    const a = await institution()
    const front = await frontDesk(a.id)
    const first = await versionOf(a.id, 'pr1')
    const given = await consent(front, 'pr1', { channel: 'sms', granted: true }, first)
    assert.equal(given.statusCode, 200, given.body)
    const record = await findRecord(db, a.id, 'prospects', 'pr1')
    assert.equal(record?.version, first + 1)
    const sms = (record?.data.marketingConsent as { sms: { granted: boolean } }).sms
    assert.equal(sms.granted, true)
    // Geri alma anında etkilidir; aşama değişmez, geçmiş iki olay taşır.
    const withdrawn = await consent(
      a.adminCookie,
      'pr1',
      { channel: 'sms', granted: false },
      first + 1,
    )
    assert.equal(withdrawn.statusCode, 200, withdrawn.body)
    const after = await findRecord(db, a.id, 'prospects', 'pr1')
    assert.equal((after?.data.marketingConsent as { sms: { granted: boolean } }).sms.granted, false)
    assert.equal(after?.data.stage, record?.data.stage)
    const history = after?.data.marketingConsentHistory as { channel: string; granted: boolean }[]
    assert.deepEqual(
      history.map((event) => [event.channel, event.granted]),
      [
        ['sms', true],
        ['sms', false],
      ],
    )
    const audit = await db.select().from(auditLog).where(eq(auditLog.institutionId, a.id))
    assert.ok(JSON.stringify(audit).includes('prospect.consent'))
    assert.ok(!JSON.stringify(audit).includes(String(PR1?.phone)))
  })

  test('DOM-KAY-004: oturumsuz 401; öğretmen, öğrenci ve veli 403; başlık, gövde ve mükerrer karar aday değiştirmez', async () => {
    const a = await institution()
    const front = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    const good = { channel: 'sms', granted: true }
    assertError(await consent(null, 'pr1', good, version), 401)
    await unchanged(a.id, 'pr1', async () => {
      for (const role of ['ogretmen', 'ogrenci', 'veli'] as const)
        assertError(
          await consent((await member(a.id, role)).cookie, 'pr1', good, version),
          403,
          'forbidden',
        )
      assertError(await consent(front, 'pr1', good, null), 400, 'if_match_required')
      for (const body of [
        {},
        { channel: 'sms' },
        { channel: 'posta', granted: true },
        { channel: 'sms', granted: 'evet' },
        { ...good, extra: 1 },
      ])
        assertError(await consent(front, 'pr1', body, version), 400)
      // Onay yokken geri alma mükerrerdir.
      assertError(
        await consent(front, 'pr1', { channel: 'call', granted: false }, version),
        409,
        'marketing_consent_unchanged',
      )
      assertError(await consent(front, 'pr1', good, version + 5), 409, 'version_conflict')
      assertError(await consent(front, 'pr-yok', good, 1), 404, 'not_found')
    })
  })

  test('DOM-YTK-040: crm modülü kapalıyken onay ucu 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { crm: false } })
    await unchanged(a.id, 'pr1', async () => {
      assertError(
        await consent(a.adminCookie, 'pr1', { channel: 'sms', granted: true }, 1),
        403,
        'module_disabled',
      )
    })
  })

  // --- Aday bilgisi düzeltme (DOM-KAY-003) ------------------------------------------------------

  test('DOM-KAY-003: ön büro adayın bilgisini düzeltir; sürüm artar, aşama değişmez, denetimde iletişim yok', async () => {
    const a = await institution()
    const front = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    const before = await findRecord(db, a.id, 'prospects', 'pr1')
    const done = await details(
      front,
      'pr1',
      { phone: '05559998877', interest: 'Düzeltilmiş ilgi' },
      version,
    )
    assert.equal(done.statusCode, 200, done.body)
    const record = await findRecord(db, a.id, 'prospects', 'pr1')
    assert.equal(record?.version, version + 1)
    assert.equal(record?.data.phone, '05559998877')
    assert.equal(record?.data.interest, 'Düzeltilmiş ilgi')
    assert.equal(record?.data.stage, before?.data.stage)
    const edits = record?.data.profileEdits as { fields: string[]; by: { role: string } }[]
    assert.deepEqual(edits[0]?.fields, ['phone', 'interest'])
    assert.equal(edits[0]?.by.role, 'onburo')
    const audit = await db.select().from(auditLog).where(eq(auditLog.institutionId, a.id))
    assert.ok(JSON.stringify(audit).includes('prospect.update'))
    assert.ok(!JSON.stringify(audit).includes('05559998877'))
    assert.ok(!JSON.stringify(audit).includes('Düzeltilmiş ilgi'))
  })

  test('DOM-KAY-003: oturumsuz 401; öğretmen, öğrenci ve veli 403; başlık, gövde, değişiklik yok ve mükerrer reddedilir; aday değişmez', async () => {
    const a = await institution()
    const front = await frontDesk(a.id)
    const version = await versionOf(a.id, 'pr1')
    const good = { interest: 'Başka program' }
    assertError(await details(null, 'pr1', good, version), 401)
    await unchanged(a.id, 'pr1', async () => {
      for (const role of ['ogretmen', 'ogrenci', 'veli'] as const)
        assertError(
          await details((await member(a.id, role)).cookie, 'pr1', good, version),
          403,
          'forbidden',
        )
      assertError(await details(front, 'pr1', good, null), 400, 'if_match_required')
      for (const body of [
        {},
        { name: 'A' },
        { phone: '123' },
        { email: 'eposta' },
        { stage: 'Yeni aday' },
        { ...good, extra: 1 },
      ])
        assertError(await details(front, 'pr1', body, version), 400)
      assertError(await details(front, 'pr1', good, version + 5), 409, 'version_conflict')
      assertError(await details(front, 'pr-yok', good, 1), 404, 'not_found')
      // Aynı değerle gönderim: değişiklik yok 409.
      assertError(
        await details(front, 'pr1', { interest: PR1?.interest }, version),
        409,
        'prospect_unchanged',
      )
    })
    // Başka adayın telefonu ve adıyla çakışan düzeltme mükerrerdir (409).
    const other = SEED.prospects[1]
    assert.ok(other)
    const dup = await details(front, 'pr1', { name: other.name, phone: other.phone }, version)
    assert.ok([409].includes(dup.statusCode), dup.body)
  })

  test('DOM-YTK-040: crm modülü kapalıyken düzeltme ucu 403 module_disabled', async () => {
    const a = await institution({ enabledModules: { crm: false } })
    await unchanged(a.id, 'pr1', async () => {
      assertError(
        await details(a.adminCookie, 'pr1', { interest: 'Başka program' }, 1),
        403,
        'module_disabled',
      )
    })
  })

  // --- Kesin kayıtta burs (DOM-FIN-025) --------------------------------------------------------

  const PROGRAM = {
    academicYear: FIXED_NOW.getUTCFullYear(),
    name: 'Başarı Bursu',
    conditions: 'Sınav puanı 90 ve üstü.',
    terminationConditions: 'Disiplin cezası alan öğrencinin bursu kesilir.',
    durationNote: 'Bir eğitim yılı',
    percentBasisPoints: 6000,
    capacity: 1,
  }
  async function scholarshipProgram(cookie: string, notify = true) {
    const made = await send('POST', '/api/v1/finance/scholarship-programs', cookie, PROGRAM)
    assert.equal(made.statusCode, 201, made.body)
    const { id, version } = made.json().data as { id: string; version: number }
    if (notify) {
      const noticed = await send(
        'POST',
        `/api/v1/finance/scholarship-programs/${id}/notify`,
        cookie,
        { notifiedDate: '2026-09-01' },
        ifMatch(version),
      )
      assert.equal(noticed.statusCode, 200, noticed.body)
    }
    return id
  }

  test('DOM-FIN-021, DOM-FIN-025: yönetici kesin kayıtta burs atar; net düşer, atama aynı işlemde yazılır, denetimde tutar yok', async () => {
    const a = await pricedInstitution()
    const programId = await scholarshipProgram(a.adminCookie)
    const done = await enroll(
      a.adminCookie,
      'pr1',
      { ...ENROLLMENT, scholarshipProgramId: programId },
      await versionOf(a.id, 'pr1'),
    )
    assert.equal(done.statusCode, 201, done.body)
    const studentId = done.json().data.entity.id as string
    const amount = Math.floor((TUITION.amountCents * 6000) / 10_000)
    const { contracts, invoices } = await enrollmentRows(a.id)
    const contract = contracts.find((row) => row.data.studentId === studentId)
    assert.deepEqual(contract?.data.scholarship, { programId, amountCents: amount })
    assert.equal(contract?.data.netCents, TUITION.amountCents - amount)
    assert.equal(
      invoices
        .filter((row) => row.data.studentId === studentId)
        .reduce((sum, row) => sum + Number(row.data.amount), 0),
      TUITION.amountCents - amount,
    )
    const awards = await a_get(
      a.adminCookie,
      `/api/v1/finance/scholarship-awards?programId=${programId}`,
    )
    assert.equal(awards.statusCode, 200, awards.body)
    assert.equal(awards.json().meta.total, 1)
    assert.equal(awards.json().data[0].studentId, studentId)
    assert.equal(awards.json().data[0].amountCents, amount)
    const list = await a_get(a.adminCookie, '/api/v1/finance/scholarship-programs')
    assert.equal(list.json().data[0].awardedCount, 1)
    // Kontenjan bir kişilik: ikinci aday 409, kayıt yazılmaz.
    await noEnrollment(a.id, 'pr4', async () => {
      assertError(
        await enroll(
          a.adminCookie,
          'pr4',
          {
            ...ENROLLMENT,
            identity: { ...ENROLLMENT.identity, number: '11111111110' },
            scholarshipProgramId: programId,
          },
          await versionOf(a.id, 'pr4'),
        ),
        409,
        'scholarship_capacity_full',
      )
    })
  })

  test('DOM-FIN-025, DOM-FIN-052: ön büro burs atayamaz; bildirilmemiş ve olmayan program reddedilir; kayıt yazılmaz', async () => {
    const a = await pricedInstitution()
    const version = await versionOf(a.id, 'pr1')
    const notified = await scholarshipProgram(a.adminCookie)
    const body = (scholarshipProgramId: string) => ({ ...ENROLLMENT, scholarshipProgramId })
    await noEnrollment(a.id, 'pr1', async () => {
      assertError(
        await enroll(await frontDesk(a.id), 'pr1', body(notified), version),
        422,
        'scholarship_approval_required',
      )
      assertError(
        await enroll(a.adminCookie, 'pr1', body('00000000-0000-4000-8000-00000000000a'), version),
        404,
        'not_found',
      )
      assertError(await enroll(a.adminCookie, 'pr1', body('gecersiz'), version), 400)
    })
    const unnotified = await send('POST', '/api/v1/finance/scholarship-programs', a.adminCookie, {
      ...PROGRAM,
      name: 'Bildirilmemiş Burs',
    })
    await noEnrollment(a.id, 'pr1', async () => {
      assertError(
        await enroll(a.adminCookie, 'pr1', body(unnotified.json().data.id), version),
        422,
        'scholarship_program_not_notified',
      )
    })
  })
})
