import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { consents, noticeAcknowledgements, privacyNotices } from '../src/db/schema/privacy.ts'
import type { MembershipLinkInput } from '../src/services/identity.ts'
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
 * Aydınlatma ve açık rıza uçları (IST-016, IST-017; docs/domain/yetki-ve-kapsam.md
 * DOM-YTK-056…062). Her test kendi kurumunu kurar: 7-A (c1) ve 9-A (c5). Deniz (s1) 7-A'da ve 17
 * yaşında (18. yaş günü 7 Ekim 2027), s25 7-A'da ve FIXED_NOW (6 Ekim 2026) günü 18 yaşını
 * dolduruyor, s5 9-A'da. t2 yalnız c1–c4'e ders verir. Veli s1 ve s25'in velisidir.
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c5']
const BIRTH_DATES: Record<string, string> = {
  s1: '2009-10-07',
  s25: '2008-10-06',
  s5: '2012-03-15',
}
type Sample = Partial<Record<CollectionName, readonly Record<string, unknown>[]>>
const SAMPLE: Sample = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students
    .filter((item) => CLASS_IDS.includes(item.classId))
    .map((item) => ({ ...item, birthDate: BIRTH_DATES[item.id] })),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
}
/** Eğitim yılı 2026–2027 bitişi: 1 Eylül 2027 00:00 Europe/Istanbul. */
const YEAR_END = '2027-08-31T21:00:00.000Z'

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

type Json = ReturnType<typeof JSON.parse>

describe('aydınlatma ve açık rıza uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-consent-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    assert.ok(
      SEED.assignments.some((item) => item.teacherId === 't2' && item.classId === 'c1') &&
        !SEED.assignments.some((item) => item.teacherId === 't2' && item.classId === 'c5'),
      'örnek veride t2 7-A’ya ders vermeli, 9-A’ya vermemeli',
    )
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }

  function send(
    method: 'POST' | 'GET',
    url: string,
    cookie: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url,
      headers: {
        origin: TEST_ORIGIN,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie === null ? {} : { cookie }),
        ...headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    })
  }
  const read = (cookie: string | null, url: string) => send('GET', url, cookie)

  async function publish(cookie: string, body: Record<string, unknown>) {
    const response = await send('POST', '/api/v1/privacy-notices', cookie, body, key())
    assert.equal(response.statusCode, 201, response.body)
    return response.json().data as Json
  }
  const consentText = (cookie: string, purpose: string, extra: Record<string, unknown> = {}) =>
    publish(cookie, {
      kind: 'consent_text',
      purpose,
      title: 'Rıza metni',
      body: 'Açık rıza metni.',
      ...extra,
    })

  /** Kurum, kayıtlar, kişiler ve yayımlanmış metinler. */
  async function world(overrides: Partial<InstitutionOverrides> = {}) {
    const institution = await createInstitution(app, overrides)
    await insertMissingRecords(db, institution.id, rows(SAMPLE), FIXED_NOW)
    const admin = await signInAs(app, institution.admin)
    const texts = {
      sharing: await consentText(admin, 'photo_video_sharing'),
      speaking: await consentText(admin, 'speaking_recording'),
      promotional: await consentText(admin, 'promotional_messages'),
    }
    const parentNotice = await publish(admin, {
      kind: 'notice',
      audience: 'veli',
      title: 'Veli aydınlatma metni',
      body: 'Kişisel verileriniz şu amaçlarla işlenir.',
    })
    return {
      id: institution.id,
      admin,
      texts,
      parentNotice,
      parent: await member(institution.id, 'veli', [
        { kind: 'child', recordId: 's1' },
        { kind: 'child', recordId: 's25' },
      ]),
      otherParent: await member(institution.id, 'veli', [{ kind: 'child', recordId: 's5' }]),
      minor: await member(institution.id, 'ogrenci', [{ kind: 'student', recordId: 's1' }]),
      adult: await member(institution.id, 'ogrenci', [{ kind: 'student', recordId: 's25' }]),
      teacher: await member(institution.id, 'ogretmen', [{ kind: 'teacher', recordId: 't2' }]),
      frontDesk: await member(institution.id, 'onburo'),
    }
  }

  const give = (
    cookie: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = key(),
  ) => send('POST', '/api/v1/consents', cookie, { channel: 'web', ...body }, headers)
  const withdraw = (cookie: string, consentId: string) =>
    send('POST', `/api/v1/consents/${consentId}/withdraw`, cookie, {})
  const consentRows = (institutionId: string) =>
    db.select().from(consents).where(eq(consents.institutionId, institutionId))
  async function status(cookie: string, query: string) {
    const response = await read(cookie, `/api/v1/consents/status?${query}`)
    assert.equal(response.statusCode, 200, response.body)
    return Object.fromEntries(
      (response.json().data as { purpose: string; valid: boolean }[]).map((item) => [
        item.purpose,
        item.valid,
      ]),
    )
  }

  test('401: oturumsuz istek her uçta reddedilir', async () => {
    const w = await world()
    const calls: [method: 'GET' | 'POST', url: string, body?: unknown][] = [
      ['GET', '/api/v1/privacy-notices'],
      [
        'POST',
        '/api/v1/privacy-notices',
        { kind: 'notice', audience: 'veli', title: 'a', body: 'b' },
      ],
      ['GET', '/api/v1/privacy-notices/current'],
      ['POST', `/api/v1/privacy-notices/${w.parentNotice.id}/acknowledge`, { channel: 'web' }],
      ['GET', '/api/v1/consent-texts/photo_video_sharing'],
      ['GET', '/api/v1/consents?studentId=s1'],
      ['GET', '/api/v1/consents/status?studentId=s1'],
      ['POST', '/api/v1/consents', { purpose: 'photo_video_sharing', studentId: 's1' }],
      ['POST', `/api/v1/consents/${crypto.randomUUID()}/withdraw`, {}],
    ]
    for (const [method, url, body] of calls) {
      const response = await send(method, url, null, body, key())
      assert.equal(response.statusCode, 401, `${method} ${url}`)
    }
    assert.equal((await consentRows(w.id)).length, 0)
  })

  test('403: personel rıza veremez/geri çekemez, öğretmen satırları okuyamaz, metni yalnız yönetici yayımlar', async () => {
    const w = await world()
    const body = { purpose: 'photo_video_sharing', studentId: 's1', textId: w.texts.sharing.id }
    for (const cookie of [w.admin, w.teacher.cookie, w.frontDesk.cookie]) {
      const response = await give(cookie, body)
      assert.equal(response.statusCode, 403, response.body)
      assert.equal(response.json().code, 'forbidden')
    }
    const given = await give(w.parent.cookie, body)
    assert.equal(given.statusCode, 201, given.body)
    const id = given.json().data.id as string
    for (const cookie of [w.admin, w.teacher.cookie, w.frontDesk.cookie])
      assert.equal((await withdraw(cookie, id)).statusCode, 403)
    assert.equal((await read(w.teacher.cookie, '/api/v1/consents?studentId=s1')).statusCode, 403)
    for (const cookie of [w.parent.cookie, w.teacher.cookie, w.frontDesk.cookie]) {
      assert.equal((await read(cookie, '/api/v1/privacy-notices')).statusCode, 403)
      const published = await send(
        'POST',
        '/api/v1/privacy-notices',
        cookie,
        { kind: 'notice', audience: 'veli', title: 'Yeni', body: 'Metin' },
        key(),
      )
      assert.equal(published.statusCode, 403)
    }
    const [row] = await consentRows(w.id)
    assert.equal(row?.withdrawnAt, null)
  })

  test('DOM-YTK-056 DOM-YTK-060 metin yayımı: sürüm artar, eski metin değişmez; 400 ve anahtarsız istek kayıt açmaz; tekrar aynı metni döndürür', async () => {
    const w = await world()
    const count = async () =>
      (await db.select().from(privacyNotices).where(eq(privacyNotices.institutionId, w.id))).length
    const before = await count()
    const invalid: Record<string, unknown>[] = [
      { kind: 'notice', audience: 'veli', title: '', body: 'Metin' },
      { kind: 'notice', audience: 'misafir', title: 'Başlık', body: 'Metin' },
      { kind: 'consent_text', purpose: 'bilinmeyen', title: 'Başlık', body: 'Metin' },
      { kind: 'notice', audience: 'veli', title: 'Başlık', body: 'Metin', institutionId: 'x' },
    ]
    for (const body of invalid) {
      const response = await send('POST', '/api/v1/privacy-notices', w.admin, body, key())
      assert.equal(response.statusCode, 400, JSON.stringify(body))
    }
    const missing = await send('POST', '/api/v1/privacy-notices', w.admin, {
      kind: 'notice',
      audience: 'veli',
      title: 'Başlık',
      body: 'Metin',
    })
    assert.equal(missing.statusCode, 400)
    assert.equal(missing.json().code, 'idempotency_key_required')
    assert.equal(await count(), before)

    const headers = key()
    const body = { kind: 'notice', audience: 'veli', title: 'Güncel metin', body: 'Yeni metin' }
    const first = await send('POST', '/api/v1/privacy-notices', w.admin, body, headers)
    const again = await send('POST', '/api/v1/privacy-notices', w.admin, body, headers)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(first.json().data.version, 2)
    assert.equal(first.headers.location, `/api/v1/privacy-notices/${first.json().data.id}`)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.equal(again.json().data.id, first.json().data.id)
    assert.equal(await count(), before + 1)

    const list = await read(w.admin, '/api/v1/privacy-notices?pageSize=100')
    assert.equal(list.statusCode, 200)
    const notices = list.json().data as Json[]
    assert.equal(list.json().meta.total, before + 1)
    const original = notices.find((item) => item.id === w.parentNotice.id)
    assert.equal(original.version, 1)
    assert.equal(original.title, 'Veli aydınlatma metni')
    assert.equal((await read(w.admin, '/api/v1/privacy-notices?sort=title')).statusCode, 400)

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, w.id), eq(auditLog.action, 'notice.publish')))
    assert.ok(audits.length >= 1)
    assert.equal(JSON.stringify(audits).includes('Yeni metin'), false)
  })

  test('DOM-YTK-056 aydınlatma gösterimi: ilk 201, aynı sürüm 200; yeni sürümde yeniden gösterilir, eski sürüm 409', async () => {
    const w = await world()
    const current = await read(w.parent.cookie, '/api/v1/privacy-notices/current')
    assert.equal(current.statusCode, 200, current.body)
    assert.equal(current.json().data.audience, 'veli')
    assert.equal(current.json().data.notice.id, w.parentNotice.id)
    assert.equal(current.json().data.needsAcknowledgement, true)

    const url = `/api/v1/privacy-notices/${w.parentNotice.id}/acknowledge`
    const first = await send('POST', url, w.parent.cookie, { channel: 'mobile' })
    assert.equal(first.statusCode, 201, first.body)
    const second = await send('POST', url, w.parent.cookie, { channel: 'web' })
    assert.equal(second.statusCode, 200, second.body)
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal(second.json().data.channel, 'mobile')
    const seen = await db
      .select()
      .from(noticeAcknowledgements)
      .where(eq(noticeAcknowledgements.institutionId, w.id))
    assert.equal(seen.length, 1)
    const after = await read(w.parent.cookie, '/api/v1/privacy-notices/current')
    assert.equal(after.json().data.needsAcknowledgement, false)
    assert.equal(after.json().data.acknowledgedAt, first.json().data.acknowledgedAt)

    // Başka kitlenin metni ve rıza metni 404; gövdedeki bilinmeyen alan 400.
    const student = await send('POST', url, w.minor.cookie, { channel: 'web' })
    assert.equal(student.statusCode, 404, student.body)
    const text = await send(
      'POST',
      `/api/v1/privacy-notices/${w.texts.sharing.id}/acknowledge`,
      w.parent.cookie,
      { channel: 'web' },
    )
    assert.equal(text.statusCode, 404)
    const extra = await send('POST', url, w.otherParent.cookie, { channel: 'web', userId: 'x' })
    assert.equal(extra.statusCode, 400)

    const next = await publish(w.admin, {
      kind: 'notice',
      audience: 'veli',
      title: 'Veli aydınlatma metni',
      body: 'Güncellenmiş metin.',
    })
    const renewed = await read(w.parent.cookie, '/api/v1/privacy-notices/current')
    assert.equal(renewed.json().data.notice.id, next.id)
    assert.equal(renewed.json().data.needsAcknowledgement, true)
    const outdated = await send('POST', url, w.otherParent.cookie, { channel: 'web' })
    assert.equal(outdated.statusCode, 409)
    assert.equal(outdated.json().code, 'notice_outdated')

    const staff = await read(w.teacher.cookie, '/api/v1/privacy-notices/current')
    assert.equal(staff.json().data.audience, 'personel')
    assert.equal(staff.json().data.notice, null)
    assert.equal(staff.json().data.needsAcknowledgement, false)
  })

  test('DOM-YTK-057 DOM-YTK-058 veli 17 yaşındaki çocuğu için rıza verir: 201, kalıcı, eğitim yılı sonunda biter, denetimde yalnız alan adları; tekrar ve mükerrer', async () => {
    const w = await world()
    const text = await read(w.parent.cookie, '/api/v1/consent-texts/photo_video_sharing')
    assert.equal(text.statusCode, 200, text.body)
    assert.equal(text.json().data.text.id, w.texts.sharing.id)
    assert.equal(text.json().data.minimumVersion, 1)
    const none = await read(w.parent.cookie, '/api/v1/consent-texts/photo_video_print')
    assert.equal(none.statusCode, 404)
    assert.equal(none.json().code, 'consent_text_not_found')

    const headers = key()
    const body = { purpose: 'photo_video_sharing', studentId: 's1', textId: w.texts.sharing.id }
    const first = await give(w.parent.cookie, body, headers)
    assert.equal(first.statusCode, 201, first.body)
    const data = first.json().data
    assert.equal(first.headers.location, `/api/v1/consents/${data.id}`)
    assert.equal(data.subjectKind, 'student')
    assert.equal(data.subjectId, 's1')
    assert.equal(data.grantorRelation, 'guardian')
    assert.equal('grantedByUserId' in data, false)
    assert.equal(data.textVersion, 1)
    assert.equal(data.expiresAt, YEAR_END)
    assert.equal(data.givenAt, FIXED_NOW.toISOString())

    const replay = await give(w.parent.cookie, body, headers)
    assert.equal(replay.statusCode, 201)
    assert.equal(replay.headers['idempotent-replayed'], 'true')
    assert.equal(replay.json().data.id, data.id)
    const duplicate = await give(w.parent.cookie, body)
    assert.equal(duplicate.statusCode, 409)
    assert.equal(duplicate.json().code, 'consent_exists')
    const missingKey = await give(w.parent.cookie, body, {})
    assert.equal(missingKey.statusCode, 400)
    assert.equal(missingKey.json().code, 'idempotency_key_required')

    const stored = await consentRows(w.id)
    assert.equal(stored.length, 1)
    assert.equal(stored[0]?.id, data.id)
    assert.equal(stored[0]?.purpose, 'photo_video_sharing')

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, w.id), eq(auditLog.action, 'consent.give')))
    assert.equal(audits.length, 1)
    assert.deepEqual(audits[0]?.changes?.fields, [
      'subjectKind',
      'subjectId',
      'purpose',
      'decision',
      'grantorRelation',
      'textId',
      'textVersion',
      'channel',
      'givenAt',
      'expiresAt',
    ])
    assert.equal(JSON.stringify(audits[0]?.changes).includes('s1'), false)

    const list = await read(w.parent.cookie, '/api/v1/consents?studentId=s1')
    assert.equal(list.statusCode, 200, list.body)
    assert.deepEqual(
      (list.json().data as Json[]).map((item) => item.id),
      [data.id],
    )
    assert.equal(list.json().meta.total, 1)
    assert.equal((await status(w.parent.cookie, 'studentId=s1')).photo_video_sharing, true)
    assert.equal((await status(w.minor.cookie, 'studentId=s1')).photo_video_sharing, true)
  })

  test('DOM-YTK-057 rızayı veren kullanıcının kimliği yalnız yönetici ve ön büroya döner; veli ve öğrenci yalnız ilişkiyi görür', async () => {
    const w = await world()
    const given = await give(w.parent.cookie, {
      purpose: 'photo_video_sharing',
      studentId: 's1',
      textId: w.texts.sharing.id,
    })
    assert.equal(given.statusCode, 201, given.body)
    for (const cookie of [w.admin, w.frontDesk.cookie]) {
      const [item] = (await read(cookie, '/api/v1/consents?studentId=s1')).json().data as Json[]
      assert.equal(item.grantedByUserId, w.parent.id)
      assert.equal(item.grantorRelation, 'guardian')
    }
    for (const cookie of [w.parent.cookie, w.minor.cookie]) {
      const response = await read(cookie, '/api/v1/consents?studentId=s1')
      assert.equal(response.statusCode, 200, response.body)
      const [item] = response.json().data as Json[]
      assert.equal('grantedByUserId' in item, false)
      assert.equal(item.grantorRelation, 'guardian')
      assert.equal(JSON.stringify(response.json()).includes(w.parent.id), false)
    }
    const withdrawn = await withdraw(w.parent.cookie, given.json().data.id)
    assert.equal(withdrawn.statusCode, 200, withdrawn.body)
    assert.equal('grantedByUserId' in withdrawn.json().data, false)
  })

  test('DOM-YTK-057 17/18 yaş: 18 yaşını dolduran öğrenci rızayı kendisi verir, veli veremez; 17 yaşındaki öğrenci veremez', async () => {
    const w = await world()
    const body = (studentId: string) => ({
      purpose: 'photo_video_sharing',
      studentId,
      textId: w.texts.sharing.id,
    })
    const parentForAdult = await give(w.parent.cookie, body('s25'))
    assert.equal(parentForAdult.statusCode, 403)
    assert.equal(parentForAdult.json().code, 'consent_adult_self')
    const minorSelf = await give(w.minor.cookie, body('s1'))
    assert.equal(minorSelf.statusCode, 403)
    assert.equal(minorSelf.json().code, 'consent_guardian_required')
    const minorPromotional = await give(w.minor.cookie, {
      purpose: 'promotional_messages',
      textId: w.texts.promotional.id,
    })
    assert.equal(minorPromotional.statusCode, 422)
    assert.equal(minorPromotional.json().code, 'consent_not_applicable')
    assert.equal((await consentRows(w.id)).length, 0)

    const adultSelf = await give(w.adult.cookie, body('s25'))
    assert.equal(adultSelf.statusCode, 201, adultSelf.body)
    assert.equal(adultSelf.json().data.grantorRelation, 'self')
    // Başka öğrencinin kaydı bulunamadı sayılır.
    const otherStudent = await give(w.adult.cookie, body('s1'))
    assert.equal(otherStudent.statusCode, 404)

    // Hesap amacı (tanıtım iletisi): veri sahibi oturumdaki kullanıcıdır, `studentId` verilmez.
    const promotional = await give(w.parent.cookie, {
      purpose: 'promotional_messages',
      textId: w.texts.promotional.id,
    })
    assert.equal(promotional.statusCode, 201, promotional.body)
    assert.equal(promotional.json().data.subjectKind, 'user')
    assert.equal(promotional.json().data.subjectId, w.parent.id)
    assert.equal(promotional.json().data.expiresAt, null)
    assert.equal((await status(w.parent.cookie, '')).promotional_messages, true)
    assert.equal((await status(w.otherParent.cookie, '')).promotional_messages, false)
    const own = await read(w.parent.cookie, '/api/v1/consents')
    assert.equal(own.json().meta.total, 1)
  })

  test('DOM-YTK-057 DOM-YTK-061 kapsam: veli başka çocuğa rıza veremez; öğretmen yalnız ders verdiği öğrencinin var/yok sonucunu görür', async () => {
    const w = await world()
    const foreign = await give(w.parent.cookie, {
      purpose: 'photo_video_sharing',
      studentId: 's5',
      textId: w.texts.sharing.id,
    })
    assert.equal(foreign.statusCode, 404)
    assert.equal(foreign.json().code, 'not_found')
    const unknown = await give(w.parent.cookie, {
      purpose: 'photo_video_sharing',
      studentId: 'yok',
      textId: w.texts.sharing.id,
    })
    assert.equal(unknown.statusCode, 404)
    assert.equal((await consentRows(w.id)).length, 0)

    const given = await give(w.otherParent.cookie, {
      purpose: 'photo_video_sharing',
      studentId: 's5',
      textId: w.texts.sharing.id,
    })
    assert.equal(given.statusCode, 201, given.body)
    const id = given.json().data.id as string

    // Veli başka çocuğun, öğrenci başka öğrencinin rızasını okuyamaz; veli geri çekemez.
    assert.equal((await read(w.parent.cookie, '/api/v1/consents?studentId=s5')).statusCode, 404)
    for (const [cookie, studentId] of [
      [w.minor.cookie, 's5'],
      [w.minor.cookie, 's25'],
      [w.adult.cookie, 's1'],
    ] as const) {
      const response = await read(cookie, `/api/v1/consents?studentId=${studentId}&status=all`)
      assert.equal(response.statusCode, 404, `${studentId}: ${response.body}`)
      assert.equal(response.json().code, 'not_found')
      assert.equal(response.body.includes(id), false)
    }
    assert.equal(
      (await read(w.parent.cookie, '/api/v1/consents/status?studentId=s5')).statusCode,
      404,
    )
    const stranger = await withdraw(w.parent.cookie, id)
    assert.equal(stranger.statusCode, 404, stranger.body)
    assert.equal((await consentRows(w.id))[0]?.withdrawnAt, null)

    // Öğretmen: 7-A (ders veriyor) var/yok; 9-A (ders vermiyor) 404; satırları okuyamaz.
    const own = await read(w.teacher.cookie, '/api/v1/consents/status?studentId=s1')
    assert.equal(own.statusCode, 200, own.body)
    for (const item of own.json().data as Json[])
      assert.deepEqual(Object.keys(item).sort(), ['purpose', 'valid'])
    const outside = await read(w.teacher.cookie, '/api/v1/consents/status?studentId=s5')
    assert.equal(outside.statusCode, 404)
    assert.equal(outside.json().code, 'not_found')

    // Yönetici ve ön büro kurumun bütün öğrencilerini okur.
    assert.equal((await status(w.admin, 'studentId=s5')).photo_video_sharing, true)
    const desk = await read(w.frontDesk.cookie, '/api/v1/consents?studentId=s5&status=all')
    assert.equal(desk.statusCode, 200)
    assert.equal(desk.json().meta.total, 1)
    assert.equal(
      (await read(w.frontDesk.cookie, '/api/v1/consents?studentId=s5&order=asc')).statusCode,
      400,
    )
  })

  test('400: geçersiz gövde ve gövdedeki institutionId reddedilir, kayıt açılmaz', async () => {
    const w = await world()
    const base = { purpose: 'photo_video_sharing', studentId: 's1', textId: w.texts.sharing.id }
    const invalid: Record<string, unknown>[] = [
      { ...base, institutionId: 'baska-kurum' },
      { ...base, purpose: 'bilinmeyen' },
      { ...base, textId: 'metin' },
      { ...base, studentId: undefined },
      { ...base, channel: 'paper' },
      { purpose: 'promotional_messages', studentId: 's1', textId: w.texts.promotional.id },
    ]
    for (const body of invalid) {
      const response = await give(w.parent.cookie, body)
      assert.equal(response.statusCode, 400, `${JSON.stringify(body)}: ${response.body}`)
      assert.equal(response.json().code, 'validation_failed')
    }
    assert.equal((await consentRows(w.id)).length, 0)
    const bad = await send(
      'POST',
      `/api/v1/consents/${crypto.randomUUID()}/withdraw`,
      w.parent.cookie,
      { reason: 'x' },
    )
    assert.equal(bad.statusCode, 400)
    assert.equal(
      (await send('POST', '/api/v1/consents/abc/withdraw', w.parent.cookie, {})).statusCode,
      400,
    )
  })

  test('DOM-YTK-059 geri çekme anında yansır; ikinci geri çekme 409; yeniden rıza verilebilir', async () => {
    const w = await world()
    const body = { purpose: 'photo_video_sharing', studentId: 's1', textId: w.texts.sharing.id }
    const given = await give(w.parent.cookie, body)
    const id = given.json().data.id as string
    assert.equal((await status(w.teacher.cookie, 'studentId=s1')).photo_video_sharing, true)

    const first = await withdraw(w.parent.cookie, id)
    assert.equal(first.statusCode, 200, first.body)
    assert.equal(first.json().data.withdrawnAt, FIXED_NOW.toISOString())
    assert.equal(first.json().data.withdrawalReason, 'withdrawn')
    assert.equal((await status(w.teacher.cookie, 'studentId=s1')).photo_video_sharing, false)
    assert.equal(
      (await status(w.teacher.cookie, 'studentId=s1&purpose=photo_video_sharing'))
        .photo_video_sharing,
      false,
    )

    const second = await withdraw(w.parent.cookie, id)
    assert.equal(second.statusCode, 409)
    assert.equal(second.json().code, 'consent_already_withdrawn')
    const missing = await withdraw(w.parent.cookie, crypto.randomUUID())
    assert.equal(missing.statusCode, 404)

    const open = await read(w.parent.cookie, '/api/v1/consents?studentId=s1')
    assert.equal(open.json().meta.total, 0)
    const all = await read(w.parent.cookie, '/api/v1/consents?studentId=s1&status=all')
    assert.equal(all.json().meta.total, 1)

    const again = await give(w.parent.cookie, body)
    assert.equal(again.statusCode, 201, again.body)
    assert.equal((await status(w.parent.cookie, 'studentId=s1')).photo_video_sharing, true)
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, w.id), eq(auditLog.action, 'consent.withdraw')))
    assert.deepEqual(audits[0]?.changes?.fields, [
      'withdrawnAt',
      'withdrawnByUserId',
      'withdrawalReason',
    ])
  })

  test('DOM-YTK-062 öğrenci itirazı: 18 yaş altı öğrenci velinin rızasına itiraz eder, rıza geçersizleşir; itirazı yalnız kendisi geri çeker', async () => {
    const w = await world()
    const granted = await give(w.parent.cookie, {
      purpose: 'photo_video_sharing',
      studentId: 's1',
      textId: w.texts.sharing.id,
    })
    assert.equal(granted.statusCode, 201, granted.body)
    const objection = {
      purpose: 'photo_video_sharing',
      decision: 'objected',
      studentId: 's1',
      textId: w.texts.sharing.id,
    }

    // Veli, 18 yaşını dolduran öğrenci ve itiraz edilemeyen amaç 422; başka öğrenci 404.
    const notApplicable: [cookie: string, body: Record<string, unknown>][] = [
      [w.parent.cookie, objection],
      [w.adult.cookie, { ...objection, studentId: 's25' }],
      [
        w.minor.cookie,
        { ...objection, purpose: 'speaking_recording', textId: w.texts.speaking.id },
      ],
    ]
    for (const [cookie, body] of notApplicable) {
      const response = await give(cookie, body)
      assert.equal(response.statusCode, 422, response.body)
      assert.equal(response.json().code, 'objection_not_applicable')
    }
    const foreign = await give(w.minor.cookie, { ...objection, studentId: 's5' })
    assert.equal(foreign.statusCode, 404)
    assert.equal((await consentRows(w.id)).length, 1)

    const objected = await give(w.minor.cookie, objection)
    assert.equal(objected.statusCode, 201, objected.body)
    const data = objected.json().data
    assert.equal(data.decision, 'objected')
    assert.equal(data.grantorRelation, 'self')
    // İtiraz da öğrencinin 18. yaş gününde düşer.
    assert.equal(data.expiresAt, '2027-10-06T21:00:00.000Z')
    for (const cookie of [w.parent.cookie, w.minor.cookie, w.teacher.cookie, w.admin])
      assert.equal((await status(cookie, 'studentId=s1')).photo_video_sharing, false)
    const again = await give(w.minor.cookie, objection)
    assert.equal(again.statusCode, 409)
    assert.equal(again.json().code, 'objection_exists')
    // Velinin rızası açık kalır; veli de satırları görür.
    const list = await read(w.parent.cookie, '/api/v1/consents?studentId=s1')
    assert.deepEqual((list.json().data as Json[]).map((item) => item.decision).sort(), [
      'granted',
      'objected',
    ])

    // İtirazı veli geri çekemez (404); öğrenci geri çekince velinin rızası yeniden geçerli.
    const byParent = await withdraw(w.parent.cookie, data.id)
    assert.equal(byParent.statusCode, 404, byParent.body)
    assert.equal((await consentRows(w.id)).find((row) => row.id === data.id)?.withdrawnAt, null)
    const lifted = await withdraw(w.minor.cookie, data.id)
    assert.equal(lifted.statusCode, 200, lifted.body)
    assert.equal(lifted.json().data.withdrawalReason, 'withdrawn')
    assert.equal((await status(w.teacher.cookie, 'studentId=s1')).photo_video_sharing, true)
  })

  test('DOM-YTK-057 DOM-YTK-059 18 yaşını dolduran öğrenci velinin 17 yaşındayken verdiği rızayı geri çeker', async () => {
    const w = await world()
    now = new Date(FIXED_NOW.getTime() - 86_400_000)
    let given
    try {
      given = await give(w.parent.cookie, {
        purpose: 'speaking_recording',
        studentId: 's25',
        textId: w.texts.speaking.id,
      })
    } finally {
      now = FIXED_NOW
    }
    assert.equal(given.statusCode, 201, given.body)
    assert.equal(given.json().data.grantorRelation, 'guardian')
    assert.equal(given.json().data.expiresAt, '2026-10-05T21:00:00.000Z')
    const id = given.json().data.id as string

    // Başka öğrenci geri çekemez (404); 18 yaşını dolduran öğrencinin kendisi çeker.
    const stranger = await withdraw(w.minor.cookie, id)
    assert.equal(stranger.statusCode, 404, stranger.body)
    const own = await withdraw(w.adult.cookie, id)
    assert.equal(own.statusCode, 200, own.body)
    assert.equal(own.json().data.withdrawnAt, FIXED_NOW.toISOString())
    const [row] = (await consentRows(w.id)).filter((item) => item.id === id)
    assert.equal(row?.withdrawnByUserId, w.adult.id)
    assert.equal(row?.withdrawalReason, 'withdrawn')
    assert.equal((await status(w.adult.cookie, 'studentId=s25')).speaking_recording, false)
  })

  test('DOM-YTK-060 eski metin sürümüne rıza 409; yeniden rıza gerektiren yeni sürüm eski rızayı geçersiz kılar', async () => {
    const w = await world()
    const given = await give(w.parent.cookie, {
      purpose: 'photo_video_sharing',
      studentId: 's1',
      textId: w.texts.sharing.id,
    })
    assert.equal(given.statusCode, 201)

    await consentText(w.admin, 'photo_video_website')
    const website = await consentText(w.admin, 'photo_video_website', { title: 'Sürüm 2' })
    assert.equal(website.version, 2)
    const outdated = await give(w.parent.cookie, {
      purpose: 'photo_video_website',
      studentId: 's1',
      textId: (await read(w.admin, '/api/v1/privacy-notices?pageSize=100'))
        .json()
        .data.find((item: Json) => item.purpose === 'photo_video_website' && item.version === 1).id,
    })
    assert.equal(outdated.statusCode, 409)
    assert.equal(outdated.json().code, 'consent_text_outdated')

    // Yeniden rıza gerektirmeyen yeni sürüm eski rızayı geçerli bırakır.
    await consentText(w.admin, 'photo_video_sharing', { title: 'Yazım düzeltmesi' })
    assert.equal((await status(w.parent.cookie, 'studentId=s1')).photo_video_sharing, true)
    const widened = await consentText(w.admin, 'photo_video_sharing', {
      title: 'Amaç genişledi',
      requiresReconsent: true,
    })
    assert.equal((await status(w.parent.cookie, 'studentId=s1')).photo_video_sharing, false)
    const text = await read(w.parent.cookie, '/api/v1/consent-texts/photo_video_sharing')
    assert.equal(text.json().data.minimumVersion, widened.version)

    // Geçersiz kalan satır yeni rızada `renewed` ile kapanır.
    const renewed = await give(w.parent.cookie, {
      purpose: 'photo_video_sharing',
      studentId: 's1',
      textId: widened.id,
    })
    assert.equal(renewed.statusCode, 201, renewed.body)
    const old = (await consentRows(w.id)).find((row) => row.id === given.json().data.id)
    assert.equal(old?.withdrawalReason, 'renewed')
    assert.equal((await status(w.parent.cookie, 'studentId=s1')).photo_video_sharing, true)
  })

  test('DOM-YTK-058 eğitim yılı tanımsız kurumda eğitim yılı rızası 422', async () => {
    const w = await world({ academicYear: null })
    const response = await give(w.parent.cookie, {
      purpose: 'photo_video_sharing',
      studentId: 's1',
      textId: w.texts.sharing.id,
    })
    assert.equal(response.statusCode, 422)
    assert.equal(response.json().code, 'academic_year_required')
    // Geri çekilene kadar süren amaç eğitim yılına bağlı değildir.
    const speaking = await give(w.parent.cookie, {
      purpose: 'speaking_recording',
      studentId: 's1',
      textId: w.texts.speaking.id,
    })
    assert.equal(speaking.statusCode, 201, speaking.body)
    assert.equal(speaking.json().data.expiresAt, '2027-10-06T21:00:00.000Z')
  })

  test('başka kurum: kayıt ve metin 404, B değişmez; listede B yok', async () => {
    const a = await world()
    const b = await world()
    const given = await give(b.parent.cookie, {
      purpose: 'photo_video_sharing',
      studentId: 's1',
      textId: b.texts.sharing.id,
    })
    assert.equal(given.statusCode, 201)
    const id = given.json().data.id as string

    const cross = await withdraw(a.parent.cookie, id)
    assert.equal(cross.statusCode, 404)
    const [row] = await consentRows(b.id)
    assert.equal(row?.withdrawnAt, null)
    assert.equal(row?.version, 1)

    // A'nın metniyle B'nin değil kendi kurumunun rızası istenir; B'nin metni A'da yoktur.
    const foreignText = await give(a.parent.cookie, {
      purpose: 'photo_video_sharing',
      studentId: 's1',
      textId: b.texts.sharing.id,
    })
    assert.equal(foreignText.statusCode, 404)
    assert.equal((await consentRows(a.id)).length, 0)
    const ack = await send(
      'POST',
      `/api/v1/privacy-notices/${b.parentNotice.id}/acknowledge`,
      a.parent.cookie,
      { channel: 'web' },
    )
    assert.equal(ack.statusCode, 404)

    const list = await read(a.admin, '/api/v1/consents?studentId=s1&status=all')
    assert.equal(list.json().meta.total, 0)
    assert.equal((await status(a.admin, 'studentId=s1')).photo_video_sharing, false)
    const notices = await read(a.admin, '/api/v1/privacy-notices?pageSize=100')
    const ids = new Set((notices.json().data as Json[]).map((item) => item.id))
    assert.equal(ids.has(b.parentNotice.id), false)
    assert.equal(ids.has(a.parentNotice.id), true)
  })
})
