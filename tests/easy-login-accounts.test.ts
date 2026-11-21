// Web "Kolay giriş" listesi (yalnız geliştirme) API demo tohumunun kopyasıdır; tohum sunucu koduna
// bağlı olduğundan web'e alınamaz. Bu test iki listeyi eşit tutar: tohuma hesap ya da üyelik
// eklenince, ad/e-posta/rol değişince kırılır.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEMO_INSTITUTIONS, DEMO_MEMBERS } from '../apps/api/src/db/demo-seed.ts'
import {
  EASY_LOGIN_ACCOUNTS,
  EASY_LOGIN_INSTITUTIONS,
} from '../apps/web-react/src/pages/dev/easy-login-accounts.ts'

const institutionName = new Map<string, string>(
  DEMO_INSTITUTIONS.map((item) => [item.slug, item.name]),
)

const row = (item: { institution: string; role: string; name: string; email: string }) =>
  `${item.institution} | ${item.role} | ${item.name} | ${item.email}`

test('Kolay giriş hesapları API demo tohumunun üyelikleriyle birebir aynıdır', () => {
  const seeded = DEMO_MEMBERS.flatMap((member) =>
    member.memberships.map((membership) =>
      row({
        institution: institutionName.get(membership.institution) ?? membership.institution,
        role: membership.role,
        name: member.name,
        email: member.email,
      }),
    ),
  ).sort()
  assert.deepEqual(EASY_LOGIN_ACCOUNTS.map(row).sort(), seeded)
})

test('Kolay giriş kurum sırası tohumdaki kurumlarla aynıdır', () => {
  assert.deepEqual(
    [...EASY_LOGIN_INSTITUTIONS],
    DEMO_INSTITUTIONS.map((item) => item.name),
  )
})
