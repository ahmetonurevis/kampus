import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq } from 'drizzle-orm'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { findRecord, insertMissingRecords, loadRecords } from '../src/db/records.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { institutions } from '../src/db/schema/auth.ts'
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
 * Siteye gömülen ön başvuru formu (ON-133; DOM-KAY-002, -003, -004, -007, -009; IST-145). Her test
 * kendi kurumunu kurar. Açık uçlarda yalnız form anahtarı kullanılır; hız sınırı IP başına olduğu
 * için her istek ayrı adresten gelir, sınır testi aynı adresi tekrarlar.
 */

const SEED = createSeed(FIXED_NOW)
const SETTINGS = '/api/v1/prospects/application-form'
const PUBLIC = '/api/v1/prospects/application-forms'
const SITE = 'https://okul.example'
const UNKNOWN_KEY = 'a'.repeat(32)
const SECRET_PHONE = '05329998877'
const SECRET_EMAIL = 'gizli.basvuran@ornek.example'
const SECRET_NAME = 'Gizli Basvuran'
const SECRET_GUARDIAN = 'Gizli Veli'

type Json = Record<string, unknown>

describe('Ön başvuru formu (ON-133)', () => {
  let app: App
  let db: Database
  let close: () => Promise<void>
  const logs: string[] = []

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { logs })
  })
  after(async () => {
    await app.close()
    await close()
  })

  function adminCall(
    method: 'GET' | 'PATCH' | 'POST',
    url: string,
    cookie: string | null,
    body?: unknown,
    version?: number,
  ) {
    return app.inject({
      method,
      url,
      remoteAddress: nextIp(),
      headers: {
        origin: TEST_ORIGIN,
        ...(cookie === null ? {} : { cookie }),
        ...(version === undefined ? {} : { 'if-match': `"${version}"` }),
      },
      ...(body === undefined ? {} : { payload: body as Json }),
    })
  }

  const openGet = (formKey: string, suffix = '', ip = nextIp()) =>
    app.inject({ method: 'GET', url: `${PUBLIC}/${formKey}${suffix}`, remoteAddress: ip })

  const submit = (
    formKey: string,
    body: unknown,
    { ip = nextIp(), headers = { origin: TEST_ORIGIN } as Record<string, string> } = {},
  ) =>
    app.inject({
      method: 'POST',
      url: `${PUBLIC}/${formKey}/submissions`,
      remoteAddress: ip,
      headers,
      payload: body as Json,
    })

  const application = (overrides: Json = {}): Json => ({
    name: SECRET_NAME,
    phone: SECRET_PHONE,
    branchId: 'b1',
    interest: '7. sınıf',
    guardianName: SECRET_GUARDIAN,
    privacyNoticeVersion: '1',
    ...overrides,
  })

  async function publishNotice(cookie: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy-notices',
      remoteAddress: nextIp(),
      headers: { origin: TEST_ORIGIN, cookie, 'idempotency-key': randomUUID() },
      payload: { kind: 'notice', audience: 'aday', title: 'Aday aydınlatması', body: 'Metin.' },
    })
    assert.equal(response.statusCode, 201, response.body)
  }

  /** Kurum, kampüsler, seed adayı pr1; varsayılan olarak yayımlı metin ve açık form. */
  async function world(
    overrides: Partial<InstitutionOverrides> = {},
    { open = true, notice = true } = {},
  ) {
    const institution = await createInstitution(app, overrides)
    await insertMissingRecords(
      db,
      institution.id,
      [
        ...SEED.branches.map((data) => ({ collection: 'branches' as const, id: data.id, data })),
        ...SEED.prospects
          .slice(0, 1)
          .map((data) => ({ collection: 'prospects' as const, id: data.id, data })),
      ],
      FIXED_NOW,
    )
    const admin = await signInAs(app, institution.admin)
    if (notice) await publishNotice(admin)
    const created = await adminCall('POST', `${SETTINGS}/rotate-key`, admin)
    assert.equal(created.statusCode, 200, created.body)
    let form = created.json().data as { formKey: string; version: number; enabled: boolean }
    if (open) {
      const opened = await adminCall(
        'PATCH',
        SETTINGS,
        admin,
        { enabled: true, siteOrigin: SITE },
        form.version,
      )
      assert.equal(opened.statusCode, 200, opened.body)
      form = opened.json().data
    }
    return { institution, admin, form }
  }

  const prospectsOf = async (institutionId: string) =>
    (await loadRecords(db, institutionId, ['prospects'])).map((row) => row.data as Json)

  // --- Açık veri -----------------------------------------------------------------------------

  test('DOM-KAY-003: form verisi kurum adı, aktif kampüs ve güncel aydınlatma metnidir; oturum ve çerez gerekmez', async () => {
    const { institution, form } = await world({ name: 'Kurum Formu' })
    const response = await openGet(form.formKey)
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.headers['set-cookie'], undefined)
    const data = response.json().data
    assert.equal(data.institutionName, 'Kurum Formu')
    assert.equal(data.asksAgeGroup, false)
    assert.equal(data.siteOrigin, SITE)
    assert.deepEqual(data.notice, { version: '1', title: 'Aday aydınlatması', body: 'Metin.' })
    assert.ok(data.branches.some((branch: Json) => branch.id === 'b1'))
    assert.ok(data.branches.every((branch: Json) => Object.keys(branch).length === 2))
    assert.equal(JSON.stringify(data).includes(institution.id), false)
  })

  test('DOM-KAY-009: dil okulunda yaş grubu sorulur', async () => {
    const { form } = await world({ type: 'language_school' })
    assert.equal((await openGet(form.formKey)).json().data.asksAgeGroup, true)
  })

  test('geçersiz anahtar ve biçimi bozuk anahtar aynı 404, gönderimde de', async () => {
    for (const key of [UNKNOWN_KEY, 'kisa', 'x'.repeat(60)]) {
      const read = await openGet(key)
      assert.equal(read.statusCode, 404, key)
      assert.equal(read.json().code, 'not_found')
      const written = await submit(key, application())
      assert.equal(written.statusCode, 404, key)
      assert.equal(written.json().code, 'not_found')
    }
  })

  test('iptal: yenilenen anahtarın eskisi 404, yenisi çalışır; kapatılan form 404 ve kayıt yazılmaz', async () => {
    const { institution, admin, form } = await world()
    const rotated = await adminCall(
      'POST',
      `${SETTINGS}/rotate-key`,
      admin,
      undefined,
      form.version,
    )
    assert.equal(rotated.statusCode, 200, rotated.body)
    const next = rotated.json().data
    assert.notEqual(next.formKey, form.formKey)
    assert.equal(next.enabled, true)
    assert.equal((await openGet(form.formKey)).statusCode, 404)
    assert.equal((await submit(form.formKey, application())).statusCode, 404)
    assert.equal((await openGet(next.formKey)).statusCode, 200)

    const closed = await adminCall('PATCH', SETTINGS, admin, { enabled: false }, next.version)
    assert.equal(closed.statusCode, 200, closed.body)
    const before = await prospectsOf(institution.id)
    assert.equal((await openGet(next.formKey)).statusCode, 404)
    assert.equal((await submit(next.formKey, application())).statusCode, 404)
    assert.deepEqual(await prospectsOf(institution.id), before)
    assert.equal(
      (await openGet(next.formKey, '/frame-policy')).json().data.frameAncestors,
      "'none'",
    )
  })

  test('IST-009: crm modülü kapalıyken açık uçlar 404, yönetici 403 module_disabled, kayıt yazılmaz', async () => {
    const { institution, admin, form } = await world()
    await db
      .update(institutions)
      .set({ enabledModules: { crm: false } })
      .where(eq(institutions.id, institution.id))
    const before = await prospectsOf(institution.id)
    assert.equal((await openGet(form.formKey)).statusCode, 404)
    assert.equal((await submit(form.formKey, application())).statusCode, 404)
    assert.deepEqual(await prospectsOf(institution.id), before)
    const settings = await adminCall('GET', SETTINGS, admin)
    assert.equal(settings.statusCode, 403)
    assert.equal(settings.json().code, 'module_disabled')
  })

  test('DOM-KAY-003: aydınlatma yayımlanmadan form açılamaz; aktif kampüs yoksa form 404', async () => {
    const { admin, form } = await world({}, { open: false, notice: false })
    const closed = await adminCall('GET', SETTINGS, admin)
    assert.equal(closed.json().data.noticeVersion, null)
    const opened = await adminCall('PATCH', SETTINGS, admin, { enabled: true }, form.version)
    assert.equal(opened.statusCode, 422)
    assert.equal(opened.json().code, 'application_form_notice_missing')
    assert.equal((await adminCall('GET', SETTINGS, admin)).json().data.enabled, false)
    assert.equal((await openGet(form.formKey)).statusCode, 404)

    const empty = await createInstitution(app)
    const cookie = await signInAs(app, empty.admin)
    await publishNotice(cookie)
    const first = (await adminCall('POST', `${SETTINGS}/rotate-key`, cookie)).json().data
    await adminCall('PATCH', SETTINGS, cookie, { enabled: true }, first.version)
    assert.equal((await openGet(first.formKey)).statusCode, 404)
  })

  // --- Gönderim ------------------------------------------------------------------------------

  test('DOM-KAY-009, DOM-KAY-007: başvuru Yeni aday, Web sitesi kaynaklı yazılır; aydınlatma sürümü saklanır, onay kapalı', async () => {
    const { institution, form } = await world()
    const response = await submit(form.formKey, application())
    assert.equal(response.statusCode, 202, response.body)
    assert.deepEqual(response.json().data, { received: true })
    assert.equal(response.headers['set-cookie'], undefined)
    const created = (await prospectsOf(institution.id)).find((item) => item.phone === SECRET_PHONE)
    assert.ok(created)
    assert.equal(created.stage, 'Yeni aday')
    assert.equal(created.source, 'Web sitesi')
    assert.equal(created.guardianName, SECRET_GUARDIAN)
    assert.deepEqual(created.privacyNotice, { version: '1', shownAt: FIXED_NOW.toISOString() })
    const consent = created.marketingConsent as Record<string, { granted: boolean }>
    assert.equal(consent.sms?.granted, false)
    assert.equal(consent.email?.granted, false)
    assert.equal(consent.call?.granted, false)
  })

  test('DOM-KAY-004: ticari ileti onayı kanal başına işaretlenince yazılır', async () => {
    const { institution, form } = await world()
    const response = await submit(
      form.formKey,
      application({ email: SECRET_EMAIL, marketingConsent: { email: true } }),
    )
    assert.equal(response.statusCode, 202, response.body)
    const created = (await prospectsOf(institution.id)).find((item) => item.phone === SECRET_PHONE)
    const consent = created?.marketingConsent as Record<string, Json>
    assert.equal(consent.email?.granted, true)
    assert.equal(consent.email?.verified, false)
    assert.equal(consent.sms?.granted, false)
    assert.equal('verified' in (consent.sms ?? {}), false)
  })

  test('DOM-KAY-004: formdan gelen onayı personel mevcut uçtan doğrular ya da geri alır; işaret kalkar', async () => {
    const { institution, admin, form } = await world()
    await submit(form.formKey, application({ marketingConsent: { sms: true, call: true } }))
    const created = (await prospectsOf(institution.id)).find((item) => item.phone === SECRET_PHONE)
    const id = String(created?.id)
    const consent = async (body: Json) => {
      const row = await findRecord(db, institution.id, 'prospects', id)
      const url = `/api/v1/prospects/${id}/marketing-consent`
      return adminCall('POST', url, admin, body, row?.version)
    }

    const verified = await consent({ channel: 'sms', granted: true })
    assert.equal(verified.statusCode, 200, verified.body)
    const withdrawn = await consent({ channel: 'call', granted: false })
    assert.equal(withdrawn.statusCode, 200, withdrawn.body)
    const again = await consent({ channel: 'sms', granted: true })
    assert.equal(again.statusCode, 409)
    assert.equal(again.json().code, 'marketing_consent_unchanged')

    const stored = await findRecord(db, institution.id, 'prospects', id)
    const after = stored?.data.marketingConsent as Record<string, Json>
    assert.equal(after.sms?.granted, true)
    assert.equal('verified' in (after.sms ?? {}), false)
    assert.equal(after.call?.granted, false)
    const history = stored?.data.marketingConsentHistory as Json[]
    assert.equal(history[0]?.verified, true)
    assert.equal('verified' in (history[1] ?? {}), false)
  })

  test('DOM-KAY-009: 400 eksik ve yasak alanda; 422 velisiz ve pasif kampüste; 409 eski aydınlatma; kayıt değişmez', async () => {
    const { institution, form } = await world()
    const before = await prospectsOf(institution.id)
    const rejected = [
      [400, application({ phone: 'telefon' })],
      [400, application({ privacyNoticeVersion: '' })],
      [400, application({ identityNumber: '11111111110' })],
      [400, application({ birthDate: '2012-01-01' })],
      [400, application({ address: 'Merkez' })],
      [400, application({ source: 'Telefon' })],
      [400, application({ institutionId: 'kurum-b' })],
      [422, application({ guardianName: undefined })],
      [422, application({ branchId: 'yok' })],
      [409, application({ privacyNoticeVersion: '99' })],
    ] as const
    for (const [status, body] of rejected)
      assert.equal(
        (await submit(form.formKey, body)).statusCode,
        status,
        JSON.stringify(Object.keys(body)),
      )
    assert.deepEqual(await prospectsOf(institution.id), before)
  })

  test('DOM-KAY-002: mükerrer başvuru aynı yanıtı alır, yeni aday açılmaz, karta sabit not düşer', async () => {
    const { institution, form } = await world()
    const seed = SEED.prospects[0]
    assert.ok(seed)
    const fresh = await submit(form.formKey, application())
    const repeat = await submit(
      form.formKey,
      application({ name: seed.name, phone: seed.phone, marketingConsent: { sms: true } }),
    )
    assert.equal(repeat.statusCode, fresh.statusCode)
    assert.deepEqual(repeat.json(), fresh.json())
    assert.deepEqual(Object.keys(repeat.headers).sort(), Object.keys(fresh.headers).sort())
    const rows = await prospectsOf(institution.id)
    assert.equal(rows.length, 2)
    const stored = await findRecord(db, institution.id, 'prospects', seed.id)
    const notes = stored?.data.notes as Json[]
    assert.equal(notes[0]?.author, 'Web sitesi formu')
    assert.equal(notes[0]?.text, 'Web sitesi formundan yeniden başvuru alındı.')
    assert.deepEqual(stored?.data.marketingConsent, seed.marketingConsent)

    // Aynı gönderim tekrarı (çift tıklama): yanıt aynı, yeni not yok.
    const again = await submit(form.formKey, application({ name: seed.name, phone: seed.phone }))
    assert.equal(again.statusCode, 202)
    const after = await findRecord(db, institution.id, 'prospects', seed.id)
    assert.equal((after?.data.notes as Json[]).length, notes.length)

    // Denetim: not satırı sistem aktörüyle; yazmayan tekrar gönderimin satırı yoktur.
    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institution.id),
          eq(auditLog.action, 'prospect.application'),
          eq(auditLog.entityId, seed.id),
        ),
      )
    assert.equal(audit.length, 1)
    assert.equal(audit[0]?.actorUserId, null)
    assert.deepEqual(audit[0]?.changes, { fields: ['notes', 'updatedAt'] })
  })

  test('yeni aday core sırasıyla başa yazılır, mevcut adayın sürümü değişmez', async () => {
    const { institution, form } = await world()
    const seed = SEED.prospects[0]
    assert.ok(seed)
    const before = await findRecord(db, institution.id, 'prospects', seed.id)
    assert.equal((await submit(form.formKey, application())).statusCode, 202)
    const rows = await prospectsOf(institution.id)
    assert.equal(rows[0]?.phone, SECRET_PHONE)
    assert.equal(rows[1]?.id, seed.id)
    const after = await findRecord(db, institution.id, 'prospects', seed.id)
    assert.equal(after?.version, before?.version)
  })

  test('IST-145: gizli alan dolu gönderim aynı yanıtı alır, hiçbir şey yazmaz', async () => {
    const { institution, form } = await world()
    const before = await prospectsOf(institution.id)
    const response = await submit(form.formKey, application({ website: 'http://spam.example' }))
    assert.equal(response.statusCode, 202)
    assert.deepEqual(response.json().data, { received: true })
    assert.deepEqual(await prospectsOf(institution.id), before)
  })

  test('başka kurum: anahtar yalnız kendi kurumuna yazar; gövdedeki institutionId 400 ve B değişmez', async () => {
    const a = await world()
    const b = await world()
    const bBefore = await prospectsOf(b.institution.id)
    await db
      .update(institutions)
      .set({ name: 'B Kurumu' })
      .where(eq(institutions.id, b.institution.id))
    const data = (await openGet(a.form.formKey)).json().data
    assert.notEqual(data.institutionName, 'B Kurumu')

    const stray = await submit(a.form.formKey, application({ institutionId: b.institution.id }))
    assert.equal(stray.statusCode, 400)
    assert.equal((await submit(a.form.formKey, application())).statusCode, 202)
    // Her iki kurumda da aynı seed adayı var: A anahtarıyla gelen mükerrer yalnız A kartına not düşer.
    const seed = SEED.prospects[0]
    assert.ok(seed)
    const repeat = application({ name: seed.name, phone: seed.phone })
    assert.equal((await submit(a.form.formKey, repeat)).statusCode, 202)
    assert.deepEqual(await prospectsOf(b.institution.id), bBefore)
    assert.ok((await prospectsOf(a.institution.id)).some((item) => item.phone === SECRET_PHONE))
  })

  test('başka kurum: yönetici ayarı yalnız kendi formudur, sürüm tutmazsa 409 ve B değişmez', async () => {
    const a = await world()
    const b = await world()
    const own = (await adminCall('GET', SETTINGS, a.admin)).json().data
    assert.equal(own.formKey, a.form.formKey)
    const stale = await adminCall('PATCH', SETTINGS, a.admin, { enabled: false }, own.version + 5)
    assert.equal(stale.statusCode, 409)
    assert.equal(stale.json().code, 'version_conflict')
    const stray = await adminCall(
      'PATCH',
      SETTINGS,
      a.admin,
      { enabled: false, institutionId: b.institution.id },
      own.version,
    )
    assert.equal(stray.statusCode, 400)
    const rotated = await adminCall(
      'POST',
      `${SETTINGS}/rotate-key`,
      a.admin,
      { institutionId: b.institution.id },
      own.version,
    )
    assert.equal(rotated.statusCode, 200, rotated.body)
    assert.notEqual(rotated.json().data.formKey, a.form.formKey)
    const other = (await adminCall('GET', SETTINGS, b.admin)).json().data
    assert.equal(other.enabled, true)
    assert.equal(other.formKey, b.form.formKey)
    assert.equal((await openGet(b.form.formKey)).statusCode, 200)
  })

  // --- Kötüye kullanım --------------------------------------------------------------------------

  test('IST-145: gönderim IP başına sınırlıdır, 429 + Retry-After ve aşan istek yazılmaz', async () => {
    const { institution, form } = await world()
    const ip = nextIp()
    const statuses: number[] = []
    for (let index = 0; index < 6; index += 1)
      statuses.push(
        (
          await submit(
            form.formKey,
            application({ phone: `0532000000${index}`, name: `Aday Sınır ${index}` }),
            { ip },
          )
        ).statusCode,
      )
    assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429])
    const limited = await submit(form.formKey, application(), { ip })
    assert.equal(limited.statusCode, 429)
    assert.equal(limited.json().code, 'rate_limited')
    assert.ok(Number(limited.headers['retry-after']) > 0)
    const written = (await prospectsOf(institution.id)).filter(
      (item) => typeof item.name === 'string' && item.name.startsWith('Aday Sınır'),
    )
    assert.equal(written.length, 5)
    // Başka IP etkilenmez.
    assert.equal((await submit(form.formKey, application())).statusCode, 202)
  })

  test('gövde sınırı: 4 KB üstü 413 ve kayıt değişmez', async () => {
    const { institution, form } = await world()
    const before = await prospectsOf(institution.id)
    const response = await submit(form.formKey, application({ website: 'x'.repeat(5000) }))
    assert.equal(response.statusCode, 413)
    assert.deepEqual(await prospectsOf(institution.id), before)
  })

  test('CSRF: başka köken ve cross-site gönderim 403 csrf_rejected; kurum sitesi de doğrudan gönderemez, kayıt değişmez', async () => {
    const { institution, form } = await world()
    const before = await prospectsOf(institution.id)
    const rejectedHeaders: Record<string, string>[] = [
      { origin: SITE },
      { origin: 'https://kotu.example' },
      { 'sec-fetch-site': 'cross-site' },
    ]
    for (const headers of rejectedHeaders) {
      const response = await submit(form.formKey, application(), { headers })
      assert.equal(response.statusCode, 403)
      assert.equal(response.json().code, 'csrf_rejected')
    }
    assert.deepEqual(await prospectsOf(institution.id), before)
    // Form kendi kökenimizdeki sayfada çalışır: izinli köken geçer.
    assert.equal((await submit(form.formKey, application())).statusCode, 202)
    // Genel CORS listesine kurum sitesi eklenmez.
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: `${PUBLIC}/${form.formKey}/submissions`,
      remoteAddress: nextIp(),
      headers: { origin: SITE, 'access-control-request-method': 'POST' },
    })
    assert.equal(preflight.headers['access-control-allow-origin'], undefined)
  })

  test('KVKK: telefon, e-posta, ad ve veli adı loga ve denetime yazılmaz', async () => {
    const { institution, form } = await world()
    logs.length = 0
    const accepted = await submit(form.formKey, application({ email: SECRET_EMAIL }))
    assert.equal(accepted.statusCode, 202, accepted.body)
    await submit(form.formKey, application({ email: SECRET_EMAIL, phone: 'bozuk' }))
    const text = logs.join('\n')
    assert.ok(text.includes('prospect.application'), 'işlem logu beklenir')
    for (const secret of [SECRET_PHONE, SECRET_EMAIL, SECRET_NAME, SECRET_GUARDIAN, 'bozuk'])
      assert.equal(text.includes(secret), false, secret)

    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institution.id),
          eq(auditLog.action, 'prospect.application'),
        ),
      )
    assert.equal(audit.length, 1)
    // Aktör sistemdir: hiçbir kullanıcıya ve üyelik rolüne bağlanmaz.
    assert.equal(audit[0]?.actorUserId, null)
    assert.equal(audit[0]?.actorRole, 'system')
    assert.ok(audit[0]?.changes?.fields?.includes('phone'))
    for (const secret of [SECRET_PHONE, SECRET_EMAIL, SECRET_NAME, SECRET_GUARDIAN])
      assert.equal(JSON.stringify(audit[0]).includes(secret), false, secret)
  })

  test('denetim ekranı form gönderimini sistem aktörüyle gösterir', async () => {
    const { admin, form } = await world()
    assert.equal((await submit(form.formKey, application())).statusCode, 202)
    const response = await adminCall('GET', '/api/v1/audit-events', admin)
    assert.equal(response.statusCode, 200, response.body)
    const rows = response.json().data as Json[]
    const row = rows.find((item) => item.action === 'prospect.application')
    assert.ok(row)
    // `null` aktör ekranda "Sistem"dir; ön büro yapmış görünmez.
    assert.equal(row.actor, null)
  })

  // --- Çerçeve politikası -----------------------------------------------------------------------

  test('IST-145: frame-policy kurum sitesini verir; site adresi yoksa, anahtar geçersizse none', async () => {
    const { admin, form } = await world()
    const open = await openGet(form.formKey, '/frame-policy')
    assert.equal(open.statusCode, 200)
    assert.equal(open.json().data.frameAncestors, SITE)
    assert.equal(open.headers['x-frame-ancestors'], SITE)

    const removed = await adminCall('PATCH', SETTINGS, admin, { siteOrigin: null }, form.version)
    assert.equal(removed.statusCode, 200, removed.body)
    assert.equal(removed.json().data.siteOrigin, null)
    assert.equal(
      (await openGet(form.formKey, '/frame-policy')).headers['x-frame-ancestors'],
      "'none'",
    )
    assert.equal(
      (await openGet(UNKNOWN_KEY, '/frame-policy')).headers['x-frame-ancestors'],
      "'none'",
    )
  })

  // --- Yönetici ----------------------------------------------------------------------------------

  test('401: oturumsuz yönetici uçları; 403: ön büro ve öğretmen', async () => {
    const institution = await createInstitution(app)
    const calls = [
      ['GET', SETTINGS, undefined],
      ['PATCH', SETTINGS, { enabled: true }],
      ['POST', `${SETTINGS}/rotate-key`, undefined],
    ] as const
    for (const [method, url, body] of calls)
      assert.equal((await adminCall(method, url, null, body, 1)).statusCode, 401, url)
    for (const role of ['onburo', 'ogretmen'] as const) {
      const member = await createMember(app, institution.id, role)
      const cookie = await signInAs(app, member)
      for (const [method, url, body] of calls) {
        const response = await adminCall(method, url, cookie, body, 1)
        assert.equal(response.statusCode, 403, `${role} ${url}`)
        assert.equal(response.json().code, 'forbidden')
      }
    }
  })

  test('ilk anahtar form kapalı üretilir, ayar ilk anahtardan önce 404; denetime anahtar yazılmaz', async () => {
    const institution = await createInstitution(app)
    const admin = await signInAs(app, institution.admin)
    const empty = await adminCall('GET', SETTINGS, admin)
    assert.deepEqual(empty.json().data, {
      enabled: false,
      formKey: null,
      siteOrigin: null,
      version: null,
      noticeVersion: null,
    })
    const early = await adminCall('PATCH', SETTINGS, admin, { siteOrigin: SITE }, 1)
    assert.equal(early.statusCode, 404)
    const created = await adminCall('POST', `${SETTINGS}/rotate-key`, admin)
    const form = created.json().data
    assert.equal(form.enabled, false)
    assert.match(form.formKey, /^[A-Za-z0-9_-]{32}$/)
    assert.equal((await openGet(form.formKey)).statusCode, 404)

    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.institutionId, institution.id),
          eq(auditLog.action, 'prospect.application_form.rotate_key'),
        ),
      )
    assert.equal(audit.length, 1)
    assert.equal(JSON.stringify(audit[0]).includes(form.formKey), false)
  })

  test('yenilemede If-Match zorunlu, bayat sürüm 409; bozuk site adresi 400 ve kayıt değişmez', async () => {
    const { admin, form } = await world()
    const missing = await adminCall('POST', `${SETTINGS}/rotate-key`, admin)
    assert.equal(missing.statusCode, 400)
    assert.equal(missing.json().code, 'if_match_required')
    const stale = await adminCall(
      'POST',
      `${SETTINGS}/rotate-key`,
      admin,
      undefined,
      form.version + 9,
    )
    assert.equal(stale.statusCode, 409)
    const patchMissing = await adminCall('PATCH', SETTINGS, admin, { enabled: false })
    assert.equal(patchMissing.json().code, 'if_match_required')
    for (const siteOrigin of [
      'http://okul.example',
      'https://okul.example/basvuru',
      "https://okul.example; script-src 'unsafe-inline'",
    ]) {
      const bad = await adminCall('PATCH', SETTINGS, admin, { siteOrigin }, form.version)
      assert.equal(bad.statusCode, 400, siteOrigin)
    }
    const after = (await adminCall('GET', SETTINGS, admin)).json().data
    assert.equal(after.formKey, form.formKey)
    assert.equal(after.siteOrigin, SITE)
    assert.equal(after.version, form.version)
  })
})
