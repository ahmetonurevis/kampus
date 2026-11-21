import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { sql } from 'drizzle-orm'

import type { App } from '../src/app.ts'
import { trustedOrigins } from '../src/auth.ts'
import { DEVELOPMENT_FIELD_ENCRYPTION_KEY } from '../src/config.ts'
import type { Database } from '../src/db/client.ts'
import {
  buildTestApp,
  createInstitution,
  createTestDatabase,
  signIn,
  TEST_ORIGIN,
  testConfig,
} from './support/app.ts'

const PRODUCTION = {
  NODE_ENV: 'production',
  BETTER_AUTH_URL: 'https://api.kampus.example',
  BETTER_AUTH_SECRET: 'b4Jx9-uretim-icin-uretilmis-rastgele-deger-Qm2',
  FIELD_ENCRYPTION_KEY: 'x/Ze81RFCnuwFDAaKuVS9QlX60f17joBtM9H4nyNDso=',
  STORAGE_DIR: '/srv/kampus/storage',
}

/** Teste özgü uç: Fastify'nin `trustProxy` ile belirlediği istemci IP'si. */
function registerIpRoute(app: App) {
  app.get('/api/v1/test-client-ips', { schema: { hide: true } }, async (request) => ({
    data: { ip: request.ip },
  }))
}

describe('üretim güvenlik varsayılanları', () => {
  let db: Database
  let close: () => Promise<void>

  before(async () => {
    ;({ db, close } = await createTestDatabase())
  })
  after(async () => {
    await close()
  })

  async function withApp(
    overrides: Record<string, string>,
    run: (app: App) => Promise<void>,
    extend?: (app: App) => void,
  ) {
    const app = await buildTestApp(db, {
      config: testConfig(overrides),
      ...(extend ? { extend } : {}),
    })
    try {
      await run(app)
    } finally {
      await app.close()
    }
  }

  test('üretimde API belgesi ve Expo geliştirme kökenleri kapalıdır', async () => {
    await withApp(PRODUCTION, async (app) => {
      for (const url of ['/api/docs', '/api/docs/', '/api/v1/openapi.json']) {
        const response = await app.inject({ method: 'GET', url })
        assert.equal(response.statusCode, 404, url)
      }
      assert.equal(
        trustedOrigins(app.config).some((origin) => origin.startsWith('exp://')),
        false,
      )
    })
    await withApp({}, async (app) => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
      assert.equal(response.statusCode, 200)
      assert.ok(trustedOrigins(app.config).includes('exp://'))
    })
  })

  for (const [name, overrides] of [
    ['üretimde', PRODUCTION],
    ['https dış adresli test ortamında', { BETTER_AUTH_URL: 'https://hazirlik.kampus.example' }],
  ] as const) {
    test(`${name} oturum çerezi Secure işaretlenir`, async () => {
      await withApp(overrides, async (app) => {
        const institution = await createInstitution(app)
        const response = await signIn(app, institution.admin.email, institution.admin.password)
        assert.equal(response.statusCode, 200)
        const cookie = response.cookies.find((item) => item.name.endsWith('kampus.session_token'))
        assert.ok(cookie, 'oturum çerezi yok')
        assert.equal(cookie.secure, true)
        assert.equal(cookie.httpOnly, true)
      })
    })
  }

  function clientIp(app: App, remoteAddress: string, forwardedFor?: string) {
    return app.inject({
      method: 'GET',
      url: '/api/v1/test-client-ips',
      remoteAddress,
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    })
  }

  test('varsayılan olarak X-Forwarded-For yok sayılır', async () => {
    await withApp(
      {},
      async (app) => {
        const response = await clientIp(app, '203.0.113.10', '198.51.100.1')
        assert.equal(response.json().data.ip, '203.0.113.10')
      },
      registerIpRoute,
    )
  })

  test('hop sayısıyla yalnız vekilin eklediği adres kullanılır', async () => {
    await withApp(
      { TRUST_PROXY: '1' },
      async (app) => {
        const response = await clientIp(app, '10.0.0.2', '6.6.6.6, 198.51.100.7')
        assert.equal(response.json().data.ip, '198.51.100.7')
      },
      registerIpRoute,
    )
  })

  test('vekil listesi dışındaki adresin X-Forwarded-For başlığına güvenilmez', async () => {
    await withApp(
      { TRUST_PROXY: '10.0.0.0/8' },
      async (app) => {
        const trusted = await clientIp(app, '10.1.2.3', '198.51.100.9')
        assert.equal(trusted.json().data.ip, '198.51.100.9')
        const untrusted = await clientIp(app, '203.0.113.20', '198.51.100.9')
        assert.equal(untrusted.json().data.ip, '203.0.113.20')
        // Zincirdeki sahte adres, güvenilen vekilden önce gelmedikçe seçilmez.
        const spoofed = await clientIp(app, '10.1.2.3', '6.6.6.6, 198.51.100.9')
        assert.equal(spoofed.json().data.ip, '198.51.100.9')
      },
      registerIpRoute,
    )
  })

  for (const [name, overrides, remote, forwarded] of [
    ['vekilsiz', {}, '203.0.113.30', (attempt: number) => `198.51.100.${attempt}`],
    [
      'tek vekil arkasında',
      { TRUST_PROXY: '1' },
      '10.0.0.2',
      (attempt: number) => `198.51.100.${attempt}, 203.0.113.31`,
    ],
  ] as const) {
    test(`${name} sahte X-Forwarded-For giriş hız sınırını aşamaz`, async () => {
      await withApp(overrides, async (app) => {
        const statuses: number[] = []
        for (let attempt = 1; attempt <= 6; attempt += 1) {
          const response = await app.inject({
            method: 'POST',
            url: '/api/v1/auth/sign-in/email',
            remoteAddress: remote,
            headers: {
              origin: TEST_ORIGIN,
              'content-type': 'application/json',
              'x-forwarded-for': forwarded(attempt),
            },
            payload: { email: 'deneme@kampus.example', password: 'Yanlis-Parola-123!' },
          })
          statuses.push(response.statusCode)
        }
        assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429])
      })
    })
  }

  test('veritabanı hatası logda sorgu parametresi ve mesaj taşımaz', async () => {
    const logs: string[] = []
    const email = 'gizli-veli@kampus.example'
    const app = await buildTestApp(db, {
      logs,
      extend(instance) {
        instance.get('/api/v1/test-failing-queries', { schema: { hide: true } }, async () => {
          await instance.db.execute(sql`select 1 / 0 where ${email} = ${email}`)
          return { data: null }
        })
      },
    })
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/test-failing-queries' })
      assert.equal(response.statusCode, 500)
      assert.equal(response.json().code, 'internal_error')
      assert.equal(JSON.stringify(response.json()).includes(email), false)

      const line = logs.find((item) => item.includes('unexpected error'))
      assert.ok(line, 'hata logu yok')
      const entry = JSON.parse(line)
      assert.equal(entry.err.cause?.code ?? entry.err.code, '22012')
      assert.ok(typeof entry.err.type === 'string' && entry.err.type.length > 0)
      assert.match(entry.err.stack, /^\s+at /)
      const text = logs.join('')
      for (const leaked of [email, 'division by zero', 'Failed query', 'params'])
        assert.equal(text.includes(leaked), false, `logda: ${leaked}`)
    } finally {
      await app.close()
    }
  })

  test('IST-020: geliştirme anahtarına düşüş başlangıçta bir kez uyarılır, anahtar loga girmez; testte sessiz', async () => {
    const warnings = async (overrides: Record<string, string>) => {
      const logs: string[] = []
      const app = await buildTestApp(db, {
        logs,
        config: testConfig({ LOG_LEVEL: 'debug', ...overrides }),
      })
      await app.close()
      return logs
        .join('')
        .split('\n')
        .filter((line) => line.includes('FIELD_ENCRYPTION_KEY verilmedi'))
    }
    const fallback = await warnings({ NODE_ENV: 'development', FIELD_ENCRYPTION_KEY: '' })
    assert.equal(fallback.length, 1)
    assert.equal(JSON.parse(fallback[0] ?? '{}').level, 40)
    assert.equal(fallback[0]?.includes(DEVELOPMENT_FIELD_ENCRYPTION_KEY), false)
    assert.equal((await warnings({ NODE_ENV: 'test', FIELD_ENCRYPTION_KEY: '' })).length, 0)
    assert.equal((await warnings({ NODE_ENV: 'development' })).length, 0)
  })

  test('DOM-ILT-100, DOM-ILT-102, DOM-ILT-092, DOM-KAY-003, DOM-KAY-012, DOM-KAY-032, DOM-DIL-070: log gizleme üst düzey, iç içe ve geçmiş dizisindeki serbest metni yazmaz', async () => {
    const logs: string[] = []
    const texts = {
      note: 'Gizli görüşme konusu.',
      reason: 'Gizli red gerekçesi.',
      bodyNote: 'Gövdedeki gizli konu.',
      bodyReason: 'Gövdedeki gizli gerekçe.',
      historyReason: 'Geçmişteki gizli gerekçe.',
      recordHistoryReason: 'Kayıt geçmişindeki gizli gerekçe.',
      answer: 'Gizli soru yanıtı.',
      followUp: 'Gizli ek yanıt.',
      bodyAnswer: 'Gövdedeki gizli yanıt.',
      reasonCategory: 'health',
      phone: '05559990777',
      recordPhone: '05559990778',
      recordEmail: 'gizli-aday@kampus.example',
      guardianName: 'Gizli Veli Adı',
      recordGuardianName: 'Kayıttaki Gizli Veli',
      prospectNote: 'Gizli aday görüşme notu.',
      recordProspectNote: 'Kayıttaki gizli aday notu.',
      nationalId: '10000000146',
      birthDate: '2012-03-04',
      recordNationalId: '10000000078',
      recordBirthDate: '2011-05-06',
      rationale: 'Gizli seviye kararı gerekçesi.',
      decisionRationale: 'Kayıttaki gizli kur kararı gerekçesi.',
      rejectionReason: 'Gizli kur kararı ret gerekçesi.',
      decisionRejectionReason: 'Kayıttaki gizli ret gerekçesi.',
      healthAllergy: 'Gizli-fıstık-alerjisi',
      healthNested: 'Gizli-astım-kronik',
      healthDeep: 'Gizli-insülin-ilacı',
      healthBody: 'Gizli-adrenalin-talimatı',
      healthCipher: 'GIZLI-SIFRELI-PAKET==',
    }
    // Uygulamanın gerçek logger yapılandırması (`REDACTED_PATHS`); hem uygulama hem istek logu.
    const app = await buildTestApp(db, {
      logs,
      extend(instance) {
        instance.get('/api/v1/test-redacted-logs', { schema: { hide: true } }, async (request) => {
          request.log.info({ note: texts.note, reason: texts.reason }, 'redaksiyon üst düzey')
          request.log.info(
            { body: { note: texts.bodyNote, reason: texts.bodyReason } },
            'redaksiyon gövde',
          )
          return { data: null }
        })
      },
    })
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/test-redacted-logs' })
      assert.equal(response.statusCode, 200)
      app.log.info({ history: [{ status: 'Reddedildi', reason: texts.historyReason }] }, 'geçmiş')
      app.log.info(
        { record: { history: [{ status: 'İptal', reason: texts.recordHistoryReason }] } },
        'kayıt geçmişi',
      )
      app.log.info({ answer: texts.answer, followUps: [{ text: texts.followUp }] }, 'soru')
      app.log.info({ body: { answer: texts.bodyAnswer } }, 'soru gövdesi')
      app.log.info({ reasonCategory: texts.reasonCategory }, 'mazeret')
      app.log.info(
        {
          phone: texts.phone,
          guardianName: texts.guardianName,
          notes: [{ text: texts.prospectNote }],
          nationalId: texts.nationalId,
          birthDate: texts.birthDate,
        },
        'aday',
      )
      app.log.info(
        {
          record: {
            phone: texts.recordPhone,
            email: texts.recordEmail,
            guardianName: texts.recordGuardianName,
            notes: [{ text: texts.recordProspectNote, author: 'Ön Büro' }],
            nationalId: texts.recordNationalId,
            birthDate: texts.recordBirthDate,
          },
        },
        'aday kaydı',
      )
      app.log.info(
        { rationale: texts.rationale, rejectionReason: texts.rejectionReason },
        'kur kararı',
      )
      app.log.info(
        {
          decision: {
            rationale: texts.decisionRationale,
            rejectionReason: texts.decisionRejectionReason,
          },
        },
        'kur kararı kaydı',
      )
      // Sağlık ve acil bilgi (IST-020): iç içe nesnede de maskelenir.
      app.log.info(
        { profile: { content: { allergies: [{ name: texts.healthAllergy }] } } },
        'sağlık içeriği',
      )
      app.log.info(
        { data: { profile: { content: { chronicConditions: [{ name: texts.healthNested }] } } } },
        'sağlık derin',
      )
      app.log.info(
        { saved: { content: { medications: [{ name: texts.healthDeep }] } } },
        'sağlık ilaç',
      )
      app.log.info(
        { request: { body: { emergencyInstructions: texts.healthBody } } },
        'sağlık gövde',
      )
      app.log.info({ row: { contentCiphertext: texts.healthCipher } }, 'sağlık paket')
      const lines = logs.join('').split('\n').filter(Boolean)
      for (const message of [
        'sağlık içeriği',
        'sağlık derin',
        'sağlık ilaç',
        'sağlık gövde',
        'sağlık paket',
        'kur kararı',
        'kur kararı kaydı',
        'redaksiyon üst düzey',
        'redaksiyon gövde',
        'geçmiş',
        'soru',
        'aday',
        'aday kaydı',
      ])
        assert.ok(
          lines.some((line) => line.includes(`"msg":"${message}"`)),
          `log satırı yok: ${message}`,
        )
      const text = lines.join('\n')
      for (const [field, value] of Object.entries(texts))
        assert.equal(text.includes(value), false, `logda: ${field}`)
      assert.ok(text.includes('[gizli]'))
    } finally {
      await app.close()
    }
  })

  test('DOM-DIL-080 DOM-DIL-082: belge doğrulama kodu, iptal gerekçesi ve MEBBİS numarası loglanmaz; doğrulama yolundaki kod maskelenir', async () => {
    const logs: string[] = []
    const texts = {
      pathCode: 'K7QM-4XPA-9TRV-2HDN-6BWC-8FJY-3EGS',
      verificationCode: 'A1B2-C3D4-E5F6-G7H8-J9K0-M1N2-P3Q4',
      nestedCode: 'R5S6-T7V8-W9X0-Y1Z2-A3B4-C5D6-E7F8',
      cancellationReason: 'Gizli belge iptal gerekçesi.',
      nestedReason: 'Kayıttaki gizli iptal gerekçesi.',
      certificateNumber: 'MEB-GIZLI-0042',
      nestedNumber: 'MEB-GIZLI-0043',
    }
    const app = await buildTestApp(db, { logs })
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/certificate-verifications/${texts.pathCode}?kaynak=qr`,
      })
      assert.equal(response.statusCode, 404, response.body)
      app.log.info(
        {
          verificationCode: texts.verificationCode,
          cancellationReason: texts.cancellationReason,
          certificateNumber: texts.certificateNumber,
        },
        'belge',
      )
      app.log.info(
        {
          certificate: {
            verificationCode: texts.nestedCode,
            cancellationReason: texts.nestedReason,
            certificateNumber: texts.nestedNumber,
          },
        },
        'belge kaydı',
      )
      const lines = logs.join('').split('\n').filter(Boolean)
      for (const message of ['belge', 'belge kaydı'])
        assert.ok(
          lines.some((line) => line.includes(`"msg":"${message}"`)),
          `log satırı yok: ${message}`,
        )
      const text = lines.join('\n')
      for (const [field, value] of Object.entries(texts))
        assert.equal(text.includes(value), false, `logda: ${field}`)
      assert.ok(text.includes('/api/v1/certificate-verifications/[gizli]'), 'maskeli yol yok')
      assert.equal(text.includes('kaynak=qr'), false, 'sorgu dizesi logda')
    } finally {
      await app.close()
    }
  })
})
