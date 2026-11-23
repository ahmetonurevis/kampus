import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AuthClientError } from '@kampus/react-shared/sign-in-errors.ts'
import {
  createBetterAuthPort,
  SignOutError,
  type SignInClient,
} from '../src/auth/better-auth-port.ts'

const credentials = { email: 'test@kampus.test', password: 'Test-Parola-2026!' }

function fakeClient(
  options: { signInError?: AuthClientError; signOutError?: AuthClientError; throws?: boolean } = {},
) {
  const calls: string[] = []
  const client: SignInClient = {
    signIn: {
      async email(input) {
        calls.push(`sign-in:${input.email}`)
        if (options.throws) throw new TypeError('Failed to fetch')
        return { error: options.signInError ?? null }
      },
    },
    async signOut() {
      calls.push('sign-out')
      return { error: options.signOutError ?? null }
    },
  }
  return { client, calls }
}

test('başarılı girişte oturum durumu yeniden okunur', async () => {
  const { client, calls } = fakeClient()
  const port = createBetterAuthPort({
    client,
    refreshSession: async () => void calls.push('refresh'),
  })
  assert.deepEqual(await port.signIn(credentials), { ok: true })
  assert.deepEqual(calls, ['sign-in:test@kampus.test', 'refresh'])
})

test('yanlış parolada oturum yenilenmez, parola alanına tek mesaj yazılır', async () => {
  const { client, calls } = fakeClient({
    signInError: { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' },
  })
  const port = createBetterAuthPort({
    client,
    refreshSession: async () => void calls.push('refresh'),
  })
  assert.deepEqual(await port.signIn(credentials), {
    ok: false,
    field: 'password',
    message: 'E-posta veya parola hatalı.',
  })
  assert.deepEqual(calls, ['sign-in:test@kampus.test'])
})

test('ağ hatası teknik ayrıntı göstermeden genel mesaja döner', async (t) => {
  t.mock.method(console, 'error', () => undefined)
  const { client } = fakeClient({ throws: true })
  const port = createBetterAuthPort({ client, refreshSession: async () => undefined })
  const result = await port.signIn(credentials)
  assert.equal(result.ok, false)
  assert.ok(!result.ok && !result.message.includes('fetch'))
})

test('çıkış oturumu yeniler; sunucu hatası SignOutError fırlatır', async () => {
  const ok = fakeClient()
  await createBetterAuthPort({
    client: ok.client,
    refreshSession: async () => void ok.calls.push('refresh'),
  }).signOut()
  assert.deepEqual(ok.calls, ['sign-out', 'refresh'])

  const failed = fakeClient({ signOutError: { status: 500 } })
  await assert.rejects(
    createBetterAuthPort({
      client: failed.client,
      refreshSession: async () => undefined,
    }).signOut(),
    SignOutError,
  )
})
