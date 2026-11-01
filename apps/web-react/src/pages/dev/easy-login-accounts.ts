// Yalnız geliştirme: "Kolay giriş" penceresinin demo hesapları ve gruplaması. Yalnız
// `EasyLogin.tsx` içe aktarır; o da giriş sayfasında `import.meta.env.DEV` koşuluyla yüklenir,
// bu yüzden hesaplar ve parola üretim derlemesine girmez (`vite.config.ts` `devOnlyGuard`).
//
// Kaynak API tohumudur (`apps/api/src/db/demo-seed.ts` `DEMO_MEMBERS`). Tohum sunucu koduna
// (Better Auth, Drizzle) bağlı olduğundan web'e alınamaz; liste burada tutulur ve tohumla
// eşitliğini `tests/easy-login-accounts.test.ts` denetler: tohuma hesap eklenince test kırılır.
import type { RoleKey } from '../../lib/navigation.ts'

/** Pencerede kurumların sırası (tohumdaki `DEMO_INSTITUTIONS` sırası). */
export const EASY_LOGIN_INSTITUTIONS = ['Akademi Özel Okulları', 'Kampüs Dil Akademisi'] as const
export type EasyLoginInstitution = (typeof EASY_LOGIN_INSTITUTIONS)[number]

const [AKADEMI, KAMPUS_DIL] = EASY_LOGIN_INSTITUTIONS

/** Kurum içinde rollerin sırası ve pencerede görünen adı. */
export const EASY_LOGIN_ROLES = [
  { role: 'yonetici', label: 'Yönetici' },
  { role: 'onburo', label: 'Ön büro' },
  { role: 'ogretmen', label: 'Öğretmen' },
  { role: 'ogrenci', label: 'Öğrenci' },
  { role: 'veli', label: 'Veli' },
] as const satisfies readonly { role: RoleKey; label: string }[]

export type EasyLoginAccount = {
  name: string
  email: string
  role: RoleKey
  institution: EasyLoginInstitution
}

/** Üyelik başına bir satır: iki kurumda üyeliği olan hesap iki kez bulunur. */
export const EASY_LOGIN_ACCOUNTS: readonly EasyLoginAccount[] = [
  {
    institution: AKADEMI,
    role: 'yonetici',
    name: 'Murat Yılmaz',
    email: 'murat.yilmaz@kampus.example',
  },
  {
    institution: AKADEMI,
    role: 'onburo',
    name: 'Büşra Aydın',
    email: 'busra.aydin@kampus.example',
  },
  {
    institution: AKADEMI,
    role: 'ogretmen',
    name: 'Selin Kaya',
    email: 'selin.kaya@kampus.example',
  },
  {
    institution: AKADEMI,
    role: 'ogrenci',
    name: 'Deniz Yılmaz',
    email: 'deniz.yilmaz@kampus.example',
  },
  { institution: AKADEMI, role: 'veli', name: 'Ayşe Yılmaz', email: 'ayse.yilmaz@kampus.example' },
  {
    institution: KAMPUS_DIL,
    role: 'yonetici',
    name: 'Murat Yılmaz',
    email: 'murat.yilmaz@kampus.example',
  },
  {
    institution: KAMPUS_DIL,
    role: 'onburo',
    name: 'Gizem Tunç',
    email: 'gizem.tunc@kampus.example',
  },
  { institution: KAMPUS_DIL, role: 'ogretmen', name: 'Ozan Er', email: 'ozan.er@kampus.example' },
  {
    institution: KAMPUS_DIL,
    role: 'ogrenci',
    name: 'Lale Sezer',
    email: 'lale.sezer@kampus.example',
  },
  {
    institution: KAMPUS_DIL,
    role: 'veli',
    name: 'Hakan Sezer',
    email: 'hakan.sezer@kampus.example',
  },
]

/** API'nin geliştirme varsayılanı (`DEFAULT_DEMO_PASSWORD`); `VITE_DEMO_PASSWORD` ile değişir. */
export const DEFAULT_EASY_LOGIN_PASSWORD = 'Demo-Giris-2026!'

export function easyLoginPassword(configured: unknown): string {
  return typeof configured === 'string' && configured.trim() !== ''
    ? configured
    : DEFAULT_EASY_LOGIN_PASSWORD
}

export function roleLabel(role: RoleKey): string {
  return EASY_LOGIN_ROLES.find((item) => item.role === role)?.label ?? role
}

export function accountKey(account: EasyLoginAccount): string {
  return `${account.institution}|${account.role}|${account.email}`
}

export type EasyLoginRoleGroup = { role: RoleKey; label: string; accounts: EasyLoginAccount[] }
export type EasyLoginGroup = { institution: string; roles: EasyLoginRoleGroup[] }

const collator = new Intl.Collator('tr')

function rank(order: readonly string[], value: string): number {
  const index = order.indexOf(value)
  return index === -1 ? order.length : index
}

/**
 * Önce kurum (bilinen sıra, sonra ada göre), kurum içinde rol (Yönetici → Veli), rol içinde
 * ada göre sıralı gruplar. Hesabı olmayan rol grubu çıkmaz.
 */
export function groupEasyLoginAccounts(accounts: readonly EasyLoginAccount[]): EasyLoginGroup[] {
  const institutionOrder: readonly string[] = EASY_LOGIN_INSTITUTIONS
  const roleOrder: readonly string[] = EASY_LOGIN_ROLES.map((item) => item.role)
  const institutions = [...new Set(accounts.map((account) => account.institution))].sort(
    (a, b) => rank(institutionOrder, a) - rank(institutionOrder, b) || collator.compare(a, b),
  )
  return institutions.map((institution) => {
    const inInstitution = accounts.filter((account) => account.institution === institution)
    const roles = [...new Set(inInstitution.map((account) => account.role))].sort(
      (a, b) => rank(roleOrder, a) - rank(roleOrder, b),
    )
    return {
      institution,
      roles: roles.map((role) => ({
        role,
        label: roleLabel(role),
        accounts: inInstitution
          .filter((account) => account.role === role)
          .sort((a, b) => collator.compare(a.name, b.name)),
      })),
    }
  })
}

/** `/me` yanıtının kurum değiştirme için gereken kısmı. */
export type MeInstitutions = {
  activeInstitution: { id: string; name: string } | null
  memberships: readonly { institutionId: string; institutionName: string }[]
}

/**
 * Girişten sonra geçilecek kurumun kimliği. Seçilen satırın kurumu oturumun etkin kurumuysa ya
 * da hesabın o kurumda üyeliği yoksa `null` (geçiş yapılmaz).
 */
export function institutionToActivate(
  account: EasyLoginAccount,
  me: MeInstitutions,
): string | null {
  if (me.activeInstitution?.name === account.institution) return null
  const target = me.memberships.find((item) => item.institutionName === account.institution)
  return target && target.institutionId !== me.activeInstitution?.id ? target.institutionId : null
}
