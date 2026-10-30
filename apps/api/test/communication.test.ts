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
import { MESSAGE_RATE_LIMIT } from '../src/routes/communication.ts'
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
 * İletişim uçları (docs/domain/iletisim-ve-veli.md): duyuru (DOM-ILT-001…-004) ve birebir
 * yazışma (DOM-ILT-010…-012, -024), yöneticinin gerekçeli erişimi (DOM-YTK-052). Her test kendi
 * kurumunu örnek veri kesitiyle kurar: 7-A (c1, kampüs b1) ve 8-B (c12, kampüs b2). Ahmet
 * Yıldırım (t2) c1 Türkçe öğretmenidir, c12'ye ders vermez; t18 c12 Türkçe öğretmenidir.
 */

const SEED = createSeed(FIXED_NOW)
const CLASS_IDS = ['c1', 'c12']
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

const REASON = 'Veli şikâyeti üzerine inceleme'

describe('iletişim uçları', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  let now = FIXED_NOW
  let serial = 0
  const key = () => ({ 'idempotency-key': `test-comm-${String(++serial).padStart(5, '0')}` })

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => now })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    await insertMissingRecords(db, created.id, rows(SAMPLE), FIXED_NOW)
    return { ...created, adminCookie: await signInAs(app, created.admin) }
  }

  async function member(institutionId: string, role: Role, links: MembershipLinkInput[] = []) {
    const user = await createMember(app, institutionId, role, links)
    return { ...user, cookie: await signInAs(app, user) }
  }
  const teacher = async (institutionId: string, teacherId = 't2') =>
    (await member(institutionId, 'ogretmen', [{ kind: 'teacher', recordId: teacherId }])).cookie
  const student = async (institutionId: string, studentId = 's1') =>
    (await member(institutionId, 'ogrenci', [{ kind: 'student', recordId: studentId }])).cookie
  const parent = (institutionId: string, studentId = 's1') =>
    member(institutionId, 'veli', [{ kind: 'child', recordId: studentId }])

  function send(
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string | null,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
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
  const read = (cookie: string | null, url: string) =>
    app.inject({
      method: 'GET',
      url,
      headers: { origin: TEST_ORIGIN, ...(cookie === null ? {} : { cookie }) },
    })

  function assertError(
    response: Awaited<ReturnType<typeof send>>,
    statusCode: number,
    code?: string,
  ) {
    assert.equal(response.statusCode, statusCode, response.body)
    if (code !== undefined) assert.equal(response.json().code, code)
  }

  const start = (cookie: string, body: unknown, headers: Record<string, string> = key()) =>
    send('POST', '/api/v1/conversations', cookie, body, headers)
  const message = (
    cookie: string | null,
    conversationId: string,
    text: string,
    headers: Record<string, string> = key(),
  ) => send('POST', `/api/v1/conversations/${conversationId}/messages`, cookie, { text }, headers)

  /** Öğretmen t2 ile s1 arasında öğrenci yazışması açar; kimliğini döndürür. */
  async function studentConversation(institutionId: string, cookie?: string) {
    const response = await start(cookie ?? (await teacher(institutionId)), {
      studentId: 's1',
      audience: 'student',
      text: 'Merhaba Deniz, ödevini aldım.',
    })
    assert.equal(response.statusCode, 201, response.body)
    const id: string = response.json().data.entity.id
    return id
  }

  async function conversation(institutionId: string, id: string) {
    const row = await findRecord(db, institutionId, 'conversations', id)
    return row?.data as { messages: { id: string; text: string; readAt?: string }[] } | undefined
  }

  async function audits(institutionId: string, action: string) {
    return db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, institutionId), eq(auditLog.action, action)))
  }

  // --- Yazışma ------------------------------------------------------------------------------

  describe('yazışma', () => {
    test('401: oturumsuz liste, mesaj ve başlatma', async () => {
      assertError(await read(null, '/api/v1/conversations'), 401)
      assertError(await read(null, '/api/v1/conversations/conv-x/messages'), 401)
      assertError(await message(null, 'conv-x', 'Merhaba'), 401)
    })

    test('DOM-ILT-011: öğretmen öğrencisiyle yazışır; liste son mesaj ve okunmamış sayısı verir; mesajlar sayfalı', async () => {
      const a = await institution()
      const teacherCookie = await teacher(a.id)
      const id = await studentConversation(a.id, teacherCookie)
      // Var olan yazışma yeniden açılmaz: 200 ve aynı kimlik, ilk mesaj ona eklenir.
      const again = await start(teacherCookie, {
        studentId: 's1',
        audience: 'student',
        text: 'Bir de kitap önerisi',
      })
      assert.equal(again.statusCode, 200, again.body)
      assert.equal(again.json().data.entity.id, id)
      const studentCookie = await student(a.id)
      const reply = await message(studentCookie, id, 'Teşekkürler hocam')
      assert.equal(reply.statusCode, 201, reply.body)

      const list = await read(studentCookie, '/api/v1/conversations')
      assert.equal(list.statusCode, 200, list.body)
      assert.equal(list.json().meta.total, 1)
      const [row] = list.json().data
      assert.equal(row.id, id)
      assert.equal(row.messageCount, 3)
      assert.equal(row.unreadCount, 2)
      assert.equal(row.lastMessage.text, 'Teşekkürler hocam')
      assert.equal(row.lastMessage.fromMe, true)

      const first = await read(studentCookie, `/api/v1/conversations/${id}/messages?limit=2`)
      assert.equal(first.statusCode, 200, first.body)
      assert.deepEqual(
        first.json().data.map((m: { text: string }) => m.text),
        ['Bir de kitap önerisi', 'Teşekkürler hocam'],
      )
      const cursor: string = first.json().meta.nextCursor
      assert.ok(cursor)
      const older = await read(
        studentCookie,
        `/api/v1/conversations/${id}/messages?limit=2&cursor=${cursor}`,
      )
      assert.equal(older.json().data.length, 1)
      assert.equal(older.json().meta.nextCursor, null)
      assertError(
        await read(studentCookie, `/api/v1/conversations/${id}/messages?cursor=yok`),
        400,
        'validation_failed',
      )
      assertError(await read(studentCookie, '/api/v1/conversations?sort=x'), 400)

      // DOM-ILT-024: okundu işareti karşı tarafın mesajlarına bir kez yazılır.
      const marked = await send('POST', `/api/v1/conversations/${id}/read`, studentCookie, {})
      assert.equal(marked.statusCode, 200, marked.body)
      assert.equal(marked.json().data.changes.updated, 1)
      const stored = await conversation(a.id, id)
      assert.equal(stored?.messages.filter((m) => m.readAt).length, 2)
      const repeat = await send('POST', `/api/v1/conversations/${id}/read`, studentCookie, {})
      assert.equal(repeat.json().data.changes.updated, 0)
    })

    test('DOM-ILT-011: öğrenci yalnız kendi öğretmeniyle yazışır; başka öğrenci yazışmayı göremez', async () => {
      const a = await institution()
      const studentCookie = await student(a.id)
      const own = await start(studentCookie, { studentId: 's1', teacherId: 't2', text: 'Soru' })
      assert.equal(own.statusCode, 201, own.body)
      const id: string = own.json().data.entity.id
      // 8-B Türkçe öğretmeni s1'e ders vermez.
      assertError(
        await start(studentCookie, { studentId: 's1', teacherId: 't18', text: 'Soru' }),
        403,
        'conversation_party_forbidden',
      )
      // Başka öğrencinin adına yazışma açılmaz.
      assertError(
        await start(studentCookie, { studentId: 's25', teacherId: 't2', text: 'Soru' }),
        403,
        'conversation_party_forbidden',
      )
      const classmate = await student(a.id, 's25')
      assertError(await read(classmate, `/api/v1/conversations/${id}/messages`), 404)
      assertError(await message(classmate, id, 'Ben de sorayım'), 404, 'not_found')
      assert.equal((await read(classmate, '/api/v1/conversations')).json().meta.total, 0)
      // Öğrencinin yazışmasını velisi varsayılan olarak görmez.
      const mother = await parent(a.id)
      assertError(await read(mother.cookie, `/api/v1/conversations/${id}/messages`), 404)
    })

    test('DOM-ILT-010: veli başka velinin yazışmasını göremez ve yazamaz; iki velili öğrencide veli seçimi zorunlu', async () => {
      const a = await institution()
      const teacherCookie = await teacher(a.id)
      const mother = await parent(a.id)
      const father = await parent(a.id)
      const accounts = await read(teacherCookie, '/api/v1/students/s1/parent-accounts')
      assert.equal(accounts.statusCode, 200, accounts.body)
      assert.deepEqual(
        accounts
          .json()
          .data.map((item: { userId: string }) => item.userId)
          .sort(),
        [mother.id, father.id].sort(),
      )
      assertError(
        await start(teacherCookie, { studentId: 's1', audience: 'parent', text: 'Merhaba' }),
        422,
        'parent_choice_required',
      )
      const opened = await start(teacherCookie, {
        studentId: 's1',
        audience: 'parent',
        parentUserId: mother.id,
        text: 'Merhaba Ayşe Hanım',
      })
      assert.equal(opened.statusCode, 201, opened.body)
      const id: string = opened.json().data.entity.id

      const motherList = await read(mother.cookie, '/api/v1/conversations')
      assert.equal(motherList.json().meta.total, 1)
      assert.equal(motherList.json().data[0].parentUserId, mother.id)
      assert.equal((await read(father.cookie, '/api/v1/conversations')).json().meta.total, 0)
      assertError(await read(father.cookie, `/api/v1/conversations/${id}/messages`), 404)
      const before = await conversation(a.id, id)
      assertError(await message(father.cookie, id, 'Ben de yazayım'), 404)
      assertError(await send('POST', `/api/v1/conversations/${id}/read`, father.cookie, {}), 404)
      assert.deepEqual(await conversation(a.id, id), before)
      // Veli kendi yazışmasını açar ve yanıt verir.
      assert.equal((await message(mother.cookie, id, 'Merhaba hocam')).statusCode, 201)
    })

    test('DOM-ILT-010: veli kimliği olmayan eski yazışma hiçbir veliye görünmez; yeni yazışma ayrı açılır', async () => {
      const a = await institution()
      const teacherCookie = await teacher(a.id)
      const mother = await parent(a.id)
      const father = await parent(a.id)
      await insertMissingRecords(
        db,
        a.id,
        rows({
          conversations: [
            {
              id: 'conv-eski',
              studentId: 's1',
              teacherId: 't2',
              audience: 'parent',
              createdAt: FIXED_NOW.toISOString(),
              messages: [
                {
                  id: 'conv-eski-m0',
                  text: 'Eski yazışma',
                  sender: 'teacher',
                  date: FIXED_NOW.toISOString(),
                },
              ],
            },
          ],
        }),
        FIXED_NOW,
      )
      const before = await conversation(a.id, 'conv-eski')
      for (const who of [mother, father]) {
        assert.equal((await read(who.cookie, '/api/v1/conversations')).json().meta.total, 0)
        assertError(await read(who.cookie, '/api/v1/conversations/conv-eski/messages'), 404)
        assertError(await message(who.cookie, 'conv-eski', 'Yazayım'), 404)
        assertError(await send('POST', '/api/v1/conversations/conv-eski/read', who.cookie, {}), 404)
      }
      // Öğretmen eski kaydı görmeye devam eder.
      const list = await read(teacherCookie, '/api/v1/conversations')
      assert.deepEqual(
        list.json().data.map((row: { id: string }) => row.id),
        ['conv-eski'],
      )
      // Başlatma eski kayda eklenmez: veli ve öğretmen ayrı, yeni yazışma açar.
      const byMother = await start(mother.cookie, {
        studentId: 's1',
        teacherId: 't2',
        text: 'Merhaba',
      })
      assert.equal(byMother.statusCode, 201, byMother.body)
      assert.notEqual(byMother.json().data.entity.id, 'conv-eski')
      const byTeacher = await start(teacherCookie, {
        studentId: 's1',
        audience: 'parent',
        parentUserId: father.id,
        text: 'Merhaba Bey',
      })
      assert.equal(byTeacher.statusCode, 201, byTeacher.body)
      assert.notEqual(byTeacher.json().data.entity.id, 'conv-eski')
      assert.notEqual(byTeacher.json().data.entity.id, byMother.json().data.entity.id)
      assert.deepEqual(await conversation(a.id, 'conv-eski'), before)
    })

    test('DOM-ILT-010: öğretmen kapsam dışı öğrencinin velisiyle yazışma açamaz, veli hesaplarını göremez', async () => {
      const a = await institution()
      const teacherCookie = await teacher(a.id)
      await parent(a.id, 's12')
      assertError(
        await start(teacherCookie, { studentId: 's12', audience: 'parent', text: 'Merhaba' }),
        403,
        'conversation_party_forbidden',
      )
      assertError(await read(teacherCookie, '/api/v1/students/s12/parent-accounts'), 404)
      assertError(await read(await student(a.id), '/api/v1/students/s1/parent-accounts'), 403)
      // Yazışma başlatamayan roller veli hesaplarını görmez (DOM-ILT-010).
      assertError(await read(a.adminCookie, '/api/v1/students/s1/parent-accounts'), 403)
      assertError(
        await read((await member(a.id, 'onburo')).cookie, '/api/v1/students/s1/parent-accounts'),
        403,
      )
      assertError(
        await read((await parent(a.id)).cookie, '/api/v1/students/s1/parent-accounts'),
        403,
      )
      // Var olmayan öğrenci kapsam dışıyla aynı 404'tür.
      assertError(await read(teacherCookie, '/api/v1/students/s-yok/parent-accounts'), 404)
      assert.equal((await loadRecords(db, a.id, ['conversations'])).length, 0)
    })

    test('DOM-ILT-010: rehberlik görevli öğretmen yazışma açabildiği her öğrencinin veli hesaplarını görür', async () => {
      const a = await institution()
      const counselor = await teacher(a.id, 't1')
      const mother = await parent(a.id, 's12')
      const accounts = await read(counselor, '/api/v1/students/s12/parent-accounts')
      assert.equal(accounts.statusCode, 200, accounts.body)
      assert.deepEqual(
        accounts.json().data.map((item: { userId: string }) => item.userId),
        [mother.id],
      )
      // Hesap görünürlüğü yazışma başlatma kuralıyla aynıdır: aynı öğrenci için yazışma açılır.
      const opened = await start(counselor, {
        studentId: 's12',
        audience: 'parent',
        text: 'Merhaba, rehberlik görüşmesi.',
      })
      assert.equal(opened.statusCode, 201, opened.body)
      // Rehber olmayan öğretmen için aynı öğrenci iki uçta da kapalıdır.
      const other = await teacher(a.id)
      assertError(await read(other, '/api/v1/students/s12/parent-accounts'), 404)
      assertError(
        await start(other, { studentId: 's12', audience: 'parent', text: 'Merhaba' }),
        403,
        'conversation_party_forbidden',
      )
    })

    test('DOM-ILT-012: mesaj değişmez; düzenleme ve silme ucu yok, kayıt aynı kalır', async () => {
      const a = await institution()
      const teacherCookie = await teacher(a.id)
      const id = await studentConversation(a.id, teacherCookie)
      const before = await conversation(a.id, id)
      const messageId = before?.messages[0]?.id ?? ''
      const url = `/api/v1/conversations/${id}/messages/${messageId}`
      assertError(await send('PATCH', url, teacherCookie, { text: 'Değişti' }), 404)
      assertError(await send('DELETE', url, teacherCookie, {}), 404)
      assert.deepEqual(await conversation(a.id, id), before)
    })

    test('Idempotency-Key: anahtarsız 400; aynı anahtarla çift gönderim tek mesaj; denetime metin yazılmaz', async () => {
      const a = await institution()
      const teacherCookie = await teacher(a.id)
      const id = await studentConversation(a.id, teacherCookie)
      assertError(
        await message(teacherCookie, id, 'Anahtarsız', {}),
        400,
        'idempotency_key_required',
      )
      assertError(
        await start(teacherCookie, { studentId: 's1', audience: 'student' }, {}),
        400,
        'idempotency_key_required',
      )
      const headers = key()
      const first = await message(teacherCookie, id, 'Yarın sınav var', headers)
      assert.equal(first.statusCode, 201, first.body)
      const second = await message(teacherCookie, id, 'Yarın sınav var', headers)
      assert.equal(second.statusCode, 201, second.body)
      assert.equal(second.headers['idempotent-replayed'], 'true')
      assert.deepEqual(second.json(), first.json())
      assertError(
        await message(teacherCookie, id, 'Başka metin', headers),
        422,
        'idempotency_key_reused',
      )
      const stored = await conversation(a.id, id)
      assert.equal(stored?.messages.filter((m) => m.text === 'Yarın sınav var').length, 1)
      const entries = await audits(a.id, 'message.send')
      assert.equal(entries.length, 1)
      assert.equal(entries[0]?.entityId, id)
      const text = JSON.stringify(entries[0]?.changes)
      assert.ok(text.includes('messages') && !text.includes('sınav'), text)
    })

    test('400: boş veya uzun mesaj kaydı değiştirmez', async () => {
      const a = await institution()
      const teacherCookie = await teacher(a.id)
      const id = await studentConversation(a.id, teacherCookie)
      const before = await conversation(a.id, id)
      assertError(await message(teacherCookie, id, '   '), 400, 'validation_failed')
      assertError(await message(teacherCookie, id, 'x'.repeat(2001)), 400, 'validation_failed')
      assert.deepEqual(await conversation(a.id, id), before)
    })

    test('kurumlar arası 404: başka kurumun yazışması okunmaz, yazılmaz; gövdedeki institutionId etkisiz', async () => {
      const a = await institution()
      const b = await institution()
      const id = await studentConversation(a.id)
      const before = await conversation(a.id, id)
      const other = await teacher(b.id)
      assertError(await read(other, `/api/v1/conversations/${id}/messages`), 404)
      assertError(await message(other, id, 'Merhaba'), 404)
      assert.equal((await read(other, '/api/v1/conversations')).json().meta.total, 0)
      assertError(
        await send('POST', `/api/v1/conversations/${id}/access`, b.adminCookie, { reason: REASON }),
        404,
      )
      // Gövdedeki kurum kimliği yok sayılır: yazışma B'de açılır.
      const created = await start(other, {
        studentId: 's1',
        audience: 'student',
        institutionId: a.id,
      })
      assert.equal(created.statusCode, 201, created.body)
      assert.ok(await findRecord(db, b.id, 'conversations', created.json().data.entity.id))
      assert.deepEqual(await conversation(a.id, id), before)
      assert.equal((await loadRecords(db, a.id, ['conversations'])).length, 1)
    })

    test('DOM-YTK-052: yönetici gerekçesiz okuyamaz (404); gerekçeli erişim denetim kaydında, 30 dakika geçerli, okundu üretmez', async () => {
      const a = await institution()
      const id = await studentConversation(a.id)
      const admin = a.adminCookie
      assertError(await read(admin, `/api/v1/conversations/${id}/messages`), 404)
      // Yönetici listesi yalnız öğrenciyle ve yalnız üst veri.
      assertError(await read(admin, '/api/v1/conversations'), 400, 'validation_failed')
      const meta = await read(admin, '/api/v1/conversations?studentId=s1')
      assert.equal(meta.statusCode, 200, meta.body)
      assert.equal(meta.json().data[0].id, id)
      assert.equal(meta.json().data[0].lastMessage, null)
      // Yönetici taraf değildir: mesaj gönderemez, yazışma açamaz.
      assertError(await message(admin, id, 'Merhaba'), 403, 'forbidden')

      const url = `/api/v1/conversations/${id}/access`
      assertError(await send('POST', url, admin, {}), 422, 'access_reason_required')
      assertError(await send('POST', url, admin, { reason: 'kısa' }), 422, 'access_reason_required')
      assert.equal((await audits(a.id, 'conversation.access')).length, 0)
      assertError(await send('POST', url, await teacher(a.id), { reason: REASON }), 403)
      assertError(
        await send('POST', '/api/v1/conversations/conv-yok/access', admin, { reason: REASON }),
        404,
      )

      const opened = await send('POST', url, admin, { reason: REASON })
      assert.equal(opened.statusCode, 200, opened.body)
      assert.equal(
        opened.json().data.expiresAt,
        new Date(FIXED_NOW.getTime() + 30 * 60_000).toISOString(),
      )
      const entries = await audits(a.id, 'conversation.access')
      assert.equal(entries.length, 1)
      assert.equal(entries[0]?.entityType, 'conversations')
      assert.equal(entries[0]?.entityId, id)
      assert.equal(entries[0]?.actorRole, 'yonetici')
      assert.deepEqual(entries[0]?.changes, { reason: REASON })

      const before = await conversation(a.id, id)
      const messages = await read(admin, `/api/v1/conversations/${id}/messages`)
      assert.equal(messages.statusCode, 200, messages.body)
      assert.equal(messages.json().data[0].fromMe, false)
      assert.deepEqual(await conversation(a.id, id), before)
      try {
        now = new Date(FIXED_NOW.getTime() + 31 * 60_000)
        assertError(await read(admin, `/api/v1/conversations/${id}/messages`), 404)
      } finally {
        now = FIXED_NOW
      }
    })

    test(`429: kullanıcı başına dakikada ${String(MESSAGE_RATE_LIMIT)} mesaj isteği`, async () => {
      const a = await institution()
      const cookie = await student(a.id)
      for (let i = 0; i < MESSAGE_RATE_LIMIT; i += 1)
        assertError(await message(cookie, 'conv-yok', 'Merhaba'), 404)
      const limited = await message(cookie, 'conv-yok', 'Merhaba')
      assertError(limited, 429, 'rate_limited')
      assert.ok(limited.headers['retry-after'])
      // Sınır kullanıcı başınadır: başka kullanıcı etkilenmez.
      assertError(await message(await student(a.id, 's25'), 'conv-yok', 'Merhaba'), 404)
    })

    test('modül kapalıyken 403 module_disabled; kayıt yazılmaz', async () => {
      const a = await institution({ enabledModules: { communication: false } })
      const cookie = await teacher(a.id)
      assertError(await read(cookie, '/api/v1/conversations'), 403, 'module_disabled')
      assertError(
        await start(cookie, { studentId: 's1', audience: 'student' }),
        403,
        'module_disabled',
      )
      assertError(
        await send(
          'POST',
          '/api/v1/announcements',
          a.adminCookie,
          { title: 'Duyuru', text: 'Metin', category: 'Akademik', target: { roles: ['veli'] } },
          key(),
        ),
        403,
        'module_disabled',
      )
      assertError(await read(cookie, '/api/v1/students/s1/parent-accounts'), 403, 'module_disabled')
      assert.equal((await loadRecords(db, a.id, ['conversations', 'announcements'])).length, 0)
    })

    test('dil okulunda yazışma ve duyuru çalışır', async () => {
      const a = await institution({ type: 'language_school' })
      const teacherCookie = await teacher(a.id)
      const id = await studentConversation(a.id, teacherCookie)
      assert.equal((await message(await student(a.id), id, 'Thank you!')).statusCode, 201)
      const published = await send(
        'POST',
        '/api/v1/announcements',
        teacherCookie,
        {
          title: 'Speaking club',
          text: 'Cuma günü konuşma kulübü var.',
          category: 'Etkinlik',
          target: { classIds: ['c1'], roles: ['ogrenci'] },
        },
        key(),
      )
      assert.equal(published.statusCode, 201, published.body)
    })
  })

  // --- Duyuru -------------------------------------------------------------------------------

  describe('duyuru', () => {
    const ANNOUNCEMENT = {
      title: 'Veli toplantısı',
      text: 'Perşembe 18.00’de 7-A veli toplantısı yapılacaktır.',
      category: 'Akademik',
      target: { classIds: ['c1'], roles: ['veli'] },
    }
    const publish = (
      cookie: string,
      body: unknown = ANNOUNCEMENT,
      headers: Record<string, string> = key(),
    ) => send('POST', '/api/v1/announcements', cookie, body, headers)
    async function visible(cookie: string) {
      const response = await read(cookie, '/api/v1/collections/announcements?pageSize=100')
      assert.equal(response.statusCode, 200, response.body)
      return (response.json().data as { record: Record<string, unknown> }[]).map(
        (item) => item.record,
      )
    }

    test('DOM-ILT-001: 7-A duyurusu 7-A velisine görünür, 8-B velisine görünmez; 201 + Location', async () => {
      const a = await institution()
      const response = await publish(await teacher(a.id))
      assert.equal(response.statusCode, 201, response.body)
      const id: string = response.json().data.entity.id
      assert.equal(response.headers.location, `/api/v1/collections/announcements/${id}`)
      const mother = await parent(a.id)
      const other = await parent(a.id, 's12')
      const seen = (await visible(mother.cookie)).find((row) => row.id === id)
      assert.ok(seen)
      assert.equal(seen.myReadAt, null)
      assert.ok(!('recipients' in seen) && !('reads' in seen))
      assert.ok(!(await visible(other.cookie)).some((row) => row.id === id))
      // Öğretmen ders vermediği sınıfa yayınlayamaz (DOM-ILT-002); veli hiç yayınlayamaz.
      assertError(
        await publish(await teacher(a.id), {
          ...ANNOUNCEMENT,
          target: { classIds: ['c12'], roles: ['veli'] },
        }),
        403,
        'announcement_scope_denied',
      )
      assertError(await publish(mother.cookie), 403, 'forbidden')
      assertError(
        await publish(await teacher(a.id), ANNOUNCEMENT, {}),
        400,
        'idempotency_key_required',
      )
      assertError(
        await publish(await teacher(a.id), { ...ANNOUNCEMENT, title: 'x' }),
        400,
        'validation_failed',
      )
      assert.equal((await loadRecords(db, a.id, ['announcements'])).length, 1)
    })

    test('DOM-ILT-003: okundu bir kez yazılır; yayınlayan okundu sayısını görür', async () => {
      const a = await institution()
      const teacherCookie = await teacher(a.id)
      const id: string = (await publish(teacherCookie)).json().data.entity.id
      const mother = await parent(a.id)
      const url = `/api/v1/announcements/${id}/read`
      const first = await send('POST', url, mother.cookie, {})
      assert.equal(first.statusCode, 200, first.body)
      assert.equal(first.json().data.changes.updated, 1)
      assert.equal((await send('POST', url, mother.cookie, {})).json().data.changes.updated, 0)
      const mine = (await visible(mother.cookie)).find((row) => row.id === id)
      assert.equal(mine?.myReadAt, FIXED_NOW.toISOString())
      const own = (await visible(teacherCookie)).find((row) => row.id === id)
      assert.equal(own?.readCount, 1)
      assertError(await send('POST', url, (await parent(a.id, 's12')).cookie, {}), 404)
    })

    test('DOM-ILT-004: düzeltme If-Match ile; yalnız yayınlayan veya yönetici', async () => {
      const a = await institution()
      const teacherCookie = await teacher(a.id)
      const created = (await publish(teacherCookie)).json().data
      const id: string = created.entity.id
      const version: number = created.records[0].version
      const url = `/api/v1/announcements/${id}`
      assertError(
        await send(
          'PATCH',
          url,
          teacherCookie,
          { title: 'Yeni başlık' },
          { 'if-match': `"${String(version + 1)}"` },
        ),
        409,
        'version_conflict',
      )
      // Görmeye yetkisi olmayan öğretmen (alıcı değil) olmayan duyuruyla aynı 404'ü alır.
      const stranger = await teacher(a.id, 't3')
      const hidden = await send('PATCH', url, stranger, { title: 'Yeni başlık' })
      const missing = await send('PATCH', '/api/v1/announcements/ann-yok', stranger, {
        title: 'Yeni başlık',
      })
      assertError(hidden, 404, 'not_found')
      const body = (response: typeof hidden) => ({
        ...(response.json() as Record<string, unknown>),
        requestId: null,
      })
      assert.deepEqual(body(hidden), body(missing))
      assertError(
        await send('POST', `${url}/withdraw`, stranger, { reason: 'Yanlış duyuru' }),
        404,
        'not_found',
      )
      // Görüp yayıncı olmayan (öğretmenlere giden duyurunun alıcısı) 403 alır.
      const forTeachers: string = (
        await publish(a.adminCookie, { ...ANNOUNCEMENT, target: { roles: ['ogretmen'] } })
      ).json().data.entity.id
      assertError(
        await send('PATCH', `/api/v1/announcements/${forTeachers}`, stranger, {
          title: 'Yeni başlık',
        }),
        403,
        'announcement_publisher_only',
      )
      const revised = await send(
        'PATCH',
        url,
        teacherCookie,
        { title: 'Veli toplantısı (saat değişti)' },
        { 'if-match': `"${String(version)}"` },
      )
      assert.equal(revised.statusCode, 200, revised.body)
      const stored = await findRecord(db, a.id, 'announcements', id)
      assert.equal(stored?.data.title, 'Veli toplantısı (saat değişti)')
      assert.equal((stored?.data.revisions as unknown[]).length, 1)
      assertError(
        await send('PATCH', url, a.adminCookie, { title: 'Veli toplantısı (saat değişti)' }),
        409,
        'announcement_unchanged',
      )
    })

    test('DOM-ILT-004: ön büro yayıncısı kişiyle eşlenir; ikinci ön büro kullanıcısı değiştiremez ve ayrıntı görmez', async () => {
      const a = await institution()
      const first = await member(a.id, 'onburo')
      const second = await member(a.id, 'onburo')
      const body = {
        title: 'Servis saatleri',
        text: 'Servis 07.30’da.',
        category: 'İdari',
        target: { roles: ['veli'] },
      }
      const created = (await publish(first.cookie, body)).json().data
      const id: string = created.entity.id
      const mother = await parent(a.id)
      assert.equal(
        (await send('POST', `/api/v1/announcements/${id}/read`, mother.cookie, {})).statusCode,
        200,
      )
      const url = `/api/v1/announcements/${id}`
      assertError(
        await send('PATCH', url, second.cookie, { title: 'Başka başlık' }),
        403,
        'announcement_publisher_only',
      )
      assertError(
        await send('POST', `${url}/withdraw`, second.cookie, { reason: 'Yanlış duyuru' }),
        403,
        'announcement_publisher_only',
      )
      const own = (await visible(first.cookie)).find((row) => row.id === id)
      assert.equal(own?.readCount, 1)
      const other = (await visible(second.cookie)).find((row) => row.id === id)
      assert.ok(other)
      assert.ok(!('readCount' in other) && !('revisions' in other))
      assert.equal(
        (await send('PATCH', url, first.cookie, { title: 'Servis saatleri (yeni)' })).statusCode,
        200,
      )
      assert.equal(
        (await send('POST', `${url}/withdraw`, first.cookie, { reason: 'Saat değişti' }))
          .statusCode,
        200,
      )
      const hidden = (await visible(second.cookie)).find((row) => row.id === id)
      assert.equal(hidden?.withdrawnAt, FIXED_NOW.toISOString())
      for (const field of ['text', 'withdrawReason', 'withdrawnBy', 'revisions'])
        assert.ok(!(hidden && field in hidden), field)
      const full = (await visible(first.cookie)).find((row) => row.id === id)
      assert.equal(full?.withdrawReason, 'Saat değişti')
      assert.equal(
        (await findRecord(db, a.id, 'announcements', id))?.data.withdrawReason,
        'Saat değişti',
      )
    })

    test('DOM-ILT-004: geri çekilen duyuru alıcıya "Geri çekildi" olarak görünür, metni yalnız yayınlayan ve yöneticide', async () => {
      const a = await institution()
      const teacherCookie = await teacher(a.id)
      const id: string = (await publish(teacherCookie)).json().data.entity.id
      const mother = await parent(a.id)
      const url = `/api/v1/announcements/${id}/withdraw`
      assertError(await send('POST', url, mother.cookie, { reason: 'Yanlışlık' }), 403, 'forbidden')
      assertError(await send('POST', url, teacherCookie, {}), 400, 'validation_failed')
      const withdrawn = await send('POST', url, teacherCookie, { reason: 'Tarih yanlış yazıldı' })
      assert.equal(withdrawn.statusCode, 200, withdrawn.body)
      assert.ok(await findRecord(db, a.id, 'announcements', id))

      const seen = (await visible(mother.cookie)).find((row) => row.id === id)
      assert.ok(seen)
      assert.equal(seen.withdrawnAt, FIXED_NOW.toISOString())
      assert.equal(seen.title, ANNOUNCEMENT.title)
      for (const field of ['text', 'withdrawReason', 'withdrawnBy', 'revisions'])
        assert.ok(!(field in seen), field)
      for (const cookie of [teacherCookie, a.adminCookie]) {
        const full = (await visible(cookie)).find((row) => row.id === id)
        assert.equal(full?.text, ANNOUNCEMENT.text)
        assert.equal(full?.withdrawReason, 'Tarih yanlış yazıldı')
      }
      assertError(
        await send('POST', url, a.adminCookie, { reason: 'Yineleme' }),
        409,
        'announcement_withdrawn',
      )
      assertError(
        await send('POST', `/api/v1/announcements/${id}/read`, mother.cookie, {}),
        409,
        'announcement_withdrawn',
      )
    })
  })
})
