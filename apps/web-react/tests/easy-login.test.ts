import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build, type Rolldown } from 'vite'
import { DEV_ONLY_MARKERS, findDevOnlyLeaks } from '../dev-only-guard.ts'
import {
  DEFAULT_EASY_LOGIN_PASSWORD,
  EASY_LOGIN_ACCOUNTS,
  easyLoginPassword,
  groupEasyLoginAccounts,
  institutionToActivate,
  roleLabel,
  type EasyLoginAccount,
} from '../src/pages/dev/easy-login-accounts.ts'

const account = (overrides: Partial<EasyLoginAccount>): EasyLoginAccount => ({
  name: 'Test Kişi',
  email: 'test.kisi@kampus.example',
  role: 'ogrenci',
  institution: 'Akademi Özel Okulları',
  ...overrides,
})

test('hesaplar önce kuruma, kurum içinde Yönetici → Veli sırasıyla role ayrılır', () => {
  const groups = groupEasyLoginAccounts(EASY_LOGIN_ACCOUNTS)
  assert.deepEqual(
    groups.map((group) => group.institution),
    ['Akademi Özel Okulları', 'Kampüs Dil Akademisi'],
  )
  for (const group of groups)
    assert.deepEqual(
      group.roles.map((role) => role.label),
      ['Yönetici', 'Ön büro', 'Öğretmen', 'Öğrenci', 'Veli'],
    )
  const dil = groups[1]!
  assert.deepEqual(
    dil.roles.map((role) => role.accounts.map((item) => item.name)),
    [['Murat Yılmaz'], ['Gizem Tunç'], ['Ozan Er'], ['Lale Sezer'], ['Hakan Sezer']],
  )
})

test('iki kurumda yönetici olan hesap iki kurumun altında da görünür', () => {
  const groups = groupEasyLoginAccounts(EASY_LOGIN_ACCOUNTS)
  for (const group of groups) {
    const admins = group.roles.find((role) => role.role === 'yonetici')!.accounts
    assert.deepEqual(
      admins.map((item) => item.email),
      ['murat.yilmaz@kampus.example'],
    )
  }
})

test('rol içinde ada göre Türkçe sıralanır, bilinmeyen kurum sona ve boş rol çıkmaz', () => {
  const groups = groupEasyLoginAccounts([
    account({ institution: 'Zeta Kurumu' as EasyLoginAccount['institution'], name: 'Ali Can' }),
    account({ name: 'Zehra Kılıç' }),
    account({ name: 'Çağla Er' }),
    account({ name: 'Cem Ak' }),
    account({ role: 'veli', name: 'Şule Ay' }),
  ])
  assert.deepEqual(
    groups.map((group) => group.institution),
    ['Akademi Özel Okulları', 'Zeta Kurumu'],
  )
  const akademi = groups[0]!
  assert.deepEqual(
    akademi.roles.map((role) => role.role),
    ['ogrenci', 'veli'],
  )
  assert.deepEqual(
    akademi.roles[0]!.accounts.map((item) => item.name),
    ['Cem Ak', 'Çağla Er', 'Zehra Kılıç'],
  )
})

test('rol etiketleri Türkçedir', () => {
  assert.equal(roleLabel('yonetici'), 'Yönetici')
  assert.equal(roleLabel('onburo'), 'Ön büro')
  assert.equal(roleLabel('ogretmen'), 'Öğretmen')
  assert.equal(roleLabel('ogrenci'), 'Öğrenci')
  assert.equal(roleLabel('veli'), 'Veli')
})

test('parola ortamdan gelir, yoksa API geliştirme varsayılanı kullanılır', () => {
  assert.equal(easyLoginPassword('Baska-Parola-1'), 'Baska-Parola-1')
  assert.equal(easyLoginPassword(undefined), DEFAULT_EASY_LOGIN_PASSWORD)
  assert.equal(easyLoginPassword(''), DEFAULT_EASY_LOGIN_PASSWORD)
  assert.equal(easyLoginPassword('  '), DEFAULT_EASY_LOGIN_PASSWORD)
  assert.equal(DEFAULT_EASY_LOGIN_PASSWORD, 'Demo-Giris-2026!')
})

test('seçilen kurum etkin kurum değilse girişten sonra o kuruma geçilir', () => {
  const murat = (institution: EasyLoginAccount['institution']) =>
    account({ role: 'yonetici', name: 'Murat Yılmaz', institution })
  const me = {
    activeInstitution: { id: 'kurum-a', name: 'Akademi Özel Okulları' },
    memberships: [
      { institutionId: 'kurum-a', institutionName: 'Akademi Özel Okulları' },
      { institutionId: 'kurum-d', institutionName: 'Kampüs Dil Akademisi' },
    ],
  }
  assert.equal(institutionToActivate(murat('Kampüs Dil Akademisi'), me), 'kurum-d')
  assert.equal(institutionToActivate(murat('Akademi Özel Okulları'), me), null)
  // Üyeliği olmayan kuruma geçilmez; oturum varsayılan kurumda kalır.
  assert.equal(
    institutionToActivate(murat('Kampüs Dil Akademisi'), { ...me, memberships: [] }),
    null,
  )
})

test('geliştirme izi düz ve \\u kaçışlı biçimde bulunur', () => {
  assert.deepEqual(findDevOnlyLeaks({ 'a.js': 'const x = "Giriş yap"' }), [])
  assert.deepEqual(findDevOnlyLeaks({ 'a.js': 'label:"Kolay giriş"' }), [
    { file: 'a.js', marker: 'Kolay giriş' },
  ])
  assert.deepEqual(findDevOnlyLeaks({ 'b.js': 'label:"Kolay giri\\u015F"' }), [
    { file: 'b.js', marker: 'Kolay giriş' },
  ])
  assert.deepEqual(findDevOnlyLeaks({ 'c.js': 'e="ayse@kampus.example",p="Demo-Giris-2026!"' }), [
    { file: 'c.js', marker: 'kampus.example' },
    { file: 'c.js', marker: 'Demo-Giris' },
  ])
})

test('üretim derlemesinde Kolay giriş, demo hesapları ve parola yoktur', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  // Denetim eklentisi iz bulursa derleme hata verir; çıktı ayrıca burada da taranır.
  const result = await build({
    root,
    configFile: `${root}vite.config.ts`,
    logLevel: 'silent',
    build: { write: false },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  const files: Record<string, string> = {}
  for (const { output } of outputs)
    for (const item of output)
      files[item.fileName] =
        item.type === 'chunk'
          ? item.code
          : typeof item.source === 'string'
            ? item.source
            : new TextDecoder().decode(item.source)
  assert.ok(Object.keys(files).some((name) => name.startsWith('assets/LoginPage-')))
  assert.ok(!Object.keys(files).some((name) => name.includes('EasyLogin')))
  assert.deepEqual(findDevOnlyLeaks(files, DEV_ONLY_MARKERS), [])
})
