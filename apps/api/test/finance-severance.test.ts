import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { count, eq } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { auditLog } from '../src/db/schema/audit-log.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  type InstitutionOverrides,
} from './support/app.ts'

/**
 * Kıdem ve ihbar tazminatı tahmini (ON-205; DOM-FIN-094). Uç elle girdili hesaptır: kurum kaydı
 * okumaz ve yazmaz, sonuç saklanmaz (K-273). Kural dalları birim testindedir
 * (`tests/finance-severance.test.ts`); burada rol, modül, doğrulama, yanıt şekli ve yazma olmaması.
 */

const URL = '/api/v1/finance/severance-estimates'
const BODY = {
  startDate: '2023-01-02',
  endDate: '2025-06-30',
  grossWageCents: 3_000_000,
  exitReason: 'employer_termination',
}

describe('kıdem ve ihbar tazminatı tahmini (DOM-FIN-094)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  async function institution(overrides: Partial<InstitutionOverrides> = {}) {
    const created = await createInstitution(app, overrides)
    return { ...created, cookie: await signInAs(app, created.admin) }
  }
  const estimate = (cookie: string | null, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: URL,
      headers: cookie === null ? {} : { cookie },
      payload,
    })
  const auditCount = async (institutionId: string) =>
    (
      await db
        .select({ value: count() })
        .from(auditLog)
        .where(eq(auditLog.institutionId, institutionId))
    )[0]?.value ?? 0

  test('DOM-FIN-094: oturumsuz 401; yönetici dışı roller 403; finance kapalıyken 403 module_disabled', async () => {
    assert.equal((await estimate(null, BODY)).statusCode, 401)
    const a = await institution()
    for (const role of ['onburo', 'ogretmen', 'veli', 'ogrenci'] as const) {
      const cookie = await signInAs(app, await createMember(app, a.id, role))
      const response = await estimate(cookie, BODY)
      assert.equal(response.statusCode, 403, `${role}: ${response.body}`)
      assert.equal(response.json().data, undefined)
    }
    const closed = await institution({ enabledModules: { finance: false } })
    const response = await estimate(closed.cookie, BODY)
    assert.equal(response.statusCode, 403)
    assert.equal(response.json().code, 'module_disabled')
  })

  test('DOM-FIN-094: tarih sırası, sıfır ücret, bilinmeyen neden ve gövdedeki institutionId 400 (kayıt yok)', async () => {
    const a = await institution()
    const audits = await auditCount(a.id)
    const cases: [Record<string, unknown>, string][] = [
      [{ ...BODY, endDate: '2022-12-31' }, 'endDate'],
      [{ ...BODY, grossWageCents: 0 }, 'grossWageCents'],
      [{ ...BODY, exitReason: 'layoff' }, 'exitReason'],
      [{ ...BODY, startDate: '2023-02-30' }, 'startDate'],
      [{ ...BODY, regularBenefitsCents: -1 }, 'regularBenefitsCents'],
      [{ ...BODY, institutionId: 'b' }, ''],
    ]
    for (const [payload, path] of cases) {
      const response = await estimate(a.cookie, payload)
      assert.equal(response.statusCode, 400, `${JSON.stringify(payload)}: ${response.body}`)
      const body = response.json()
      assert.equal(body.code, 'validation_failed')
      if (path !== '')
        assert.ok(
          body.issues.some((issue: { path: string[] }) => issue.path.join('.') === path),
          `${path}: ${response.body}`,
        )
    }
    assert.equal(await auditCount(a.id), audits)
  })

  test('DOM-FIN-094: kalem kalem döküm döner; uyarı yanıtta; hiçbir kayıt ve denetim satırı yazılmaz', async () => {
    const a = await institution()
    const before = await auditCount(a.id)
    const response = await estimate(a.cookie, { ...BODY, cumulativeTaxBaseCents: 15_000_000 })
    assert.equal(response.statusCode, 200, response.body)
    const data = response.json().data
    assert.deepEqual(data.service, {
      startDate: '2023-01-02',
      endDate: '2025-06-30',
      totalDays: 911,
      years: 2,
      months: 5,
      days: 29,
      remainderDays: 180,
    })
    assert.equal(data.severance.status, 'eligible')
    assert.equal(data.severance.days, 74.79)
    assert.equal(data.severance.grossCents, 7_479_452)
    assert.equal(data.severance.incomeTaxCents, 0)
    assert.equal(data.severance.stampTaxCents, 56_769)
    assert.equal(data.notice.weeks, 6)
    assert.equal(data.notice.grossCents, 4_200_000)
    assert.equal(data.notice.incomeTaxMethod, 'cumulative_base')
    assert.equal(data.notice.incomeTaxCents, 800_000)
    assert.equal(data.totals.netCents, data.severance.netCents + data.notice.netCents)
    assert.deepEqual(data.warnings, [])
    assert.equal(await auditCount(a.id), before)

    // Aynı istek ikinci kez aynı sonucu verir (yan etki yok).
    const again = await estimate(a.cookie, { ...BODY, cumulativeTaxBaseCents: 15_000_000 })
    assert.deepEqual(again.json().data, data)

    // Tablonun son döneminden sonraki çıkış: son bilinen tavan ve uyarı.
    const stale = (await estimate(a.cookie, { ...BODY, endDate: '2026-11-15' })).json().data
    assert.equal(stale.severance.ceiling.stale, true)
    assert.deepEqual(stale.warnings, ['ceiling_stale'])
  })

  test('DOM-FIN-094: kurumlar arası: sonuç yalnız gövdeden; başka kurumun oturumu aynı girdiyle aynı sonucu alır, kayıt yok', async () => {
    const a = await institution()
    const b = await institution({ type: 'language_school' })
    const fromA = (await estimate(a.cookie, BODY)).json().data
    const fromB = (await estimate(b.cookie, BODY)).json().data
    assert.deepEqual(fromA, fromB)
  })
})
