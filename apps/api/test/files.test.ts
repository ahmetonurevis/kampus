import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { and, eq, sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Role } from '../src/auth.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import { institutions } from '../src/db/schema/auth.ts'
import { markFileDeleted } from '../src/db/files.ts'
import { files } from '../src/db/schema/files.ts'
import { institutionSettings } from '../src/db/schema/institution-settings.ts'
import type { ServiceContext } from '../src/plugins/authenticate.ts'
import { defineFileAttachment } from '../src/services/file-registry.ts'
import { attachFile, purgeUnattachedFiles, recordFileCheck } from '../src/services/files.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
  type TestUser,
} from './support/app.ts'
import { MP3, multipart, PDF, png, tempStorage, TEXT, uploadParts } from './support/files-sample.ts'

/**
 * Dosya uçları (F3c2a; ADR 0003 karar 2–6, 13; DOM-KYN-004, DOM-BEC-050, DOM-BEC-053,
 * DOM-YTK-052): akışla yükleme, içerikten tür, boyut 413 ve nesnenin silinmesi, kota, amaç × rol,
 * modül ve kurum kapsamı, imzalı bağlantı ve süresi, bağlama ve bağlanmamış dosya temizliği.
 */

type Json = ReturnType<typeof JSON.parse>

/** Testin bağlı kayıt türü: kaydı yalnız `readers` kümesindeki kullanıcı okur. */
const TEST_ATTACHMENT = 'test_record'
const readers = new Set<string>()
defineFileAttachment(TEST_ATTACHMENT, {
  purposes: ['submission'],
  canRead: async (_tx, ctx) => readers.has(ctx.actor.userId),
})

describe('dosya uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let now = FIXED_NOW
  const logs: string[] = []
  let serial = 0

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, clock: () => now, logs })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  async function tenant(enabledModules?: Record<string, boolean>) {
    const institution = await createInstitution(app, enabledModules ? { enabledModules } : {})
    const member = async (role: Role) => {
      const user = await createMember(app, institution.id, role)
      return { ...user, cookie: await signInAs(app, user) }
    }
    return {
      institution,
      admin: { ...institution.admin, cookie: await signInAs(app, institution.admin) },
      teacher: await member('ogretmen'),
      student: await member('ogrenci'),
      otherStudent: await member('ogrenci'),
      parent: await member('veli'),
      frontDesk: await member('onburo'),
    }
  }

  const nextKey = () => `test-file-${String(++serial).padStart(6, '0')}`

  function upload(
    cookie: string | null,
    parts: ReturnType<typeof uploadParts>,
    key: string | null = nextKey(),
  ) {
    const body = multipart(parts)
    return app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        'content-type': body.contentType,
        ...(cookie ? { cookie } : {}),
        ...(key ? { 'idempotency-key': key } : {}),
      },
      payload: body.payload,
    })
  }

  const get = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })

  async function rowsOf(institutionId: string) {
    return db.select().from(files).where(eq(files.institutionId, institutionId))
  }

  function contextFor(
    institutionId: string,
    user: TestUser & { membershipId: string },
    role: Role,
  ) {
    return {
      db,
      institutionId,
      actor: { userId: user.id, role, membershipId: user.membershipId },
      now,
      log: app.log,
    } satisfies ServiceContext
  }

  test('oturumsuz yükleme 401, dosya yazılmaz', async () => {
    const before = (await store.files()).length
    const response = await upload(null, uploadParts('submission', PDF))
    assert.equal(response.statusCode, 401)
    assert.equal((await store.files()).length, before)
  })

  test('DOM-KYN-004 öğrenci teslim dosyası yükler: 201, Location, SHA-256, boyut, içerikten tür; ad log ve denetime girmez', async () => {
    const t = await tenant()
    const response = await upload(
      t.student.cookie,
      uploadParts('submission', PDF, 'Deniz Yılmaz ödev.pdf', 'application/octet-stream'),
    )
    assert.equal(response.statusCode, 201, response.body)
    const data: Json = response.json().data
    assert.equal(response.headers.location, `/api/v1/files/${data.id}`)
    assert.equal(data.purpose, 'submission')
    assert.equal(data.status, 'pending')
    assert.equal(data.contentType, 'application/pdf')
    assert.equal(data.byteSize, PDF.length)
    assert.equal(data.sha256, createHash('sha256').update(PDF).digest('hex'))
    assert.equal(data.originalName, 'Deniz Yılmaz ödev.pdf')
    assert.equal(data.attached, false)

    const [row] = await rowsOf(t.institution.id)
    assert.ok(row)
    assert.match(row.storageKey, new RegExp(`^${t.institution.id}/submission/2026/10/${data.id}$`))
    assert.equal(row.uploadedByUserId, t.student.id)
    assert.ok((await store.storage.head(row.storageKey))?.byteSize === PDF.length)

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.action, 'file.upload')))
    assert.equal(audits.length, 1)
    assert.equal(JSON.stringify(audits[0]).includes('Deniz'), false)
    assert.equal(
      logs.some((line) => line.includes('Deniz Yılmaz')),
      false,
    )
  })

  test('Idempotency-Key: aynı anahtar ve içerik ilk yanıtı tekrarlar, ikinci nesne kalmaz; anahtarsız 400', async () => {
    const t = await tenant()
    const key = nextKey()
    const first = await upload(t.student.cookie, uploadParts('submission', PDF), key)
    const objects = (await store.files()).length
    const second = await upload(t.student.cookie, uploadParts('submission', PDF), key)
    assert.equal(first.statusCode, 201)
    assert.equal(second.statusCode, 201)
    assert.equal(second.headers['idempotent-replayed'], 'true')
    assert.equal(second.json().data.id, first.json().data.id)
    assert.equal((await rowsOf(t.institution.id)).length, 1)
    assert.equal((await store.files()).length, objects)

    const missing = await upload(t.student.cookie, uploadParts('submission', PDF), null)
    assert.equal(missing.statusCode, 400)
    assert.equal(missing.json().code, 'idempotency_key_required')
    assert.equal((await rowsOf(t.institution.id)).length, 1)
  })

  test('amaç × rol: teslim yalnız öğrenci, materyal personel, kurum belgesi yönetici ve ön büro', async () => {
    const t = await tenant()
    const cases: [string, string, Buffer, string, string, number][] = [
      ['student', 'submission', PDF, 'a.pdf', 'application/pdf', 201],
      ['teacher', 'submission', PDF, 'a.pdf', 'application/pdf', 403],
      ['parent', 'submission', PDF, 'a.pdf', 'application/pdf', 403],
      ['teacher', 'material', PDF, 'a.pdf', 'application/pdf', 201],
      ['admin', 'listening_audio', MP3, 'a.mp3', 'audio/mpeg', 201],
      ['student', 'material', PDF, 'a.pdf', 'application/pdf', 403],
      ['frontDesk', 'material', PDF, 'a.pdf', 'application/pdf', 403],
      ['frontDesk', 'document', PDF, 'a.pdf', 'application/pdf', 201],
      ['teacher', 'document', PDF, 'a.pdf', 'application/pdf', 403],
      ['teacher', 'question_image', png(), 'a.png', 'image/png', 201],
    ]
    for (const [who, purpose, data, name, type, status] of cases) {
      const person = t[who as 'student']
      const response = await upload(person.cookie, uploadParts(purpose, data, name, type))
      assert.equal(response.statusCode, status, `${who} ${purpose}: ${response.body}`)
    }
    assert.equal((await rowsOf(t.institution.id)).length, 5)
  })

  test('DOM-BEC-050 konuşma kaydı rıza kaydı olmadan 403 consent_required; nesne yazılmaz', async () => {
    const t = await tenant()
    const before = (await store.files()).length
    const response = await upload(
      t.student.cookie,
      uploadParts('speaking_recording', MP3, 'kayit.mp3', 'audio/mpeg'),
    )
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'consent_required')
    assert.equal((await store.files()).length, before)
  })

  test('modül kapalı: learning amaçları 403 module_disabled, kurum belgesi açık', async () => {
    const t = await tenant({ learning: false })
    const material = await upload(t.teacher.cookie, uploadParts('material', PDF))
    assert.equal(material.statusCode, 403)
    assert.equal(material.json().code, 'module_disabled')
    const document = await upload(t.admin.cookie, uploadParts('document', PDF))
    assert.equal(document.statusCode, 201)
  })

  test('DOM-KYN-004 tür içerikten: tanınmayan, amaçta olmayan ve çelişen tür 422; boş dosya 422; nesne kalmaz', async () => {
    const t = await tenant()
    const before = (await store.files()).length
    const cases: [string, Buffer, string, string, string][] = [
      // İçerik tanınmıyorsa adı/bildirimi ne olursa olsun tür reddedilir.
      ['submission', TEXT, 'a.pdf', 'application/pdf', 'file_type_not_allowed'],
      ['submission', TEXT, 'notlar.txt', 'text/plain', 'file_type_not_allowed'],
      ['submission', MP3, 'a.mp3', 'audio/mpeg', 'file_type_not_allowed'],
      ['submission', PDF, 'resim.png', 'application/octet-stream', 'file_type_mismatch'],
      ['submission', PDF, 'a.pdf', 'image/png', 'file_type_mismatch'],
      ['submission', Buffer.alloc(0), 'bos.pdf', 'application/pdf', 'file_empty'],
    ]
    for (const [purpose, data, name, type, code] of cases) {
      const response = await upload(t.student.cookie, uploadParts(purpose, data, name, type))
      assert.equal(response.statusCode, 422, `${name}: ${response.body}`)
      assert.equal(response.json().code, code, name)
    }
    assert.equal((await rowsOf(t.institution.id)).length, 0)
    assert.equal((await store.files()).length, before)
  })

  test('DOM-KYN-004 bildirilen tür takma ad veya parametreli olabilir; çelişki yine 422', async () => {
    const t = await tenant()
    for (const type of ['audio/mp3', 'audio/mpeg; charset=binary', 'AUDIO/MPEG']) {
      const response = await upload(t.teacher.cookie, uploadParts('material', MP3, 'ses', type))
      assert.equal(response.statusCode, 201, `${type}: ${response.body}`)
      assert.equal(response.json().data.contentType, 'audio/mpeg')
    }
    const mismatch = await upload(
      t.teacher.cookie,
      uploadParts('material', MP3, 'ses', 'audio/x-m4a'),
    )
    assert.equal(mismatch.statusCode, 422)
    assert.equal(mismatch.json().code, 'file_type_mismatch')
  })

  test('nesne silinemezse asıl hata (422, 413) döner, silme hatası loglanır; ad loga girmez', async () => {
    const t = await tenant()
    store.storage.failDeletes = true
    try {
      const wrongType = await upload(
        t.student.cookie,
        uploadParts('submission', TEXT, 'Deniz Yılmaz rehberlik.pdf', 'application/pdf'),
      )
      assert.equal(wrongType.statusCode, 422, wrongType.body)
      assert.equal(wrongType.json().code, 'file_type_not_allowed')
      const tooBig = await upload(
        t.teacher.cookie,
        uploadParts('question_image', png(2 * 1024 * 1024 + 1), 'Deniz Yılmaz.png', 'image/png'),
      )
      assert.equal(tooBig.statusCode, 413, tooBig.body)
    } finally {
      store.storage.failDeletes = false
    }
    const failures = logs.filter((line) => line.includes('file.discard_object_failed'))
    assert.ok(failures.length >= 2, 'silme hatası loglanır')
    assert.ok(failures.every((line) => line.includes(`"storageKey":"${t.institution.id}/`)))
    assert.equal(
      logs.some((line) => line.includes('Deniz Yılmaz')),
      false,
    )
    assert.equal((await rowsOf(t.institution.id)).length, 0)
  })

  test('DOM-KYN-004 boyut sınırı: soru görseli 2 MB üstü 413, akış kesilir, nesne silinir', async () => {
    const t = await tenant()
    const before = (await store.files()).length
    const response = await upload(
      t.teacher.cookie,
      uploadParts('question_image', png(2 * 1024 * 1024 + 1), 'buyuk.png', 'image/png'),
    )
    assert.equal(response.statusCode, 413, response.body)
    assert.equal(response.json().code, 'file_too_large')
    assert.equal((await rowsOf(t.institution.id)).length, 0)
    assert.equal((await store.files()).length, before)
    const fits = await upload(
      t.teacher.cookie,
      uploadParts('question_image', png(2 * 1024 * 1024), 'sinirda.png', 'image/png'),
    )
    assert.equal(fits.statusCode, 201)
  })

  test('DOM-KYN-004 kurum kotası: aşan yükleme 422 storage_quota_exceeded, nesne silinir; silinen dosya sayılmaz', async () => {
    const t = await tenant()
    await db
      .update(institutionSettings)
      .set({ storageQuotaBytes: PDF.length * 2 })
      .where(eq(institutionSettings.institutionId, t.institution.id))
    assert.equal((await upload(t.student.cookie, uploadParts('submission', PDF))).statusCode, 201)
    assert.equal((await upload(t.student.cookie, uploadParts('submission', PDF))).statusCode, 201)
    const before = (await store.files()).length
    const over = await upload(t.student.cookie, uploadParts('submission', PDF))
    assert.equal(over.statusCode, 422)
    assert.equal(over.json().code, 'storage_quota_exceeded')
    assert.equal((await rowsOf(t.institution.id)).length, 2)
    assert.equal((await store.files()).length, before)
    // Başka kurumun kotası etkilenmez.
    const other = await tenant()
    assert.equal(
      (await upload(other.student.cookie, uploadParts('submission', PDF))).statusCode,
      201,
    )
  })

  test('çok parçalı olmayan gövde 415; amaç veya dosya yoksa ya da amaç geçersizse 400', async () => {
    const t = await tenant()
    const json = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: {
        origin: TEST_ORIGIN,
        cookie: t.student.cookie,
        'idempotency-key': nextKey(),
        'content-type': 'application/json',
      },
      payload: 'null',
    })
    assert.equal(json.statusCode, 415, json.body)
    const missing = await upload(t.student.cookie, [
      { name: 'file', fileName: 'a.pdf', contentType: 'application/pdf', data: PDF },
    ])
    assert.equal(missing.statusCode, 400)
    const noFile = await upload(t.student.cookie, [{ name: 'purpose', value: 'submission' }])
    assert.equal(noFile.statusCode, 400)
    const unknown = await upload(t.student.cookie, uploadParts('avatar', PDF))
    assert.equal(unknown.statusCode, 400)
    assert.equal((await rowsOf(t.institution.id)).length, 0)
  })

  test('ADR 0003 karar 6 bağlanmamış dosyayı yalnız yükleyen okur; başka kurum ve başkası 404', async () => {
    const t = await tenant()
    const other = await tenant()
    const id: string = (await upload(t.student.cookie, uploadParts('submission', PDF))).json().data
      .id
    assert.equal((await get(t.student.cookie, `/api/v1/files/${id}`)).statusCode, 200)
    const link = await get(t.student.cookie, `/api/v1/files/${id}/url`)
    assert.equal(link.statusCode, 200, link.body)
    for (const cookie of [
      t.otherStudent.cookie,
      t.teacher.cookie,
      t.admin.cookie,
      t.parent.cookie,
      other.student.cookie,
      other.admin.cookie,
    ]) {
      assert.equal((await get(cookie, `/api/v1/files/${id}`)).statusCode, 404)
      assert.equal((await get(cookie, `/api/v1/files/${id}/url`)).statusCode, 404)
    }
    assert.equal(
      (await get(t.student.cookie, `/api/v1/files/00000000-0000-4000-8000-000000000000/url`))
        .statusCode,
      404,
    )
    assert.equal((await get(t.student.cookie, `/api/v1/files/bozuk/url`)).statusCode, 400)
    const anonymous = await app.inject({ method: 'GET', url: `/api/v1/files/${id}/url` })
    assert.equal(anonymous.statusCode, 401)
  })

  test('modül kapalıyken kapsam önce gelir: kapsam dışı ve olmayan dosya 404, yalnız yükleyen 403 module_disabled', async () => {
    const t = await tenant()
    const other = await tenant()
    const id: string = (await upload(t.student.cookie, uploadParts('submission', PDF))).json().data
      .id
    await db
      .update(institutions)
      .set({ enabledModules: { learning: false } })
      .where(eq(institutions.id, t.institution.id))
    for (const path of [`/api/v1/files/${id}`, `/api/v1/files/${id}/url`]) {
      const owner = await get(t.student.cookie, path)
      assert.equal(owner.statusCode, 403, owner.body)
      assert.equal(owner.json().code, 'module_disabled')
      for (const cookie of [t.otherStudent.cookie, t.teacher.cookie, other.student.cookie]) {
        assert.equal((await get(cookie, path)).statusCode, 404, path)
      }
    }
    assert.equal(
      (await get(t.otherStudent.cookie, `/api/v1/files/00000000-0000-4000-8000-000000000000/url`))
        .statusCode,
      404,
    )
  })

  test('imzalı bağlantı: içerik ve başlıklar doğru; süresi geçince 403 link_expired, bozuk imza 403', async () => {
    const t = await tenant()
    const id: string = (
      await upload(
        t.student.cookie,
        uploadParts('submission', PDF, 'Ödev 1.pdf', 'application/pdf'),
      )
    ).json().data.id
    const link = (await get(t.student.cookie, `/api/v1/files/${id}/url`)).json().data
    assert.equal(link.expiresAt, new Date(FIXED_NOW.getTime() + 5 * 60_000).toISOString())
    const url = new URL(link.url)
    assert.equal(url.pathname, '/api/v1/files/download')

    const download = await app.inject({ method: 'GET', url: url.pathname + url.search })
    assert.equal(download.statusCode, 200)
    assert.deepEqual(download.rawPayload, PDF)
    assert.equal(download.headers['content-type'], 'application/pdf')
    assert.equal(download.headers['cache-control'], 'no-store')
    // Web başka kökenden `<img>`/`<audio>` ile gömer; JSON uçları Helmet varsayılanında kalır.
    assert.equal(download.headers['cross-origin-resource-policy'], 'cross-origin')
    assert.equal(
      (await get(t.student.cookie, `/api/v1/files/${id}/url`)).headers[
        'cross-origin-resource-policy'
      ],
      'same-origin',
    )
    assert.equal(
      download.headers['content-disposition'],
      `attachment; filename="_dev 1.pdf"; filename*=UTF-8''%C3%96dev%201.pdf`,
    )

    const token = url.searchParams.get('token') ?? ''
    const [payload = '', signature = ''] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
        f: '00000000-0000-4000-8000-000000000000',
      }),
    ).toString('base64url')
    for (const bad of [`${forged}.${signature}`, `${payload}.x${signature}`, 'bozuk']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/files/download?token=${encodeURIComponent(bad)}`,
      })
      assert.equal(response.statusCode, 403)
      assert.equal(response.json().code, 'invalid_signature')
    }

    now = new Date(FIXED_NOW.getTime() + 5 * 60_000)
    try {
      const expired = await app.inject({ method: 'GET', url: url.pathname + url.search })
      assert.equal(expired.statusCode, 403)
      assert.equal(expired.json().code, 'link_expired')
    } finally {
      now = FIXED_NOW
    }
  })

  test('DOM-BEC-053 bağlı dosya bağlı kaydın okuma kuralından geçer; teslim erişimi denetime yazılır', async () => {
    const t = await tenant()
    const id: string = (await upload(t.student.cookie, uploadParts('submission', PDF))).json().data
      .id
    const studentCtx = contextFor(t.institution.id, t.student, 'ogrenci')
    const attach = (fileId = id, ctx = studentCtx) =>
      db.transaction((tx) =>
        attachFile(tx, ctx, {
          fileId,
          attachedType: TEST_ATTACHMENT,
          attachedId: 'kayit-1',
          dataSubjectId: t.student.id,
        }),
      )
    // Denetlenmemiş (pending) dosya bağlanamaz.
    await assert.rejects(attach(), { code: 'file_not_ready' })
    await recordFileCheck(db, store.storage, {
      institutionId: t.institution.id,
      fileId: id,
      outcome: 'ready',
      now,
      log: app.log,
    })
    // Başkasının dosyası ayırt edilmez.
    await assert.rejects(attach(id, contextFor(t.institution.id, t.otherStudent, 'ogrenci')), {
      code: 'file_unavailable',
    })
    const attached = await attach()
    assert.equal(attached.attachedId, 'kayit-1')
    assert.equal(attached.dataSubjectId, t.student.id)
    await assert.rejects(attach(), { code: 'file_already_attached' })

    readers.add(t.teacher.id)
    try {
      assert.equal((await get(t.teacher.cookie, `/api/v1/files/${id}/url`)).statusCode, 200)
      // Bağlanınca yükleyen de yalnız kaydın kuralıyla okur.
      assert.equal((await get(t.student.cookie, `/api/v1/files/${id}/url`)).statusCode, 404)
      assert.equal((await get(t.otherStudent.cookie, `/api/v1/files/${id}/url`)).statusCode, 404)
    } finally {
      readers.delete(t.teacher.id)
    }
    const accesses = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.action, 'file.access')))
    assert.equal(accesses.length, 1)
    assert.equal(accesses[0]?.actorUserId, t.teacher.id)
  })

  test('amacı kayıt türüne uymayan dosya bağlanamaz', async () => {
    const t = await tenant()
    const id: string = (await upload(t.teacher.cookie, uploadParts('material', PDF))).json().data.id
    await recordFileCheck(db, store.storage, {
      institutionId: t.institution.id,
      fileId: id,
      outcome: 'ready',
      now,
      log: app.log,
    })
    await assert.rejects(
      db.transaction((tx) =>
        attachFile(tx, contextFor(t.institution.id, t.teacher, 'ogretmen'), {
          fileId: id,
          attachedType: TEST_ATTACHMENT,
          attachedId: 'kayit-2',
          dataSubjectId: null,
        }),
      ),
      { code: 'file_purpose_mismatch' },
    )
  })

  test('KVKK: belirteç özgün adı ve türü taşımaz; ad ve tür indirmede dosya kaydından okunur', async () => {
    const t = await tenant()
    const id: string = (
      await upload(
        t.student.cookie,
        uploadParts('submission', PDF, 'Deniz Yılmaz karne.pdf', 'application/pdf'),
      )
    ).json().data.id
    const url = new URL((await get(t.student.cookie, `/api/v1/files/${id}/url`)).json().data.url)
    assert.equal(url.href.includes('Deniz'), false)
    const [payload = ''] = (url.searchParams.get('token') ?? '').split('.')
    const decoded = Buffer.from(payload, 'base64url').toString('utf8')
    assert.deepEqual(Object.keys(JSON.parse(decoded)).sort(), ['d', 'e', 'f', 'i'])
    for (const value of ['Deniz', 'karne', 'pdf', 'application'])
      assert.equal(decoded.toLowerCase().includes(value.toLowerCase()), false, value)
    const download = await app.inject({ method: 'GET', url: url.pathname + url.search })
    assert.equal(download.statusCode, 200)
    assert.equal(download.headers['content-type'], 'application/pdf')
    assert.match(
      String(download.headers['content-disposition']),
      /Deniz%20Y%C4%B1lmaz%20karne\.pdf/,
    )
  })

  test('imzalı bağlantı süresi içinde olsa da silinmiş veya reddedilmiş dosya 404 not_found', async () => {
    const t = await tenant()
    const linkOf = async () => {
      const id: string = (await upload(t.student.cookie, uploadParts('submission', PDF))).json()
        .data.id
      const url = new URL((await get(t.student.cookie, `/api/v1/files/${id}/url`)).json().data.url)
      return { id, path: url.pathname + url.search }
    }
    const rejected = await linkOf()
    await recordFileCheck(db, store.storage, {
      institutionId: t.institution.id,
      fileId: rejected.id,
      outcome: 'rejected',
      now,
      log: app.log,
    })
    const deleted = await linkOf()
    const [row] = await db
      .select()
      .from(files)
      .where(and(eq(files.institutionId, t.institution.id), eq(files.id, deleted.id)))
    assert.ok(row)
    assert.ok(await markFileDeleted(db, t.institution.id, row, now))
    for (const link of [rejected, deleted]) {
      const response = await app.inject({ method: 'GET', url: link.path })
      assert.equal(response.statusCode, 404, response.body)
      assert.equal(response.json().code, 'not_found')
    }
  })

  test('ret sonrası nesne silinemezse hata yutulmaz: kimlikle loglanır, asıl hata fırlar, dosya reddedilmiş kalır; ad loga girmez', async () => {
    const t = await tenant()
    const id: string = (
      await upload(
        t.student.cookie,
        uploadParts('submission', PDF, 'Deniz Yılmaz sağlık raporu.pdf', 'application/pdf'),
      )
    ).json().data.id
    const before = logs.length
    store.storage.failDeletes = true
    try {
      await assert.rejects(
        recordFileCheck(db, store.storage, {
          institutionId: t.institution.id,
          fileId: id,
          outcome: 'rejected',
          now,
          log: app.log,
        }),
        /EIO: simulated delete failure/,
      )
    } finally {
      store.storage.failDeletes = false
    }
    const failures = logs.slice(before).filter((line) => line.includes('file.reject_object_failed'))
    assert.equal(failures.length, 1)
    assert.ok(failures[0]?.includes(`"fileId":"${id}"`))
    assert.ok(failures[0]?.includes('EIO: simulated delete failure'))
    assert.equal(
      logs.slice(before).some((line) => line.includes('Deniz Yılmaz') || line.includes('sağlık')),
      false,
    )
    const [row] = (await rowsOf(t.institution.id)).filter((file) => file.id === id)
    assert.equal(row?.status, 'rejected')
    assert.equal((await get(t.student.cookie, `/api/v1/files/${id}/url`)).statusCode, 404)
  })

  test('ret yeniden bildirilince yalnız nesne silme yeniden çalışır; durum ve denetim değişmez, ready 409 kalır', async () => {
    const t = await tenant()
    const id: string = (await upload(t.student.cookie, uploadParts('submission', PDF))).json().data
      .id
    const check = (outcome: 'ready' | 'rejected') =>
      recordFileCheck(db, store.storage, {
        institutionId: t.institution.id,
        fileId: id,
        outcome,
        now,
        log: app.log,
      })
    store.storage.failDeletes = true
    try {
      await assert.rejects(check('rejected'), /EIO: simulated delete failure/)
    } finally {
      store.storage.failDeletes = false
    }
    const [failed] = (await rowsOf(t.institution.id)).filter((file) => file.id === id)
    assert.ok(failed)
    assert.ok(await store.storage.head(failed.storageKey))
    const audits = async () =>
      (
        await db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.institutionId, t.institution.id), eq(auditLog.entityId, id)))
      ).filter((entry) => entry.action === 'file.reject').length
    assert.equal(await audits(), 1)
    const retried = await check('rejected')
    assert.equal(retried.status, 'rejected')
    assert.equal(retried.version, failed.version)
    assert.equal(await store.storage.head(failed.storageKey), null)
    assert.equal(await audits(), 1)
    await check('rejected')
    await assert.rejects(check('ready'), (error: { code?: string }) => {
      assert.equal(error.code, 'file_already_checked')
      return true
    })
  })

  test('reddedilen dosyanın nesnesi silinir ve görünmez', async () => {
    const t = await tenant()
    const id: string = (await upload(t.student.cookie, uploadParts('submission', PDF))).json().data
      .id
    const row = await recordFileCheck(db, store.storage, {
      institutionId: t.institution.id,
      fileId: id,
      outcome: 'rejected',
      now,
      log: app.log,
    })
    assert.equal(await store.storage.head(row.storageKey), null)
    assert.equal((await get(t.student.cookie, `/api/v1/files/${id}/url`)).statusCode, 404)
  })

  test('ADR 0003 karar 5 bağlanmamış dosya 24 saat sonra temizlenir; bağlı ve yeni dosya kalır', async () => {
    const t = await tenant()
    const stale: string = (await upload(t.student.cookie, uploadParts('submission', PDF))).json()
      .data.id
    const kept: string = (await upload(t.student.cookie, uploadParts('submission', PDF))).json()
      .data.id
    await recordFileCheck(db, store.storage, {
      institutionId: t.institution.id,
      fileId: kept,
      outcome: 'ready',
      now,
      log: app.log,
    })
    await db.transaction((tx) =>
      attachFile(tx, contextFor(t.institution.id, t.student, 'ogrenci'), {
        fileId: kept,
        attachedType: TEST_ATTACHMENT,
        attachedId: 'kayit-3',
        dataSubjectId: t.student.id,
      }),
    )
    const early = await purgeUnattachedFiles({
      db,
      storage: store.storage,
      now: new Date(FIXED_NOW.getTime() + 23 * 3600_000),
      log: app.log,
    })
    assert.equal(early, 0)
    const purged = await purgeUnattachedFiles({
      db,
      storage: store.storage,
      now: new Date(FIXED_NOW.getTime() + 25 * 3600_000),
      log: app.log,
    })
    assert.ok(purged >= 1)
    const rows = await rowsOf(t.institution.id)
    const staleRow = rows.find((row) => row.id === stale)
    const keptRow = rows.find((row) => row.id === kept)
    assert.equal(staleRow?.status, 'deleted')
    assert.equal(staleRow?.originalName, null)
    assert.ok(staleRow && (await store.storage.head(staleRow.storageKey)) === null)
    assert.equal(keptRow?.status, 'ready')
    assert.ok(keptRow && (await store.storage.head(keptRow.storageKey)) !== null)
  })

  test('içerik kolonları değişmez, satır silinmez (tetikleyici 55000)', async () => {
    const t = await tenant()
    const id: string = (await upload(t.student.cookie, uploadParts('submission', PDF))).json().data
      .id
    await assert.rejects(
      db.execute(sql`update files set byte_size = 1 where id = ${id}`),
      (error: unknown) =>
        JSON.stringify(error).includes('55000') || /immutable/.test(String(error)),
    )
    await assert.rejects(db.execute(sql`delete from files where id = ${id}`))
    const [row] = await rowsOf(t.institution.id)
    assert.equal(row?.byteSize, PDF.length)
  })
})
