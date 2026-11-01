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
import { AppError } from '../src/errors.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { addProspectNoteCommand } from '../src/services/prospects.ts'
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
    return target.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      payload: JSON.stringify(body),
    })
  }
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
})
