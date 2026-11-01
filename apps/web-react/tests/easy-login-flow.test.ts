import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SignInResult } from '@kampus/react-shared/sign-in-errors.ts'
import type { EasyLoginAccount, MeInstitutions } from '../src/pages/dev/easy-login-accounts.ts'
import {
  EASY_LOGIN_MESSAGES,
  runEasyLogin,
  stayedInInstitutionMessage,
  type EasyLoginSteps,
} from '../src/pages/dev/easy-login-flow.ts'

const AKADEMI = 'Akademi Özel Okulları'
const DIL = 'Kampüs Dil Akademisi'

const murat = (institution: EasyLoginAccount['institution']): EasyLoginAccount => ({
  name: 'Murat Yılmaz',
  email: 'murat.yilmaz@kampus.example',
  role: 'yonetici',
  institution,
})

const ME: MeInstitutions = {
  activeInstitution: { id: 'kurum-a', name: AKADEMI },
  memberships: [
    { institutionId: 'kurum-a', institutionName: AKADEMI },
    { institutionId: 'kurum-d', institutionName: DIL },
  ],
}

/** Sahte adımlar; çağrılar sırayla kaydedilir. */
function steps(overrides: Partial<EasyLoginSteps> = {}) {
  const calls: string[] = []
  const value: EasyLoginSteps = {
    signIn: async ({ email }) => {
      calls.push(`signIn:${email}`)
      return { ok: true } satisfies SignInResult
    },
    fetchMe: async () => {
      calls.push('me')
      return ME
    },
    switchInstitution: async (id) => {
      calls.push(`switch:${id}`)
    },
    ...overrides,
  }
  return { calls, value }
}

test('etkin kurumdaki hesapla giriş bildirim vermez ve kurum değiştirmez', async () => {
  const { calls, value } = steps()
  assert.equal(await runEasyLogin(murat(AKADEMI), 'parola-123456', value), null)
  assert.deepEqual(calls, ['signIn:murat.yilmaz@kampus.example', 'me'])
})

test('öbür kurum seçildiyse girişten sonra o kuruma geçilir', async () => {
  const { calls, value } = steps()
  assert.equal(await runEasyLogin(murat(DIL), 'parola-123456', value), null)
  assert.deepEqual(calls, ['signIn:murat.yilmaz@kampus.example', 'me', 'switch:kurum-d'])
})

test('giriş reddedilirse sunucu mesajı gösterilir, /me okunmaz', async () => {
  const { calls, value } = steps({
    signIn: async () => ({ ok: false, message: 'E-posta veya parola hatalı.', field: 'password' }),
  })
  assert.deepEqual(await runEasyLogin(murat(DIL), 'yanlis', value), {
    message: 'E-posta veya parola hatalı.',
  })
  assert.deepEqual(calls, [])
})

test('giriş isteği hata verirse "Giriş şu an yapılamıyor" gösterilir', async () => {
  const cause = new Error('ağ')
  const { value } = steps({
    signIn: async () => {
      throw cause
    },
  })
  assert.deepEqual(await runEasyLogin(murat(AKADEMI), 'p', value), {
    message: EASY_LOGIN_MESSAGES.signInFailed,
    cause,
  })
})

test('giriş başarılı ama /me okunamazsa giriş hatası değil oturum bilgisi hatası gösterilir', async () => {
  const cause = new Error('500')
  const { calls, value } = steps({
    fetchMe: async () => {
      throw cause
    },
  })
  const notice = await runEasyLogin(murat(DIL), 'p', value)
  assert.deepEqual(notice, { message: EASY_LOGIN_MESSAGES.meFailed, cause })
  assert.notEqual(notice?.message, EASY_LOGIN_MESSAGES.signInFailed)
  assert.match(notice!.message, /^Giriş yapıldı/)
  assert.deepEqual(calls, ['signIn:murat.yilmaz@kampus.example'])
})

test('kurum geçişi başarısızsa oturum açık kalır ve hangi kurumda kalındığı söylenir', async () => {
  const cause = new Error('403')
  const { value } = steps({
    switchInstitution: async () => {
      throw cause
    },
  })
  assert.deepEqual(await runEasyLogin(murat(DIL), 'p', value), {
    message:
      'Kampüs Dil Akademisi kurumuna geçilemedi; Akademi Özel Okulları kurumunda oturum açıldı.',
    cause,
  })
})

test('seçilen kurumda üyelik yoksa sessiz kalınmaz, açık kalan kurum söylenir', async () => {
  const { calls, value } = steps({
    fetchMe: async () => ({ ...ME, memberships: [ME.memberships[0]!] }),
  })
  assert.deepEqual(await runEasyLogin(murat(DIL), 'p', value), {
    message:
      'Kampüs Dil Akademisi kurumunda üyelik bulunamadı; Akademi Özel Okulları kurumunda oturum açıldı.',
  })
  assert.ok(!calls.some((call) => call.startsWith('switch:')))
})

test('etkin kurum bilinmiyorsa mesaj varsayılan kurumu söyler', () => {
  assert.equal(
    stayedInInstitutionMessage(DIL, null, 'switch-failed'),
    'Kampüs Dil Akademisi kurumuna geçilemedi; varsayılan kurumda oturum açıldı.',
  )
})
