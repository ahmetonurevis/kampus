import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { SignInResult } from '../src/auth/auth-port.ts'
import {
  PASSWORD_REQUIRED_MESSAGE,
  reauthenticate,
  SIGN_IN_UNAVAILABLE_MESSAGE,
  type ReauthenticateInput,
} from '../src/auth/reauthenticate.ts'

function setup(
  overrides: {
    signIn?: (credentials: { email: string; password: string }) => Promise<SignInResult>
    switchInstitution?: (id: string) => Promise<unknown>
  } = {},
) {
  const calls: string[] = []
  const input: ReauthenticateInput = {
    email: 'ayse@kampus.test',
    password: 'Dogru-Parola-2026',
    institutionId: 'kurum-1',
    signIn:
      overrides.signIn ??
      (async ({ email }) => {
        calls.push(`sign-in:${email}`)
        return { ok: true }
      }),
    switchInstitution:
      overrides.switchInstitution ??
      (async (id) => {
        calls.push(`switch:${id}`)
      }),
  }
  return { input, calls }
}

describe('parola yeniden doğrulama', () => {
  test('guvenlik-kvkk: boş parola istek atmadan alan hatası verir', async () => {
    const { input, calls } = setup()
    const result = await reauthenticate({ ...input, password: '' })
    assert.deepEqual(result, {
      ok: false,
      message: PASSWORD_REQUIRED_MESSAGE,
      clearPassword: false,
    })
    assert.deepEqual(calls, [])
  })

  test('e-postası olmayan oturumda istek atılmaz', async () => {
    const { input, calls } = setup()
    const result = await reauthenticate({ ...input, email: undefined })
    assert.equal(result.ok, false)
    assert.deepEqual(calls, [])
  })

  test('guvenlik-kvkk: yanlış parolada mesaj döner ve parola silinir, kurum değişmez', async () => {
    const calls: string[] = []
    const { input } = setup({
      signIn: async () => ({
        ok: false,
        field: 'password',
        message: 'E-posta veya parola hatalı.',
      }),
      switchInstitution: async (id) => {
        calls.push(id)
      },
    })
    const result = await reauthenticate(input)
    assert.deepEqual(result, {
      ok: false,
      message: 'E-posta veya parola hatalı.',
      clearPassword: true,
    })
    assert.deepEqual(calls, [])
  })

  test('guvenlik-kvkk: başarıda aynı e-postayla girer ve pencere açılırkenki kuruma geçer', async () => {
    const { input, calls } = setup()
    assert.deepEqual(await reauthenticate(input), { ok: true })
    assert.deepEqual(calls, ['sign-in:ayse@kampus.test', 'switch:kurum-1'])
  })

  test('kurum bilinmiyorsa yalnız giriş yapılır', async () => {
    const { input, calls } = setup()
    assert.deepEqual(await reauthenticate({ ...input, institutionId: undefined }), { ok: true })
    assert.deepEqual(calls, ['sign-in:ayse@kampus.test'])
  })

  test('ağ hatası ve kurum geçişi hatası teknik ayrıntısız Türkçe mesaj verir', async () => {
    const network = setup({
      signIn: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    assert.deepEqual(await reauthenticate(network.input), {
      ok: false,
      message: SIGN_IN_UNAVAILABLE_MESSAGE,
      clearPassword: false,
    })

    const switching = setup({
      switchInstitution: async () => {
        throw new Error('setActive')
      },
    })
    const result = await reauthenticate(switching.input)
    assert.deepEqual(result, {
      ok: false,
      message: SIGN_IN_UNAVAILABLE_MESSAGE,
      clearPassword: false,
    })
  })
})
