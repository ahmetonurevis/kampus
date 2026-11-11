import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import type { Database } from '../src/db/client.ts'
import { recordKey, type CollectionName } from '../src/db/collections.ts'
import { findRecord, insertMissingRecords } from '../src/db/records.ts'
import {
  buildTestApp,
  createInstitution,
  createTestDatabase,
  FIXED_NOW,
  nextIp,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { contractTerms, insertTestTariff } from './support/finance-terms.ts'

const SEED = createSeed(FIXED_NOW)
const STUDENT = SEED.students.find((item) => item.classId === 'c1')
const SAMPLE: Partial<Record<CollectionName, readonly Record<string, unknown>[]>> = {
  branches: SEED.branches,
  teachers: SEED.teachers,
  classes: SEED.classes.filter((item) => item.id === 'c1'),
  students: SEED.students.filter((item) => item.id === STUDENT?.id),
  parents: SEED.parents.filter((item) => item.id === STUDENT?.parentId),
  invoices: [
    {
      id: 'test-inv-1',
      studentId: STUDENT?.id,
      installment: 1,
      amount: 10_000_000,
      dueDate: '2026-11-15T09:00:00.000Z',
      paidAt: null,
      method: null,
      reminderAt: null,
      feeKind: 'tuition',
    },
  ],
  contracts: [
    {
      id: 'test-contract',
      studentId: STUDENT?.id,
      date: '2026-09-01T09:00:00.000Z',
      amount: 10_000_000,
      title: 'Özel okul eğitim sözleşmesi',
      invoiceIds: ['test-inv-1'],
      academicYear: 2026,
      ...contractTerms({ grossCents: 10_000_000, netCents: 10_000_000 }),
    },
  ],
}

/**
 * Kayıt ve finans uçlarının serbest metin ve kişisel alanları logda gizlenir (guvenlik-kvkk.md
 * §13, `REDACTED_PATHS`). Uygulamanın gerçek logger yapılandırması kullanılır; gövde zaten
 * loglanmaz, bu test bir gün loglanırsa da açığa çıkmadığını sabitler.
 */
describe('guvenlik-kvkk: kayıt ve finans alanları logda gizlenir', () => {
  let db: Database
  let close: () => Promise<void>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
  })
  after(async () => {
    await close()
  })

  test('DOM-DIL-051, DOM-FIN-036, DOM-FIN-040, DOM-KAY-009: gerekçe, imza yetkilisi ve veli adı üst düzeyde ve iç içe yazılmaz', async () => {
    const logs: string[] = []
    const texts = {
      usedHoursReason: 'Gizli-kullanilan-saat-gerekcesi',
      extendReason: 'Gizli-uzatma-gerekcesi',
      bodyReason: 'Gizli-govde-gerekcesi',
      amendmentReason: 'Gizli-ek-protokol-gerekcesi',
      reversalReason: 'Gizli-ters-kayit-gerekcesi',
      reopenReason: 'Gizli-yeniden-acma-gerekcesi',
      payerDecisionReason: 'Gizli-odeyici-karari-gerekcesi',
      signatoryName: 'Gizli Imza Yetkilisi',
      rowSignatoryName: 'Gizli Satir Yetkilisi',
      guardianName: 'Gizli Yeni Veli',
      bodyGuardianName: 'Gizli Govdedeki Veli',
      guardianPhone: '05559990779',
    }
    const app = await buildTestApp(db, {
      logs,
      extend(instance) {
        instance.post('/api/v1/test-finance-redaction', { schema: { hide: true } }, (request) => {
          request.log.info({ reason: texts.usedHoursReason, usedHours: 12 }, 'saat düzeltme')
          request.log.info({ body: { reason: texts.bodyReason } }, 'gövde gerekçesi')
          return { data: null }
        })
      },
    })
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/test-finance-redaction' })
      assert.equal(response.statusCode, 200, response.body)
      app.log.info({ audit: { action: 'package.extend', reason: texts.extendReason } }, 'uzatma')
      app.log.info(
        {
          contract: { amendmentReason: texts.amendmentReason },
          payment: { reversalReason: texts.reversalReason },
          closing: { reopenReason: texts.reopenReason },
          payerDecision: { payer: 'student', reason: texts.payerDecisionReason },
        },
        'finans gerekçeleri',
      )
      app.log.info(
        { signatoryName: texts.signatoryName, row: { signatoryName: texts.rowSignatoryName } },
        'imza yetkilisi',
      )
      app.log.info(
        {
          guardian: { name: texts.guardianName, phone: texts.guardianPhone },
          body: { guardian: { kind: 'new', name: texts.bodyGuardianName } },
        },
        'kesin kayıt velisi',
      )
      const lines = logs.join('').split('\n').filter(Boolean)
      for (const message of [
        'saat düzeltme',
        'gövde gerekçesi',
        'uzatma',
        'finans gerekçeleri',
        'imza yetkilisi',
        'kesin kayıt velisi',
      ])
        assert.ok(
          lines.some((line) => line.includes(`"msg":"${message}"`)),
          `log satırı yok: ${message}`,
        )
      const text = lines.join('\n')
      for (const [field, value] of Object.entries(texts))
        assert.equal(text.includes(value), false, `logda: ${field}`)
      assert.ok(text.includes('[gizli]'))
      // Gizleme yalnız hassas alanı örter; saat ve satış eylemi logda kalır.
      assert.ok(text.includes('"usedHours":12'))
      assert.ok(text.includes('"action":"package.extend"'))
    } finally {
      await app.close()
    }
  })

  test('DOM-KAY-001, DOM-KAY-003, DOM-FIN-010: aday ilgi alanı ve imza yetkilisi adı gövdeden loga yazılmaz', async () => {
    // Üst düzey `name` ve `interest` için maske yoktur: genel `name` başka kayıtların da adıdır.
    // İstek gövdesi hiçbir yolda loga verilmez (istek serileştiricisi yalnız yöntem, yol ve maskeli
    // IP; doğrulama hatası yalnız alan yolu; uygulama hatası mesajsız). Bu test bunu gerçek uçlarla
    // sabitler; gövde bir gün loglanırsa bu iki alan için hedefli maske gerekir.
    const logs: string[] = []
    const app = await buildTestApp(db, { logs, clock: () => FIXED_NOW })
    try {
      const institution = await createInstitution(app)
      await insertTestTariff(db, institution.id)
      await insertMissingRecords(
        db,
        institution.id,
        Object.entries(SAMPLE).flatMap(([collection, items]) =>
          (items ?? []).map((data) => {
            const name = collection as CollectionName
            const id = recordKey(name, data)
            if (id === null) throw new Error(`anahtarsız örnek kayıt: ${collection}`)
            return { collection: name, id, data }
          }),
        ),
        FIXED_NOW,
      )
      const cookie = await signInAs(app, institution.admin)
      const send = (
        method: 'POST' | 'PATCH',
        url: string,
        body: unknown,
        version: number | null = null,
      ) =>
        app.inject({
          method,
          url,
          remoteAddress: nextIp(),
          headers: {
            origin: TEST_ORIGIN,
            'content-type': 'application/json',
            cookie,
            'idempotency-key': randomUUID(),
            ...(version === null ? {} : { 'if-match': `"${String(version)}"` }),
          },
          payload: JSON.stringify(body),
        })
      const texts = {
        interest: 'Gizli-ilgi-alani-metni',
        correctedInterest: 'Gizli-duzeltilmis-ilgi',
        rejectedInterest: 'Gizli-reddedilen-ilgi',
        staleInterest: 'Gizli-eski-surum-ilgi',
        signatoryName: 'Gizli Imza Yetkilisi Govdede',
        rejectedSignatoryName: 'Gizli Reddedilen Yetkili',
      }
      logs.length = 0

      const created = await send('POST', '/api/v1/prospects', {
        name: 'Test Aday',
        phone: '05559990315',
        branchId: 'b1',
        interest: texts.interest,
        source: 'Web sitesi',
        guardianName: 'Test Velisi',
        privacyNoticeVersion: 'aydinlatma-2026-1',
      })
      assert.equal(created.statusCode, 201, created.body)
      const prospectId = created.json().data.entity.id as string
      const prospect = await findRecord(db, institution.id, 'prospects', prospectId)
      assert.ok(prospect)
      const details = `/api/v1/prospects/${prospectId}/details`
      const corrected = await send(
        'PATCH',
        details,
        { interest: texts.correctedInterest },
        prospect.version,
      )
      assert.equal(corrected.statusCode, 200, corrected.body)
      // Doğrulama hatası (200 karakter sınırı) ve eski sürüm de gövdeyi loga taşımaz.
      const tooLong = await send(
        'PATCH',
        details,
        { interest: texts.rejectedInterest.repeat(20) },
        prospect.version + 1,
      )
      assert.equal(tooLong.statusCode, 400, tooLong.body)
      const stale = await send(
        'PATCH',
        details,
        { interest: texts.staleInterest },
        prospect.version,
      )
      assert.ok(stale.statusCode >= 400 && stale.statusCode < 500, stale.body)

      const contract = await findRecord(db, institution.id, 'contracts', 'test-contract')
      assert.ok(contract)
      const signatory = '/api/v1/finance/contracts/test-contract/signatory'
      const signed = await send(
        'POST',
        signatory,
        { name: texts.signatoryName, role: 'founder' },
        contract.version,
      )
      assert.equal(signed.statusCode, 200, signed.body)
      const invalid = await send(
        'POST',
        signatory,
        { name: texts.rejectedSignatoryName, role: 'bilinmeyen' },
        contract.version + 1,
      )
      assert.equal(invalid.statusCode, 400, invalid.body)

      const text = logs.join('')
      // Uçlar loglandı: istek satırları ve doğrulama hatasının alan yolları yazıldı.
      assert.ok(text.includes(details), 'aday düzeltme isteği loglanmadı')
      assert.ok(text.includes(signatory), 'imza yetkilisi isteği loglanmadı')
      assert.ok(text.includes('request.validation_failed'), 'doğrulama hatası loglanmadı')
      assert.ok(text.includes('"interest"'), 'doğrulama hatası alan yolu yok')
      for (const [field, value] of Object.entries(texts))
        assert.equal(text.includes(value), false, `logda: ${field}`)
    } finally {
      await app.close()
    }
  })
})
