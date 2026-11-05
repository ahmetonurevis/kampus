import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parentEditBody,
  parentEditDefaults,
  parentEditFormSchema,
} from '../src/pages/crm/parent-edit-form.ts'

// ON-117: veli düzeltme formu yalnız değişen alanı gönderir.
test('ON-117: değişen alanlar gövdeye girer; e-posta küçük harfe iner, boş e-posta siler', () => {
  const current = parentEditDefaults({ name: 'Ayşe Yılmaz', phone: '05550000001' })
  const parsed = parentEditFormSchema.parse({
    name: 'Ayşe Yılmaz',
    phone: '05550000002',
    email: 'Ayse@Example.com',
  })
  assert.deepEqual(parentEditBody(parsed, current), {
    phone: '05550000002',
    email: 'ayse@example.com',
  })
  const withEmail = parentEditDefaults({ name: 'Ayşe', phone: '05550000001', email: 'a@b.co' })
  const cleared = parentEditFormSchema.parse({ ...withEmail, email: '' })
  assert.deepEqual(parentEditBody(cleared, withEmail), { email: '' })
  assert.equal(parentEditBody(parentEditFormSchema.parse(withEmail), withEmail), null)
})

test('ON-117: telefon zorunlu ve 05XXXXXXXXX biçiminde; geçersiz e-posta reddedilir', () => {
  const base = { name: 'Ayşe', phone: '05550000001', email: '' }
  assert.equal(parentEditFormSchema.safeParse({ ...base, phone: '' }).success, false)
  assert.equal(parentEditFormSchema.safeParse({ ...base, phone: '5550000001' }).success, false)
  assert.equal(parentEditFormSchema.safeParse({ ...base, email: 'gecersiz' }).success, false)
  assert.equal(parentEditFormSchema.safeParse({ ...base, name: ' ' }).success, false)
})
