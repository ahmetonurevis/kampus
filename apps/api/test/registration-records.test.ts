import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { auditLog } from '../src/db/schema/audit-log.ts'
import { findRecord } from '../src/db/records.ts'
import { and, eq } from 'drizzle-orm'
import {
  app,
  assertError,
  db,
  institution,
  member,
  useCommandsHarness,
  version,
} from './support/commands-harness.ts'
import { TEST_ORIGIN } from './support/app.ts'

// ON-117, DOM-KAY-012: PATCH /api/v1/parents/:parentId — kayıt sonrası veli bilgisi düzeltme.
describe('veli bilgisi düzeltme', () => {
  useCommandsHarness()

  const patch = (cookie: string | null, parentId: string, body: unknown, ifMatch?: number) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/parents/${parentId}`,
      headers: {
        origin: TEST_ORIGIN,
        'content-type': 'application/json',
        ...(cookie === null ? {} : { cookie }),
        ...(ifMatch === undefined ? {} : { 'if-match': `"${String(ifMatch)}"` }),
      },
      payload: JSON.stringify(body),
    })
  const parentOf = async (institutionId: string) =>
    (await findRecord(db, institutionId, 'parents', 'p1'))?.data

  test('ön büro adı, telefonu ve e-postayı düzeltir; kalıcıdır, denetime yalnız alan adları gider', async () => {
    const a = await institution()
    const desk = await member(a.id, 'onburo')
    const current = await version(a.id, 'parents', 'p1')
    const response = await patch(
      desk,
      'p1',
      { name: 'Ayşe Yılmaz Kaya', phone: '05550000077', email: 'Ayse.Kaya@example.com' },
      current,
    )
    assert.equal(response.statusCode, 200, response.body)
    const stored = await parentOf(a.id)
    assert.equal(stored?.name, 'Ayşe Yılmaz Kaya')
    assert.equal(stored?.phone, '05550000077')
    assert.equal(stored?.email, 'ayse.kaya@example.com')
    assert.equal(await version(a.id, 'parents', 'p1'), (current ?? 0) + 1)
    const audit = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.institutionId, a.id), eq(auditLog.action, 'parent.update')))
    assert.equal(audit.length, 1)
    assert.equal(JSON.stringify(audit[0]).includes('05550000077'), false)
    assert.equal(JSON.stringify(audit[0]).includes('ayse.kaya@example.com'), false)
  })

  test('401, rol 403, başka kurum 404, sürüm eksik 400, bayat sürüm 409; kayıt değişmez', async () => {
    const a = await institution()
    const b = await institution()
    const before = await parentOf(a.id)
    const current = await version(a.id, 'parents', 'p1')
    const body = { name: 'Başka Ad' }
    assertError(await patch(null, 'p1', body, current), 401)
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const)
      assertError(await patch(await member(a.id, role), 'p1', body, current), 403)
    const desk = await member(a.id, 'onburo')
    assertError(await patch(desk, 'p1', body), 400, 'if_match_required')
    assertError(await patch(desk, 'p1', body, (current ?? 0) + 5), 409, 'version_conflict')
    assertError(await patch(desk, 'yok', body, 1), 404)
    // Kimlikler kuruma göredir: B'nin aynı kimlikli kaydını düzeltmesi A'nın kaydına dokunmaz.
    const ownB = await patch(b.adminCookie, 'p1', { name: 'B Kurumu Velisi' }, current)
    assert.equal(ownB.statusCode, 200, ownB.body)
    assert.equal((await parentOf(b.id))?.name, 'B Kurumu Velisi')
    assert.deepEqual(await parentOf(a.id), before)
  })

  test('geçersiz alan 400; değişiklik yoksa 409 parent_unchanged', async () => {
    const a = await institution()
    const desk = await member(a.id, 'onburo')
    const current = await version(a.id, 'parents', 'p1')
    const before = await parentOf(a.id)
    assertError(await patch(desk, 'p1', { phone: '5551234567' }, current), 400)
    assertError(await patch(desk, 'p1', { relationship: 'mother' }, current), 400)
    assertError(await patch(desk, 'p1', {}, current), 400)
    assertError(
      await patch(desk, 'p1', { name: String(before?.name) }, current),
      409,
      'parent_unchanged',
    )
    assert.deepEqual(await parentOf(a.id), before)
  })
})
