import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { loginIssues, signInWithEmail, type SignInClient } from '../apps/mobile/src/api/sign-in.ts'

type EmailInput = Parameters<SignInClient['signIn']['email']>[0]

/** Better Auth istemcisinin `signIn.email` davranışını taklit eder. */
function fakeClient(
  respond: (input: EmailInput) => Promise<{ error: { status: number; code?: string } | null }>,
) {
  const calls: EmailInput[] = []
  const client: SignInClient = {
    signIn: {
      email: (input) => {
        calls.push(input)
        return respond(input)
      },
    },
  }
  return { client, calls }
}

function failWith(status: number, headers: Record<string, string> = {}, code?: string) {
  return async (input: EmailInput) => {
    input.fetchOptions?.onError?.({ response: new Response(null, { status, headers }) })
    return { error: code ? { status, code } : { status } }
  }
}

const valid = { email: 'test-ogretmen@ornek.test', password: 'gecerli-parola-123' }

describe('giriş formu doğrulaması', () => {
  test('geçerli giriş sorunsuzdur', () => {
    assert.equal(loginIssues(valid), null)
    assert.equal(loginIssues({ ...valid, email: '  test-ogretmen@ornek.test ' }), null)
  })

  test('boş alanlar alan bazında Türkçe mesaj alır', () => {
    assert.deepEqual(loginIssues({ email: '', password: '' }), {
      email: 'E-posta adresinizi girin.',
      password: 'Parolanızı girin.',
    })
  })

  test('geçersiz e-posta tek mesaj alır', () => {
    assert.deepEqual(loginIssues({ ...valid, email: 'ornek.test' }), {
      email: 'Geçerli bir e-posta adresi girin.',
    })
  })
})

describe('e-posta ile giriş', () => {
  test('başarıda e-posta kırpılarak gönderilir, parola olduğu gibi', async () => {
    const { client, calls } = fakeClient(async () => ({ error: null }))
    const result = await signInWithEmail(client, { ...valid, email: ' a@ornek.test ' }, () => {})
    assert.deepEqual(result, { ok: true })
    assert.equal(calls[0]?.email, 'a@ornek.test')
    assert.equal(calls[0]?.password, valid.password)
  })

  test('yanlış parola parola alanında tek mesaj verir', async () => {
    const { client } = fakeClient(failWith(401, {}, 'INVALID_EMAIL_OR_PASSWORD'))
    assert.deepEqual(await signInWithEmail(client, valid, () => {}), {
      ok: false,
      field: 'password',
      message: 'E-posta veya parola hatalı.',
    })
  })

  test('429 Retry-After başlığındaki süreyi söyler', async () => {
    const { client } = fakeClient(failWith(429, { 'retry-after': '42' }))
    assert.deepEqual(await signInWithEmail(client, valid, () => {}), {
      ok: false,
      message: 'Çok fazla giriş denemesi yapıldı. Lütfen 42 saniye sonra tekrar deneyin.',
    })
  })

  test('429 Better Auth X-Retry-After başlığını da okur', async () => {
    const { client } = fakeClient(failWith(429, { 'x-retry-after': '120' }))
    const result = await signInWithEmail(client, valid, () => {})
    assert.equal(result.ok, false)
    assert.match(result.ok ? '' : result.message, /2 dakika sonra/)
  })

  test('ağ hatası yerel loga yazılır, kullanıcıya Türkçe mesaj gider', async () => {
    const logged: unknown[] = []
    const { client } = fakeClient(async () => {
      throw new TypeError('Network request failed')
    })
    const result = await signInWithEmail(client, valid, (error) => logged.push(error))
    assert.deepEqual(result, {
      ok: false,
      message: 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip yeniden deneyin.',
    })
    assert.equal(logged.length, 1)
  })

  test('sunucu hatası teknik ayrıntı göstermez', async () => {
    const { client } = fakeClient(failWith(500, {}, 'INTERNAL_SERVER_ERROR'))
    assert.deepEqual(await signInWithEmail(client, valid, () => {}), {
      ok: false,
      message: 'Giriş şu an yapılamıyor. Lütfen tekrar deneyin.',
    })
  })
})
