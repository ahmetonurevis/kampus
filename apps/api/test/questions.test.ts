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
import { files } from '../src/db/schema/files.ts'
import { recordFileCheck } from '../src/services/files.ts'
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
import { multipart, PDF, png, tempStorage, uploadParts } from './support/files-sample.ts'

/**
 * Öğretmenime Sor uçları (docs/domain/iletisim-ve-veli.md DOM-ILT-090…093). Her test kendi
 * kurumunu örnek veri kesitiyle kurar: 7-A (c1) ve 5-A (c2). Deniz (s1) ve Nehir (s25) 7-A'da,
 * Ece (s2) 5-A'dadır. 7-A'nın matematik öğretmeni Selin Kaya (t1), Türkçe öğretmeni Ahmet
 * Yıldırım (t2), fen öğretmeni Derya Arslan (t3); edebiyat öğretmeni Emre Demir (t5) bu iki sınıfa
 * girmez. Örnek sorular: ask1 (s1 → t1, yanıtsız), ask25 (s1 → t1, yanıtlı), ask2 (s2 → t2).
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c2']
const STUDENT_IDS = new Set(
  SEED.students.filter((item) => CLASS_IDS.includes(item.classId)).map((item) => item.id),
)
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  subjects: SEED.subjects,
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => CLASS_IDS.includes(item.id)),
  students: SEED.students.filter((item) => STUDENT_IDS.has(item.id)),
  assignments: SEED.assignments.filter((item) => CLASS_IDS.includes(item.classId)),
  questions: SEED.questions.filter((item) => STUDENT_IDS.has(item.studentId)),
}

function rows(sample: Partial<Record<CollectionName, readonly Record<string, unknown>[]>>) {
  return Object.entries(sample).flatMap(([collection, items]) =>
    (items ?? []).map((data) => {
      const name = collection as CollectionName
      const id = recordKey(name, data)
      if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
      return { collection: name, id, data }
    }),
  )
}

const QUESTION = {
  subjectId: 'math',
  topic: 'Denklemler',
  title: 'Denklem çözümü',
  text: '2x + 6 = 18 denkleminde neden önce 6 çıkarıyoruz?',
}
const ANSWER = { text: 'İki taraftan aynı sayıyı çıkarınca denge bozulmaz.' }
const WITHDRAW = { withdrawn: true }

describe('Öğretmenime Sor uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let store: Awaited<ReturnType<typeof tempStorage>>
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-ask-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    store = await tempStorage()
    app = await buildTestApp(db, { storage: store.storage, clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
    await store.remove()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}, target = app) {
    const created = await createInstitution(target, overrides)
    await insertMissingRecords(db, created.id, rows(SAMPLE), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(target, created.admin) }
  }
  async function member(
    institutionId: string,
    role: Role,
    links: MembershipLinkInput[] = [],
    target = app,
  ) {
    const user = await createMember(target, institutionId, role, links)
    return { ...user, cookie: await signInAs(target, user) }
  }
  const student = async (institutionId: string, studentId = 's1', target = app) =>
    (await member(institutionId, 'ogrenci', [{ kind: 'student', recordId: studentId }], target))
      .cookie
  const parent = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'veli', [{ kind: 'child', recordId: studentId }])).cookie
  const teacher = async (institutionId: string, teacherId: string, target = app) =>
    (await member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }], target))
      .cookie

  function send(
    method: 'POST' | 'PATCH',
    url: string,
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = {},
    target = app,
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
  const read = (cookie: string, url: string) =>
    app.inject({ method: 'GET', url, headers: { origin: TEST_ORIGIN, cookie } })
  const ask = (
    cookie: string | null,
    body: unknown = QUESTION,
    headers: Record<string, string> = key(),
    target = app,
  ) => send('POST', '/api/v1/questions', cookie, body, headers, target)
  const ifMatch = (version: number | null): Record<string, string> =>
    version === null ? {} : { 'if-match': `"${String(version)}"` }
  const answer = (
    cookie: string | null,
    id: string,
    version: number | null,
    body: unknown = ANSWER,
    headers: Record<string, string> = {},
    target = app,
  ) =>
    send(
      'POST',
      `/api/v1/questions/${id}/answers`,
      cookie,
      body,
      { ...ifMatch(version), ...headers },
      target,
    )
  const withdraw = (
    cookie: string | null,
    id: string,
    version: number | null,
    body: unknown = WITHDRAW,
  ) => send('PATCH', `/api/v1/questions/${id}`, cookie, body, ifMatch(version))

  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }
  const stored = (institutionId: string) => loadRecords(db, institutionId, ['questions'])
  /** Soru satırlarının tam görüntüsü: başarısız istekten sonra hiçbir satır değişmemeli. */
  const snapshot = async (institutionId: string) =>
    JSON.stringify(
      (await stored(institutionId))
        .map((row) => ({ id: row.id, version: row.version, data: row.data }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    )
  const version = async (institutionId: string, id: string) => {
    const record = await findRecord(db, institutionId, 'questions', id)
    assert.ok(record, id)
    return record.version
  }
  async function asked(cookie: string, body: unknown = QUESTION) {
    const response = await ask(cookie, body)
    assert.equal(response.statusCode, 201, response.body)
    const data = response.json().data
    return { id: data.entity.id as string, version: data.records[0].version as number }
  }

  // --- Soru gönderme -------------------------------------------------------------------------

  test('DOM-ILT-090: oturumsuz istek 401', async () => {
    assertError(await ask(null), 401)
    assertError(await answer(null, 'ask1', 1), 401)
    assertError(await withdraw(null, 'ask1', 1), 401)
  })

  test('DOM-ILT-090: öğrenci ders öğretmenine soru gönderir; 201, Location, denetim kaydı, gövdedeki kurum etkisiz', async () => {
    const a = await institution()
    const b = await institution()
    const cookie = await student(a.id)
    const before = (await stored(a.id)).length
    // Gövde katıdır: kurum kimliği bilinmeyen alan olarak reddedilir, B'ye hiçbir şey yazılmaz.
    assertError(await ask(cookie, { ...QUESTION, institutionId: b.id }), 400, 'validation_failed')
    const response = await ask(cookie)
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.entity.id
    assert.equal(response.headers.location, `/api/v1/collections/questions/${id}`)
    const record = await findRecord(db, a.id, 'questions', id)
    assert.deepEqual(
      {
        studentId: record?.data.studentId,
        teacherId: record?.data.teacherId,
        subjectId: record?.data.subjectId,
        topic: record?.data.topic,
        createdAt: record?.data.createdAt,
        answeredAt: record?.data.answeredAt,
        answer: record?.data.answer,
      },
      {
        studentId: 's1',
        teacherId: 't1',
        subjectId: 'math',
        topic: 'Denklemler',
        createdAt: FIXED_NOW.toISOString(),
        answeredAt: null,
        answer: '',
      },
    )
    assert.equal('institutionId' in (record?.data ?? {}), false)
    assert.equal((await stored(a.id)).length, before + 1)
    assert.equal((await stored(b.id)).length, before)
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'question.ask')))
    assert.equal(audit.length, 1)
    // Soru metni denetim kaydına girmez (yalnız alan adları).
    assert.equal(JSON.stringify(audit).includes(QUESTION.text), false)
    // Öğrenci kendi sorusunu, dersin öğretmeni kuyruğunda okur.
    assert.equal((await read(cookie, `/api/v1/collections/questions/${id}`)).statusCode, 200)
    const queue = await read(await teacher(a.id, 't1'), '/api/v1/collections/questions')
    assert.ok(queue.json().data.some((item: { id: string }) => item.id === id))
  })

  test('DOM-ILT-090: aynı Idempotency-Key ilk yanıtı tekrarlar; anahtarsız 400, If-Match 400', async () => {
    const a = await institution()
    const cookie = await student(a.id)
    const before = (await stored(a.id)).length
    const headers = key()
    const first = await ask(cookie, QUESTION, headers)
    const again = await ask(cookie, QUESTION, headers)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    assert.equal((await stored(a.id)).length, before + 1)
    assertError(await ask(cookie, QUESTION, {}), 400, 'idempotency_key_required')
    assertError(
      await ask(cookie, QUESTION, { ...key(), 'if-match': '"1"' }),
      400,
      'if_match_not_supported',
    )
    assert.equal((await stored(a.id)).length, before + 1)
  })

  test('DOM-ILT-090, DOM-ILT-011: başka sınıfın dersi ve atanmamış öğretmen 403 question_scope_denied; varlık sızdırılmaz', async () => {
    const a = await institution()
    const cookie = await student(a.id)
    const before = await snapshot(a.id)
    const denied: unknown[] = []
    for (const body of [
      { ...QUESTION, subjectId: 'literature', topic: undefined },
      { ...QUESTION, teacherId: 't2' },
      { ...QUESTION, teacherId: 't5' },
      { ...QUESTION, teacherId: 't-baska-kurum' },
      { ...QUESTION, subjectId: 'ders-yok', topic: undefined },
    ]) {
      const response = await ask(cookie, body)
      assertError(response, 403, 'question_scope_denied')
      denied.push(response.json().message)
    }
    // Ders veya öğretmenin kurumda var olup olmadığı iletiden anlaşılmaz.
    assert.equal(new Set(denied).size, 1)
    assert.equal(await snapshot(a.id), before)
  })

  test('DOM-ILT-090: pasif öğrenci 422; bağlantısız öğrenci 403; kazanım, dosya ve öğrenci kimliği reddedilir', async () => {
    const a = await institution()
    const before = await snapshot(a.id)
    const cookie = await student(a.id)
    const topic = await ask(cookie, { ...QUESTION, topic: 'Paragraf' })
    assertError(topic, 422, 'question_topic_unknown')
    assert.deepEqual(topic.json().issues[0].path, ['topic'])
    for (const body of [
      // Eski demo alanı `files` (dosya adı) bilinmeyen alandır; fotoğraf `fileIds` ile gelir.
      { ...QUESTION, files: ['soru.jpg'] },
      { ...QUESTION, studentId: 's25' },
      { ...QUESTION, text: 'kısa' },
      { ...QUESTION, title: 'x'.repeat(121) },
    ])
      assertError(await ask(cookie, body), 400, 'validation_failed')
    assertError(await ask(await student(a.id, 's-baska-kurum')), 403, 'student_scope_denied')
    assert.equal(await snapshot(a.id), before)
    // Pasif öğrenci: Nehir'in (s25) kaydı pasifleştirilir.
    const nehir = SEED.students.find((item) => item.id === 's25')
    assert.ok(nehir)
    const passive = await createInstitution(app)
    await insertMissingRecords(
      db,
      passive.id,
      rows({ ...SAMPLE, students: [{ ...nehir, isActive: false }] }),
      FIXED_NOW,
    )
    const inactive = await ask(await student(passive.id, 's25'))
    assertError(inactive, 422, 'student_inactive')
    assert.equal((await stored(passive.id)).length, SAMPLE.questions?.length)
  })

  test('DOM-YTK-001: soruyu veli, öğretmen, ön büro ve yönetici gönderemez', async () => {
    const a = await institution()
    const before = await snapshot(a.id)
    for (const cookie of [
      await parent(a.id),
      await teacher(a.id, 't1'),
      (await member(a.id, 'onburo')).cookie,
      a.adminCookie,
    ])
      assertError(await ask(cookie), 403, 'forbidden')
    assert.equal(await snapshot(a.id), before)
  })

  test('DOM-YTK-040: öğrenme modülü kapalıyken uçlar 403 module_disabled; kayıt değişmez', async () => {
    const a = await institution({ enabledModules: { learning: false } })
    const before = await snapshot(a.id)
    assertError(await ask(await student(a.id)), 403, 'module_disabled')
    assertError(await answer(await teacher(a.id, 't1'), 'ask1', 1), 403, 'module_disabled')
    assertError(await withdraw(await student(a.id), 'ask1', 1), 403, 'module_disabled')
    assert.equal(await snapshot(a.id), before)
  })

  // --- Yanıt ---------------------------------------------------------------------------------

  test('DOM-ILT-092: atanmış öğretmen If-Match ile yanıtlar; ek yanıt eklenir, ilk yanıt değişmez', async () => {
    const a = await institution()
    const studentCookie = await student(a.id)
    const { id, version: v1 } = await asked(studentCookie)
    const selin = await teacher(a.id, 't1')
    assertError(await answer(selin, id, null), 400, 'if_match_required')
    assertError(await answer(selin, id, v1 + 1), 409, 'version_conflict')
    const first = await answer(selin, id, v1)
    assert.equal(first.statusCode, 201, first.body)
    assert.equal(first.headers.location, `/api/v1/collections/questions/${id}`)
    const v2: number = first.json().data.records[0].version
    assert.equal(v2, v1 + 1)
    const correction = await answer(selin, id, v2, { text: 'Düzeltme: sonra 2’ye bölün.' })
    assert.equal(correction.statusCode, 201, correction.body)
    const seen = await read(studentCookie, `/api/v1/collections/questions/${id}`)
    const record = seen.json().data.record
    assert.equal(record.answer, ANSWER.text)
    assert.equal(record.answeredAt, FIXED_NOW.toISOString())
    assert.equal(record.answeredBy.role, 'ogretmen')
    assert.equal(record.followUps.length, 1)
    assert.equal(record.followUps[0].text, 'Düzeltme: sonra 2’ye bölün.')
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'question.answer')))
    assert.equal(audit.length, 2)
    assert.equal(JSON.stringify(audit).includes(ANSWER.text), false)
  })

  test('DOM-ILT-092: sınıfın dersinden alınan öğretmen yanıtlanmış soruya ek yanıt yazamaz (403)', async () => {
    // 7-A matematiği Emre Demir'e (t5) geçmiş kurum: yanıtlanmış ask25 Selin'de (t1) kalır.
    const created = await createInstitution(app, {})
    const moved = rows({
      ...SAMPLE,
      assignments: (SAMPLE.assignments ?? []).map((item) =>
        item.id === 'assign-c1-math' ? { ...item, teacherId: 't5' } : item,
      ),
    })
    await insertMissingRecords(db, created.id, moved, FIXED_NOW)
    const before = await snapshot(created.id)
    const v = await version(created.id, 'ask25')
    assertError(
      await answer(await teacher(created.id, 't1'), 'ask25', v),
      403,
      'question_teacher_reassigned',
    )
    assert.equal(await snapshot(created.id), before)
  })

  test('DOM-ILT-092: aynı Idempotency-Key ile yanıt tekrarı ikinci ek yanıt açmaz', async () => {
    const a = await institution()
    const v = await version(a.id, 'ask1')
    const selin = await teacher(a.id, 't1')
    const headers = key()
    const first = await answer(selin, 'ask1', v, ANSWER, headers)
    const again = await answer(selin, 'ask1', v, ANSWER, headers)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.deepEqual(again.json(), first.json())
    const record = await findRecord(db, a.id, 'questions', 'ask1')
    assert.equal(record?.version, v + 1)
    assert.deepEqual(record?.data.followUps, undefined)
  })

  test('DOM-ILT-091, DOM-ILT-092: kapsam dışı kullanıcı yanlış sürümle de olmayan soruyla aynı 404 yanıtını alır; yetkili kullanıcıya 409', async () => {
    const a = await institution()
    const before = await snapshot(a.id)
    const v = await version(a.id, 'ask1')
    // Sürüm denetimi yetkiden önce çalışsaydı kapsam dışı kullanıcı 409 alır, kaydın var olduğunu
    // öğrenirdi; olmayan kimlik ise 404 verir.
    const outsider = await teacher(a.id, 't3')
    const missing = await answer(outsider, 'soru-yok', 99)
    assertError(missing, 404, 'not_found')
    for (const stale of [99, v + 1, v]) {
      const response = await answer(outsider, 'ask1', stale)
      assertError(response, 404, 'not_found')
      assert.equal(response.json().message, missing.json().message)
    }
    const nehir = await student(a.id, 's25')
    assertError(await withdraw(nehir, 'soru-yok', 99), 404, 'not_found')
    for (const stale of [99, v + 1, v])
      assertError(await withdraw(nehir, 'ask1', stale), 404, 'not_found')
    assert.equal(await snapshot(a.id), before)
    // Yetkili kullanıcı yanlış sürümde yine 409 alır.
    assertError(await answer(await teacher(a.id, 't1'), 'ask1', 99), 409, 'version_conflict')
    assertError(await withdraw(await student(a.id), 'ask1', 99), 409, 'version_conflict')
    assert.equal(await snapshot(a.id), before)
  })

  test('DOM-ILT-092: başka sınıfın veya dersin öğretmeni ve başka kurumun sorusu 404; yönetici yanıt yazamaz', async () => {
    const a = await institution()
    const b = await institution()
    const before = await snapshot(a.id)
    const v = await version(a.id, 'ask1')
    for (const cookie of [await teacher(a.id, 't3'), await teacher(a.id, 't5')])
      assertError(await answer(cookie, 'ask1', v), 404, 'not_found')
    assertError(await answer(await teacher(a.id, 't1'), 'soru-yok', 1), 404, 'not_found')
    for (const cookie of [a.adminCookie, await student(a.id), await parent(a.id)])
      assertError(await answer(cookie, 'ask1', v), 403, 'forbidden')
    assert.equal(await snapshot(a.id), before)
    // Başka kurumdaki aynı kimlikli soru A'nın öğretmenine görünmez; B değişmez.
    const { id: bId, version: bVersion } = await asked(await student(b.id))
    const bBefore = await snapshot(b.id)
    assertError(await answer(await teacher(a.id, 't1'), bId, bVersion), 404, 'not_found')
    assert.equal(await snapshot(b.id), bBefore)
    assertError(
      await answer(await teacher(a.id, 't1'), 'ask1', v, { text: '' }),
      400,
      'validation_failed',
    )
    assert.equal(await snapshot(a.id), before)
  })

  // --- Geri çekme ----------------------------------------------------------------------------

  test('DOM-ILT-091: öğrenci yanıtsız sorusunu geri çeker; kayıt kalır, yanıt ve ikinci geri çekme 409', async () => {
    const a = await institution()
    const cookie = await student(a.id)
    const { id, version: v1 } = await asked(cookie)
    assertError(await withdraw(cookie, id, null), 400, 'if_match_required')
    assertError(await withdraw(cookie, id, v1 + 1), 409, 'version_conflict')
    const done = await withdraw(cookie, id, v1)
    assert.equal(done.statusCode, 200, done.body)
    const v2: number = done.json().data.records[0].version
    const record = await findRecord(db, a.id, 'questions', id)
    assert.equal(record?.data.withdrawnAt, FIXED_NOW.toISOString())
    assert.equal(record?.data.text, QUESTION.text)
    assertError(await withdraw(cookie, id, v2), 409, 'question_withdrawn')
    assertError(await answer(await teacher(a.id, 't1'), id, v2), 409, 'question_withdrawn')
    assert.equal((await findRecord(db, a.id, 'questions', id))?.version, v2)
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'question.withdraw')))
    assert.equal(audit.length, 1)
  })

  test('DOM-ILT-091: soru metni değiştirilemez; yanıtlanmış ve başkasının sorusu geri çekilmez', async () => {
    const a = await institution()
    const before = await snapshot(a.id)
    const deniz = await student(a.id)
    const v = await version(a.id, 'ask1')
    for (const body of [
      { text: 'Yeni metin yazıyorum burada.' },
      { withdrawn: true, title: 'Yeni başlık' },
      { withdrawn: false },
      {},
    ])
      assertError(await withdraw(deniz, 'ask1', v, body), 400, 'validation_failed')
    assertError(
      await withdraw(deniz, 'ask25', await version(a.id, 'ask25')),
      409,
      'question_answered',
    )
    // ask2 Ece'nin (s2) sorusudur: Deniz ve Nehir için yoktur.
    assertError(await withdraw(deniz, 'ask2', await version(a.id, 'ask2')), 404, 'not_found')
    assertError(await withdraw(await student(a.id, 's25'), 'ask1', v), 404, 'not_found')
    for (const cookie of [await parent(a.id), await teacher(a.id, 't1'), a.adminCookie])
      assertError(await withdraw(cookie, 'ask1', v), 403, 'forbidden')
    assert.equal(await snapshot(a.id), before)
  })

  // --- Okuma kapsamı -------------------------------------------------------------------------

  test('DOM-ILT-093: öğrenci ve veliye başkasının sorusu gitmez; öğretmen yalnız kendine atananı görür; ön büro 403', async () => {
    const a = await institution()
    // Koleksiyon okuma ucu öğeyi zarfla döndürür: { id, version, record, joined }.
    const ids = async (cookie: string) =>
      (
        (await read(cookie, '/api/v1/collections/questions?pageSize=100')).json().data as {
          id: string
          record: { studentId: string; teacherId: string }
        }[]
      ).map((item) => ({ id: item.id, ...item.record }))
    const deniz = await ids(await student(a.id))
    assert.ok(deniz.length > 0)
    assert.ok(deniz.every((item) => item.studentId === 's1'))
    assert.deepEqual(await ids(await student(a.id, 's25')), [])
    const ece = await ids(await parent(a.id, 's2'))
    assert.deepEqual(
      ece.map((item) => item.id),
      ['ask2'],
    )
    const nehirParent = await parent(a.id, 's25')
    assertError(await read(nehirParent, '/api/v1/collections/questions/ask1'), 404)
    const ahmet = await ids(await teacher(a.id, 't2'))
    assert.ok(ahmet.every((item) => item.teacherId === 't2'))
    assert.ok(ahmet.some((item) => item.id === 'ask2'))
    assertError(
      await read((await member(a.id, 'onburo')).cookie, '/api/v1/collections/questions'),
      403,
    )
    // Veli salt okur: yazma uçları 403.
    assertError(await ask(nehirParent), 403, 'forbidden')
  })

  test('DOM-ILT-014: soru ve yanıt metni başarı, 400, 403, 404, 409, 422 ve geri çekme yollarında loga yazılmaz', async () => {
    const logs: string[] = []
    const logged = await buildTestApp(db, { logs, clock: () => FIXED_NOW })
    try {
      const a = await institution({}, logged)
      const cookie = await student(a.id, 's1', logged)
      const selin = await teacher(a.id, 't1', logged)
      const outsider = await teacher(a.id, 't3', logged)
      // Her yol kendi gizli metnini taşır; hiçbiri log satırlarının hiçbir derinliğinde geçmemeli.
      const secret = (name: string) => `gizli-${name}-metin`
      const statuses: number[] = []
      const run = async (response: Promise<{ statusCode: number }>) => {
        statuses.push((await response).statusCode)
      }
      const asked = await ask(cookie, QUESTION, key(), logged)
      assert.equal(asked.statusCode, 201, asked.body)
      const id: string = asked.json().data.entity.id
      const v = asked.json().data.records[0].version as number
      const replay = key()
      await run(ask(cookie, { ...QUESTION, text: secret('tekrar-soru') }, replay, logged))
      await run(ask(cookie, { ...QUESTION, text: secret('tekrar-soru') }, replay, logged))
      await run(ask(cookie, { ...QUESTION, title: secret('kisa'), text: 'kısa' }, key(), logged))
      await run(
        ask(
          cookie,
          { ...QUESTION, subjectId: 'literature', text: secret('kapsam') },
          key(),
          logged,
        ),
      )
      await run(
        ask(cookie, { ...QUESTION, topic: 'Paragraf', text: secret('kural') }, key(), logged),
      )
      await run(answer(outsider, id, v, { text: secret('kapsam-yanit') }, {}, logged))
      await run(answer(selin, id, v + 5, { text: secret('surum-yanit') }, {}, logged))
      await run(answer(selin, id, v, { text: '' }, {}, logged))
      await run(answer(selin, id, v, ANSWER, {}, logged))
      await run(answer(selin, id, v + 1, { text: secret('ek-yanit') }, {}, logged))
      // Geri çekme: yanıtsız soru 200, yanıtlanmış soru 409; metin gövdeye girmese de kayıt
      // yanıtında soru metni döner, loga düşmemeli.
      const withdrawable = await ask(
        cookie,
        { ...QUESTION, text: secret('geri-cekilen') },
        key(),
        logged,
      )
      const wId: string = withdrawable.json().data.entity.id
      const wVersion = withdrawable.json().data.records[0].version as number
      await run(
        send('PATCH', `/api/v1/questions/${wId}`, cookie, WITHDRAW, ifMatch(wVersion), logged),
      )
      await run(send('PATCH', `/api/v1/questions/${id}`, cookie, WITHDRAW, ifMatch(v + 2), logged))
      await run(
        send(
          'PATCH',
          `/api/v1/questions/${id}`,
          cookie,
          { withdrawn: true, text: secret('degisiklik') },
          ifMatch(v + 2),
          logged,
        ),
      )
      assert.deepEqual(statuses, [201, 201, 400, 403, 422, 404, 409, 400, 201, 201, 200, 409, 400])
      const text = logs.join('')
      assert.ok(text.includes('question.ask'), 'işlem logu yok')
      assert.ok(text.includes('request.validation_failed'), 'doğrulama hatası logu yok')
      for (const value of [
        QUESTION.text,
        QUESTION.title,
        ANSWER.text,
        secret('tekrar-soru'),
        secret('kisa'),
        secret('kapsam'),
        secret('kural'),
        secret('kapsam-yanit'),
        secret('surum-yanit'),
        secret('ek-yanit'),
        secret('geri-cekilen'),
        secret('degisiklik'),
      ])
        assert.equal(text.includes(value), false, `logda serbest metin: ${value.slice(0, 12)}…`)
    } finally {
      await logged.close()
    }
  })

  // --- Fotoğraf (DOM-ILT-094) ----------------------------------------------------------------

  /** Dosya yükler; `ready` ise taramadan geçmiş gibi işaretler (tarama işi yok, TODO(F3c2-scan)). */
  async function uploadPhoto(
    institutionId: string,
    cookie: string,
    options: { purpose?: string; ready?: boolean; name?: string } = {},
  ) {
    const purpose = options.purpose ?? 'student_question_photo'
    const parts =
      purpose === 'submission'
        ? uploadParts(purpose, PDF, 'odev.pdf')
        : uploadParts(purpose, png(), options.name ?? 'Deniz Yılmaz defter.png', 'image/png')
    const body = multipart(parts)
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/files',
      headers: { origin: TEST_ORIGIN, cookie, 'content-type': body.contentType, ...key() },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.id
    if (options.ready !== false)
      await recordFileCheck(db, store.storage, {
        institutionId,
        fileId: id,
        outcome: 'ready',
        now: FIXED_NOW,
        log: app.log,
      })
    return id
  }
  const fileRows = (institutionId: string) =>
    db
      .select()
      .from(files)
      .where(eq(files.institutionId, institutionId))
      .then((list) =>
        JSON.stringify(
          list
            .map((row) => ({ id: row.id, attachedId: row.attachedId, version: row.version }))
            .sort((x, y) => x.id.localeCompare(y.id)),
        ),
      )
  const fileUrl = (cookie: string, fileId: string) => read(cookie, `/api/v1/files/${fileId}/url`)

  test('DOM-ILT-094: öğrenci fotoğraflı soru sorar; fotoğraflar aynı işlemde bağlanır, kayda yalnız kimlik girer', async () => {
    const a = await institution()
    const cookie = await student(a.id)
    const first = await uploadPhoto(a.id, cookie)
    const second = await uploadPhoto(a.id, cookie)
    const headers = key()
    const response = await ask(cookie, { ...QUESTION, fileIds: [first, second] }, headers)
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.entity.id
    const record = await findRecord(db, a.id, 'questions', id)
    assert.deepEqual(record?.data.fileIds, [first, second])
    // Dosya adı (kişisel veri) kayda girmez.
    assert.equal(JSON.stringify(record?.data).includes('Deniz Yılmaz defter'), false)
    const rows = await db.select().from(files).where(eq(files.institutionId, a.id))
    for (const row of rows) {
      assert.equal(row.attachedType, 'question')
      assert.equal(row.attachedId, id)
      assert.equal(row.dataSubjectId, 's1')
    }
    // Tekrar aynı yanıtı döndürür; ikinci soru açılmaz, dosya yeniden bağlanmaz.
    const again = await ask(cookie, { ...QUESTION, fileIds: [first, second] }, headers)
    assert.equal(again.statusCode, 201)
    assert.equal(again.headers['idempotent-replayed'], 'true')
    assert.equal((await stored(a.id)).filter((row) => row.data.fileIds !== undefined).length, 1)
    // Okuma ucunda kimlikler döner; öğrenci kendi fotoğrafını açar.
    const item = await read(cookie, `/api/v1/collections/questions/${id}`)
    assert.deepEqual(item.json().data.record.fileIds, [first, second])
    assert.equal((await fileUrl(cookie, first)).statusCode, 200)
  })

  test('DOM-ILT-094, DOM-ILT-093: soru fotoğrafını veli, sorunun öğretmeni ve yönetici okur; başka öğrenci, başka öğretmen, ön büro ve başka kurum 404', async () => {
    const a = await institution()
    const b = await institution()
    const cookie = await student(a.id)
    const photo = await uploadPhoto(a.id, cookie)
    await asked(cookie, { ...QUESTION, fileIds: [photo] })
    const before = (
      await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'file.access')))
    ).length
    for (const reader of [await parent(a.id), await teacher(a.id, 't1'), a.adminCookie]) {
      assertError(await read(reader, `/api/v1/files/${photo}`), 200)
      const link = await fileUrl(reader, photo)
      assertError(link, 200)
      assert.match(link.json().data.url, /files\/download/)
    }
    // Her bağlantı üretimi denetim kaydıdır (çocuk verisi).
    const accesses = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'file.access')))
    assert.equal(accesses.length, before + 3)
    for (const outsider of [
      await student(a.id, 's25'),
      await parent(a.id, 's2'),
      await teacher(a.id, 't3'),
      (await member(a.id, 'onburo')).cookie,
      await student(b.id),
      b.adminCookie,
    ]) {
      assertError(await read(outsider, `/api/v1/files/${photo}`), 404)
      assertError(await fileUrl(outsider, photo), 404)
    }
  })

  test('DOM-ILT-094: başkasının, başka kurumun dosyası, yanlış amaç, hazır olmayan dosya ve 4. fotoğraf 422; kayıt değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const cookie = await student(a.id)
    const own = await Promise.all([1, 2, 3, 4].map(() => uploadPhoto(a.id, cookie)))
    const nehirs = await uploadPhoto(a.id, await student(a.id, 's25'))
    const foreign = await uploadPhoto(b.id, await student(b.id))
    const homework = await uploadPhoto(a.id, cookie, { purpose: 'submission' })
    const pending = await uploadPhoto(a.id, cookie, { ready: false })
    const questionsBefore = await snapshot(a.id)
    const filesBefore = await fileRows(a.id)
    const foreignBefore = await fileRows(b.id)
    const cases: [string[], string][] = [
      [own, 'question_photo_limit'],
      [[own[0] ?? '', nehirs], 'question_photo_unavailable'],
      [[foreign], 'question_photo_unavailable'],
      [[homework], 'question_photo_purpose'],
      [[own[0] ?? '', pending], 'file_not_ready'],
    ]
    for (const [fileIds, code] of cases) {
      const response = await ask(cookie, { ...QUESTION, fileIds })
      assertError(response, 422, code)
    }
    assertError(await ask(cookie, { ...QUESTION, fileIds: [own[0], own[0]] }), 400)
    // Gövdedeki kurum kimliği B'nin dosyasını açmaz; hiçbir kayıt değişmez.
    assertError(
      await ask(cookie, { ...QUESTION, fileIds: [foreign], institutionId: b.id }),
      400,
      'validation_failed',
    )
    assert.equal(await snapshot(a.id), questionsBefore)
    assert.equal(await fileRows(a.id), filesBefore)
    assert.equal(await fileRows(b.id), foreignBefore)
  })

  test('DOM-ILT-094: soru fotoğrafını öğretmen ve veli yükleyemez (403); modül kapalıyken yükleme 403; oturumsuz 401', async () => {
    const a = await institution()
    const body = multipart(uploadParts('student_question_photo', png(), 'a.png', 'image/png'))
    const upload = (cookie: string | null) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/files',
        headers: {
          origin: TEST_ORIGIN,
          'content-type': body.contentType,
          ...(cookie === null ? {} : { cookie }),
          ...key(),
        },
        payload: body.payload,
      })
    assertError(await upload(null), 401)
    assertError(await upload(await teacher(a.id, 't1')), 403, 'forbidden')
    assertError(await upload(await parent(a.id)), 403, 'forbidden')
    const closed = await institution({ enabledModules: { learning: false } })
    assertError(await upload(await student(closed.id)), 403, 'module_disabled')
    assert.equal(await fileRows(a.id), '[]')
    assert.equal(await fileRows(closed.id), '[]')
    assertError(await ask(null, { ...QUESTION, fileIds: ['f1'] }), 401)
  })
})
