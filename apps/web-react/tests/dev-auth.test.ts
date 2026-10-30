import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loginSchema } from '../src/auth/auth-port.ts'
import {
  createDevAuth,
  createUnavailableAuth,
  DEV_PASSWORD,
  devEmail,
} from '../src/auth/dev-auth.ts'

test('giriş şeması Türkçe alan mesajları döner', () => {
  const result = loginSchema.safeParse({ email: 'kampus', password: 'kisa' })
  assert.equal(result.success, false)
  const messages = result.error?.issues.map((issue) => issue.message)
  assert.deepEqual(messages, [
    'Geçerli bir e-posta adresi girin.',
    'Parola en az 8 karakter olmalı.',
  ])
})

test('geliştirme oturumu rolü ve kurumu taşır, yanlış parolada değişmez', async () => {
  const auth = createDevAuth()
  let changes = 0
  auth.subscribe(() => changes++)
  const failed = await auth.signIn({ email: devEmail('veli'), password: 'yanlis-parola' })
  assert.equal(failed.ok, false)
  assert.equal(auth.getSession(), null)
  assert.equal(changes, 0)

  const result = await auth.signIn({
    email: ` ${devEmail('veli').toUpperCase()} `,
    password: DEV_PASSWORD,
  })
  assert.equal(result.ok, true)
  assert.equal(auth.getSession()?.role, 'veli')
  assert.equal(auth.getSession()?.institution.name, 'Akademi Özel Okulları')
  await auth.signOut()
  assert.equal(auth.getSession(), null)
  assert.equal(changes, 2)
})

test('üretimde API bağlanana kadar giriş kapalıdır', async () => {
  const result = await createUnavailableAuth().signIn({
    email: devEmail('yonetici'),
    password: DEV_PASSWORD,
  })
  assert.equal(result.ok, false)
})
