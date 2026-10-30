import type { Auth, InstitutionType, Role } from '../auth.ts'
import {
  ensureInstitution,
  ensureMember,
  ensureMembershipLinks,
  ensureUser,
  type MembershipLinkInput,
} from '../services/identity.ts'
import type { Database } from './client.ts'

/** Üretim dışında `DEMO_PASSWORD` verilmezse kullanılan demo parolası. */
export const DEFAULT_DEMO_PASSWORD = 'Demo-Giris-2026!'

interface DemoInstitution {
  slug: string
  name: string
  type: InstitutionType
}

interface DemoMember {
  name: string
  email: string
  memberships: { institution: string; role: Role; links?: MembershipLinkInput[] }[]
}

export const DEMO_INSTITUTIONS = [
  { slug: 'akademi', name: 'Akademi Özel Okulları', type: 'school' },
  { slug: 'kampus-dil', name: 'Kampüs Dil Akademisi', type: 'language_school' },
] as const satisfies readonly DemoInstitution[]

/**
 * Kurucu yönetici her iki kurumun da sahibidir. Akademi kişileri ve kayıt kimlikleri
 * school-core örnek verisiyle aynıdır (`modules/navigation.js` → `roles`, `data/seed.js`:
 * öğretmen `t1` Selin Kaya, öğrenci `s1` Deniz, `s2` Ece, veli `p1` Ayşe Yılmaz). Kimlikler
 * school-core'dan içe aktarılmaz; veri olduğu için burada sabittir. Dil akademisi kişileri
 * kurgusaldır, kayıtları `records` deposu gelince bağlanır. Gerçek kişi verisi yoktur.
 */
const FOUNDER: DemoMember = {
  name: 'Murat Yılmaz',
  email: 'murat.yilmaz@kampus.example',
  memberships: [
    { institution: 'akademi', role: 'yonetici' },
    { institution: 'kampus-dil', role: 'yonetici' },
  ],
}

export const DEMO_MEMBERS: readonly DemoMember[] = [
  FOUNDER,
  {
    name: 'Büşra Aydın',
    email: 'busra.aydin@kampus.example',
    memberships: [{ institution: 'akademi', role: 'onburo' }],
  },
  {
    name: 'Selin Kaya',
    email: 'selin.kaya@kampus.example',
    memberships: [
      { institution: 'akademi', role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] },
    ],
  },
  {
    name: 'Deniz Yılmaz',
    email: 'deniz.yilmaz@kampus.example',
    memberships: [
      { institution: 'akademi', role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] },
    ],
  },
  {
    name: 'Ayşe Yılmaz',
    email: 'ayse.yilmaz@kampus.example',
    memberships: [
      {
        institution: 'akademi',
        role: 'veli',
        links: [
          { kind: 'child', recordId: 's1' },
          { kind: 'child', recordId: 's2' },
        ],
      },
    ],
  },
  {
    name: 'Gizem Tunç',
    email: 'gizem.tunc@kampus.example',
    memberships: [{ institution: 'kampus-dil', role: 'onburo' }],
  },
  {
    name: 'Ozan Er',
    email: 'ozan.er@kampus.example',
    memberships: [{ institution: 'kampus-dil', role: 'ogretmen' }],
  },
  {
    name: 'Lale Sezer',
    email: 'lale.sezer@kampus.example',
    memberships: [{ institution: 'kampus-dil', role: 'ogrenci' }],
  },
  {
    name: 'Hakan Sezer',
    email: 'hakan.sezer@kampus.example',
    memberships: [{ institution: 'kampus-dil', role: 'veli' }],
  },
]

/** İdempotent: var olan kullanıcı, kurum, üyelik ve bağlantı yeniden açılmaz, parola değişmez. */
export async function seedDemo(auth: Auth, db: Database, password: string) {
  const founder = await ensureUser(auth, { ...FOUNDER, password })
  const institutionIds = new Map<string, string>()
  for (const institution of DEMO_INSTITUTIONS) {
    const { id } = await ensureInstitution(auth, db, { ...institution, creatorUserId: founder.id })
    institutionIds.set(institution.slug, id)
  }
  for (const member of DEMO_MEMBERS) {
    const user = await ensureUser(auth, { name: member.name, email: member.email, password })
    for (const membership of member.memberships) {
      const institutionId = institutionIds.get(membership.institution)
      if (!institutionId) continue
      const { id } = await ensureMember(auth, db, {
        institutionId,
        userId: user.id,
        role: membership.role,
      })
      await ensureMembershipLinks(db, institutionId, id, membership.links ?? [])
    }
  }
  return { institutionIds: Object.fromEntries(institutionIds) }
}
