import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { describe, test } from 'node:test'

import { TEST_FIELD_ENCRYPTION_KEY } from '../src/config.ts'
import {
  createFieldCipher,
  CURRENT_FIELD_KEY_VERSION,
  decodeFieldKey,
  FieldDecryptionError,
  fieldCipherFromConfig,
  type FieldBinding,
} from '../src/lib/field-crypto.ts'

const binding: FieldBinding = {
  institutionId: 'inst-a',
  table: 'student_health_profiles',
  column: 'content_ciphertext',
  rowKey: 'stu-1',
}
const PLAIN = JSON.stringify({ allergies: [{ name: 'Fıstık', severity: 'severe' }] })
const isDecryptionError = (error: unknown) =>
  error instanceof FieldDecryptionError && !error.message.includes('Fıstık')

describe('alan şifreleme (IST-020, AES-256-GCM)', () => {
  const cipher = fieldCipherFromConfig({ FIELD_ENCRYPTION_KEY: TEST_FIELD_ENCRYPTION_KEY })

  test('DOM-ILT-035: gidiş-dönüş, düz metin şifreli pakette görünmez, sürüm döner', () => {
    const field = cipher.encrypt(binding, PLAIN)
    assert.equal(field.keyVersion, CURRENT_FIELD_KEY_VERSION)
    assert.equal(cipher.currentKeyVersion, 1)
    assert.ok(!field.ciphertext.includes('Fıstık'))
    assert.ok(!Buffer.from(field.ciphertext, 'base64').toString('utf8').includes('Fıstık'))
    assert.equal(cipher.decrypt(binding, field), PLAIN)
    // Her şifreleme yeni IV: aynı metin farklı paket verir.
    assert.notEqual(cipher.encrypt(binding, PLAIN).ciphertext, field.ciphertext)
  })

  test('DOM-ILT-035: başka kurum, öğrenci, tablo ya da kolona kopyalanan değer çözülmez', () => {
    const field = cipher.encrypt(binding, PLAIN)
    for (const other of [
      { ...binding, institutionId: 'inst-b' },
      { ...binding, rowKey: 'stu-2' },
      { ...binding, table: 'other_table' },
      { ...binding, column: 'other_column' },
    ])
      assert.throws(() => cipher.decrypt(other, field), isDecryptionError)
  })

  test('DOM-ILT-035: değiştirilmiş şifreli metin, etiket ya da kısa paket hata verir', () => {
    const field = cipher.encrypt(binding, PLAIN)
    const packed = Buffer.from(field.ciphertext, 'base64')
    for (const index of [0, 12, 28, packed.length - 1]) {
      const tampered = Buffer.from(packed)
      tampered[index] = (tampered[index] ?? 0) ^ 0x01
      assert.throws(
        () => cipher.decrypt(binding, { ...field, ciphertext: tampered.toString('base64') }),
        isDecryptionError,
        `bayt ${index}`,
      )
    }
    assert.throws(
      () =>
        cipher.decrypt(binding, {
          ...field,
          ciphertext: packed.subarray(0, 20).toString('base64'),
        }),
      isDecryptionError,
    )
  })

  test('IST-020: bilinmeyen ya da değiştirilmiş anahtar sürümü çözülmez', () => {
    const field = cipher.encrypt(binding, PLAIN)
    assert.throws(() => cipher.decrypt(binding, { ...field, keyVersion: 2 }), isDecryptionError)
  })

  test('IST-020: başka ana anahtar çözemez; sürümlü anahtar listesi eski satırı açar', () => {
    const oldKey = randomBytes(32)
    const newKey = randomBytes(32)
    const v1 = createFieldCipher(new Map([[1, oldKey]]), 1)
    const old = v1.encrypt(binding, PLAIN)
    assert.throws(
      () => createFieldCipher(new Map([[1, newKey]]), 1).decrypt(binding, old),
      isDecryptionError,
    )
    const rotated = createFieldCipher(
      new Map([
        [1, oldKey],
        [2, newKey],
      ]),
      2,
    )
    assert.equal(rotated.decrypt(binding, old), PLAIN)
    const fresh = rotated.encrypt(binding, PLAIN)
    assert.equal(fresh.keyVersion, 2)
    assert.throws(() => v1.decrypt(binding, fresh), isDecryptionError)
  })

  test('IST-020: anahtar çözme ve kurulum denetimleri', () => {
    assert.equal(decodeFieldKey(TEST_FIELD_ENCRYPTION_KEY)?.length, 32)
    assert.equal(decodeFieldKey('kısa'), null)
    assert.equal(decodeFieldKey(Buffer.alloc(31).toString('base64')), null)
    assert.throws(() => createFieldCipher(new Map([[1, Buffer.alloc(16)]]), 1))
    assert.throws(() => createFieldCipher(new Map([[1, randomBytes(32)]]), 2))
    assert.throws(() => fieldCipherFromConfig({ FIELD_ENCRYPTION_KEY: 'gecersiz' }))
  })
})
