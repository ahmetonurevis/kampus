import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import type { GuardianBond } from './consents.ts'
import { DomainError } from './errors.ts'

/**
 * Veli–öğrenci bağı (IST-019; docs/domain/iletisim-ve-veli.md DOM-ILT-070…075). Bir öğrencinin
 * birden çok velisi olabilir; her bağ yakınlığı, velayet durumunu, iletişim kısıtını, ödeyici
 * olup olmadığını ve teslim alma yetkisini taşır. Veli bir veli kaydı (`parents`, `parentId`) ya
 * da platform veli hesabıdır (üyelik, `membershipId`); ikisi birlikte de verilebilir.
 *
 * - Velayet sahibi (`full`) ve ortak velayetli (`joint`) veli tam veli yetkisini kullanır;
 *   velayeti olmayan (`none`) ebeveyn varsayılan olarak erişimsizdir ve rıza/izin veremez
 *   (DOM-ILT-070, DOM-ILT-031, DOM-YTK-057). Vasi (`legal_guardian`) velayetli bağdır (DOM-ILT-072).
 * - İletişim kısıtlı veli (mahkeme kararı, koruma) öğrencinin verisini görmez, bildirim almaz;
 *   velayetli, ödeyici ve teslim alma yetkilisi olamaz (DOM-ILT-074).
 * - Öğrencinin en çok bir ödeyicisi vardır (DOM-ILT-074); bağı olan öğrencide en az bir velayetli
 *   bağ kalır (DOM-ILT-075). Yetişkin kursiyerin bağı olmayabilir (DOM-YTK-030).
 *
 * Fonksiyonlar saftır: girdi öğrencinin servisçe yüklenmiş etkin (arşivlenmemiş) bağlarıdır;
 * kimlik, yükleme ve yazma servistedir (`apps/api/src/services/guardians.ts`). Velayet belgesi
 * (DOM-ILT-071) henüz yok: TODO(velayet-belgesi).
 */

z.config(z.locales.tr())

export const GUARDIAN_RELATIONSHIPS = {
  mother: { label: 'Anne' },
  father: { label: 'Baba' },
  legal_guardian: { label: 'Vasi' },
  other: { label: 'Diğer yakın' },
} as const satisfies Record<string, { label: string }>
export type GuardianRelationship = keyof typeof GUARDIAN_RELATIONSHIPS
export const GUARDIAN_RELATIONSHIP_KEYS = Object.keys(GUARDIAN_RELATIONSHIPS) as [
  GuardianRelationship,
  ...GuardianRelationship[],
]

/** Velayet durumu (DOM-ILT-070): velayet sahibi, ortak velayet, velayeti yok. */
export const CUSTODY_KINDS = {
  full: { label: 'Velayet sahibi' },
  joint: { label: 'Ortak velayet' },
  none: { label: 'Velayeti yok' },
} as const satisfies Record<string, { label: string }>
export type CustodyKind = keyof typeof CUSTODY_KINDS
export const CUSTODY_KIND_KEYS = Object.keys(CUSTODY_KINDS) as [CustodyKind, ...CustodyKind[]]

/** Bağın kaydı (servisin yüklediği etkin satır). */
export type GuardianLink = {
  id: string
  // kvkk: K — öğrenci kaydı
  studentId: string
  // kvkk: K — veli kaydı (`parents`); hesabı olmayan veli için
  parentId: string | null
  // kvkk: K — veli hesabının üyeliği
  membershipId: string | null
  relationship: GuardianRelationship
  // kvkk: Ç — velayet durumu (hassas; özel nitelikli değil, belge ayrıntısı tutulmaz)
  custody: CustodyKind
  // kvkk: Ç — iletişim kısıtı (koruma kararının yalnız varlığı; ayrıntı tutulmaz)
  contactRestricted: boolean
  isPayer: boolean
  canPickUp: boolean
}

/** Yeni bağın alanları (kimliği servis verir). */
export type GuardianDraft = Omit<GuardianLink, 'id'>

const recordId = (message: string) => z.string().trim().min(1, message).max(200)

const bondFields = {
  relationship: z.enum(GUARDIAN_RELATIONSHIP_KEYS, 'Yakınlık derecesini seçin.'),
  custody: z.enum(CUSTODY_KIND_KEYS, 'Velayet durumunu seçin.'),
  contactRestricted: z.boolean(),
  isPayer: z.boolean(),
  canPickUp: z.boolean(),
}

/**
 * Bağ kurma girdisi (`linkGuardian`): veli kaydı ya da hesabı (en az biri), yakınlık ve velayet
 * zorunlu; kısıt, ödeyici ve teslim alma varsayılan olarak kapalı. Öğrenci kimliği yoldan gelir.
 */
export const linkGuardianSchema = z
  .strictObject({
    parentId: recordId('Veli kaydını seçin.').optional(),
    membershipId: recordId('Veli hesabını seçin.').optional(),
    relationship: bondFields.relationship,
    custody: bondFields.custody,
    contactRestricted: bondFields.contactRestricted.default(false),
    isPayer: bondFields.isPayer.default(false),
    canPickUp: bondFields.canPickUp.default(false),
  })
  .refine((data) => data.parentId !== undefined || data.membershipId !== undefined, {
    message: 'Veli kaydını ya da veli hesabını seçin.',
    path: ['parentId'],
  })
export type LinkGuardianInput = z.input<typeof linkGuardianSchema>

/** Bağ değişikliği (`updateGuardianLink`): en az bir alan. Veli kimliği değişmez (yeni bağ açılır). */
export const updateGuardianLinkSchema = z
  .strictObject({
    relationship: bondFields.relationship.optional(),
    custody: bondFields.custody.optional(),
    contactRestricted: bondFields.contactRestricted.optional(),
    isPayer: bondFields.isPayer.optional(),
    canPickUp: bondFields.canPickUp.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Değiştirilecek bir alan seçin.',
  })
export type UpdateGuardianLinkInput = z.input<typeof updateGuardianLinkSchema>

/** Velayetli ve kısıtsız bağ: tam veli yetkisi (DOM-ILT-070, DOM-ILT-072). */
export const isCustodial = (link: Pick<GuardianLink, 'custody' | 'contactRestricted'>) =>
  link.custody !== 'none' && !link.contactRestricted

const ownBond = (link: GuardianLink, studentId: string, membershipId: string) =>
  link.studentId === studentId && link.membershipId === membershipId

/** Hesap bu öğrencinin velayetli velisi mi (rıza, izin, tam erişim; DOM-ILT-070). */
export const hasCustody = (
  links: readonly GuardianLink[],
  studentId: string,
  membershipId: string,
) => links.some((link) => ownBond(link, studentId, membershipId) && isCustodial(link))

/** Hesabın bu öğrencideki bağı iletişim kısıtlı mı (DOM-ILT-074); bağ yoksa hayır. */
export const isContactRestricted = (
  links: readonly GuardianLink[],
  studentId: string,
  membershipId: string,
) => links.some((link) => ownBond(link, studentId, membershipId) && link.contactRestricted)

/**
 * Öğrencinin ödeyicisi (DOM-ILT-074); yoksa `null`. Finans bildirimini alacak veli bu bağdır:
 * hesabı varsa `membershipId`, yoksa veli kaydı `parentId`. Kısıtlı veli ödeyici olamaz.
 */
export const payerOf = (links: readonly GuardianLink[], studentId: string): GuardianLink | null =>
  links.find((link) => link.studentId === studentId && link.isPayer && !link.contactRestricted) ??
  null

/**
 * Hesabın veli olarak erişebildiği öğrenciler (DOM-ILT-070): velayetli ve kısıtsız bağlar.
 * Velayeti olmayan ebeveyn varsayılan olarak erişimsizdir; velayet sahibinin onayıyla kapsamlı
 * erişim henüz yok (`TODO(velayet-onayi)`). Okuma kapsamı bunu `guardedActorLinks` ile okur.
 */
export function accessibleStudentIds(
  links: readonly GuardianLink[],
  membershipId: string,
): string[] {
  const ids = new Set<string>()
  for (const link of links)
    if (link.membershipId === membershipId && isCustodial(link)) ids.add(link.studentId)
  return [...ids].sort()
}

/**
 * Aktörün okuma kapsamı bağlantıları (IST-019; DOM-ILT-070, DOM-ILT-074). Veli hesabının çocuk
 * bağlantısı (`child`) yalnız aynı öğrencide velayetli ve kısıtsız bir bağı (`accessibleStudentIds`)
 * varsa kapsam verir: iletişim kısıtlı ya da velayeti olmayan veli öğrencinin hiçbir verisini
 * (not, yoklama, mesaj, bildirim, pano) görmez, öğrenci çocuk listesinde de yoktur. Bağı
 * kaldırılmış ya da hiç kurulmamış bağlantı da kapsam vermez (kapalı başarısız). Öğrenci ve
 * öğretmen bağlantıları değişmez. Kapsam tek yerde, aktör kurulurken daralır; `scopeFor` ve
 * bağlantıyı okuyan her karar daraltılmış listeyi görür. `guardians` hesabın etkin bağlarıdır.
 */
export function guardedActorLinks<L extends { kind: string; recordId: string }>(
  links: readonly L[],
  guardians: readonly GuardianLink[],
  membershipId: string,
): L[] {
  if (!links.some((link) => link.kind === 'child')) return [...links]
  const accessible = new Set(accessibleStudentIds(guardians, membershipId))
  return links.filter((link) => link.kind !== 'child' || accessible.has(link.recordId))
}

/**
 * Rıza kararının girdisi (`lib/consents.ts` `GuardianBond`; DOM-YTK-057): hesabın her bağı
 * doğrulanmış sayılır (bağı kurum kurar); velayet `isCustodial`'dan gelir.
 */
export function guardianBondsFor(
  links: readonly GuardianLink[],
  membershipId: string,
): GuardianBond[] {
  return links
    .filter((link) => link.membershipId === membershipId)
    .map((link) => ({ studentId: link.studentId, verified: true, custody: isCustodial(link) }))
}

const rule = (code: string, message: string, path: string[]) =>
  new DomainError(code, message, { path })

/**
 * Tek bağın kendi tutarlılığı: kısıtlı veli velayetli, ödeyici ve teslim alma yetkilisi
 * olamaz (DOM-ILT-074); vasi velayetlidir (DOM-ILT-072).
 */
function requireConsistentBond(bond: GuardianDraft) {
  if (bond.contactRestricted) {
    if (bond.custody !== 'none')
      throw rule('guardian_restricted_custody', 'İletişim kısıtlı veli velayet sahibi olamaz.', [
        'custody',
      ])
    if (bond.isPayer)
      throw rule('guardian_restricted_payer', 'İletişim kısıtlı veli ödeyici olamaz.', ['isPayer'])
    if (bond.canPickUp)
      throw rule('guardian_restricted_pickup', 'İletişim kısıtlı veli öğrenciyi teslim alamaz.', [
        'canPickUp',
      ])
  }
  if (bond.relationship === 'legal_guardian' && bond.custody === 'none')
    throw rule('guardian_legal_custody', 'Vasi velayet sahibi olarak kaydedilir.', ['custody'])
}

/**
 * Öğrencinin bağ kümesinin değişmezleri: en çok bir ödeyici (DOM-ILT-074, 409) ve bağı olan
 * öğrencide en az bir velayetli bağ (DOM-ILT-075, 422). `changed` yeni ya da değişen bağdır.
 */
function requireStudentInvariants(others: readonly GuardianDraft[], changed: GuardianDraft | null) {
  if (changed?.isPayer === true && others.some((link) => link.isPayer))
    throw new DomainError('guardian_payer_exists', 'Öğrencinin ödeyicisi zaten var.', {
      kind: 'conflict',
      path: ['isPayer'],
    })
  const after = changed === null ? others : [...others, changed]
  if (after.length > 0 && !after.some(isCustodial))
    throw rule('guardian_custody_required', 'Öğrencinin en az bir velayet sahibi velisi kalmalı.', [
      'custody',
    ])
}

/** Bağlanacak veli hesabı: üyeliğin rolü (servis kurumda bulamazsa 404 verir). */
export type GuardianAccount = { role: Role }

/**
 * Veli kaydı ile hesap birlikte verildiğinde aynı kişiye ait olmalıdır (DOM-ILT-070). Kayıt ile
 * hesap arasında ayrı eşleme yoktur; eşleme kurumun etkin bağlarından okunur: kayıt başka bir
 * bağda başka bir hesapla ya da hesap başka bir kayıtla eşlenmişse 422
 * `guardian_identity_mismatch`. İkisi de daha önce eşlenmemişse ilk bağ eşlemeyi kurar.
 */
export function requireSameGuardian(
  parentId: string,
  membershipId: string,
  identityLinks: readonly GuardianLink[],
) {
  const conflicting = identityLinks.some(
    (link) =>
      (link.parentId === parentId &&
        link.membershipId !== null &&
        link.membershipId !== membershipId) ||
      (link.membershipId === membershipId && link.parentId !== null && link.parentId !== parentId),
  )
  if (conflicting)
    throw rule('guardian_identity_mismatch', 'Veli kaydı ile veli hesabı aynı kişiye ait değil.', [
      'membershipId',
    ])
}

/**
 * Bağ kurar (`linkGuardian`; DOM-ILT-070…075). `links` öğrencinin etkin bağlarıdır;
 * `identityLinks` aynı veli kaydının ya da hesabının kurumdaki (her öğrencideki) etkin
 * bağlarıdır ve ikisi birlikte verildiğinde eşlemeyi denetler (`requireSameGuardian`). Hesap
 * verilmişse veli rolünde olmalıdır (`guardian_account_not_parent`); aynı veli kaydı ya da hesabı
 * öğrenciye ikinci kez bağlanmaz (409 `guardian_link_exists`). Doğrulama hatasında hiçbir şey
 * değişmez; dönen taslak servisçe yazılır.
 */
export function planGuardianLink(input: {
  studentId: string
  links: readonly GuardianLink[]
  identityLinks?: readonly GuardianLink[]
  account: GuardianAccount | null
  input: unknown
}): GuardianDraft {
  const data = linkGuardianSchema.parse(input.input)
  if (data.membershipId !== undefined && input.account?.role !== 'veli')
    throw rule('guardian_account_not_parent', 'Seçilen hesap veli hesabı değil.', ['membershipId'])
  if (data.parentId !== undefined && data.membershipId !== undefined)
    requireSameGuardian(data.parentId, data.membershipId, [
      ...input.links,
      ...(input.identityLinks ?? []),
    ])
  const own = input.links.filter((link) => link.studentId === input.studentId)
  if (
    own.some(
      (link) =>
        (data.parentId !== undefined && link.parentId === data.parentId) ||
        (data.membershipId !== undefined && link.membershipId === data.membershipId),
    )
  )
    throw new DomainError('guardian_link_exists', 'Bu veli öğrenciye zaten bağlı.', {
      kind: 'conflict',
    })
  const draft: GuardianDraft = {
    studentId: input.studentId,
    parentId: data.parentId ?? null,
    membershipId: data.membershipId ?? null,
    relationship: data.relationship,
    custody: data.custody,
    contactRestricted: data.contactRestricted,
    isPayer: data.isPayer,
    canPickUp: data.canPickUp,
  }
  requireConsistentBond(draft)
  requireStudentInvariants(own, draft)
  return draft
}

const linkNotFound = () =>
  new DomainError('guardian_link_not_found', 'Veli bağı bulunamadı.', { kind: 'not_found' })

function splitLinks(links: readonly GuardianLink[], studentId: string, linkId: string) {
  const own = links.filter((link) => link.studentId === studentId)
  const link = own.find((item) => item.id === linkId)
  if (link === undefined) throw linkNotFound()
  return { link, others: own.filter((item) => item.id !== linkId) }
}

/**
 * Bağı değiştirir (`updateGuardianLink`; DOM-ILT-071…075): velayet, kısıt, ödeyici, teslim alma
 * ve yakınlık. Bağ yoksa 404; tutarlılık ve öğrenci değişmezleri `planGuardianLink` ile aynıdır.
 * `fields` gönderilen alanların adlarıdır (denetime değer yazılmaz).
 */
export function planGuardianUpdate(input: {
  studentId: string
  linkId: string
  links: readonly GuardianLink[]
  input: unknown
}): { link: GuardianLink; fields: string[] } {
  const data = updateGuardianLinkSchema.parse(input.input)
  const { link, others } = splitLinks(input.links, input.studentId, input.linkId)
  const fields = Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
  const next: GuardianLink = {
    ...link,
    relationship: data.relationship ?? link.relationship,
    custody: data.custody ?? link.custody,
    contactRestricted: data.contactRestricted ?? link.contactRestricted,
    isPayer: data.isPayer ?? link.isPayer,
    canPickUp: data.canPickUp ?? link.canPickUp,
  }
  requireConsistentBond(next)
  requireStudentInvariants(others, next)
  return { link: next, fields }
}

/**
 * Bağı kaldırır (`unlinkGuardian`; DOM-ILT-071, DOM-ILT-075): kalan bağlar arasında velayetli
 * yoksa 422 `guardian_custody_required`; son bağ kaldırılabilir. Bağ yoksa 404.
 */
export function planGuardianUnlink(input: {
  studentId: string
  linkId: string
  links: readonly GuardianLink[]
}): GuardianLink {
  const { link, others } = splitLinks(input.links, input.studentId, input.linkId)
  requireStudentInvariants(others, null)
  return link
}

/** Bağın görünümü; velinin kendi görünümünde kısıt alanı yoktur (DOM-ILT-073). */
export type GuardianLinkView = Omit<GuardianLink, 'contactRestricted'> & {
  contactRestricted?: boolean
}

/** Bağları tam okuyan roller: kayıt ve velayet işini yürüten yönetici ve ön büro (DOM-ILT-071). */
export const GUARDIAN_MANAGER_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]

/**
 * Okuma kapsamı (DOM-ILT-073): yönetici ve ön büro öğrencinin bütün bağlarını görür. Veli yalnız
 * kendi hesabının bağını görür; öteki velinin varlığı, kimliği ve kısıtı ona dönmez, kendi bağında
 * da kısıt alanı yoktur. İletişim kısıtlı veli öğrencinin verisini görmez: boş liste (servis 404
 * verir). Diğer roller boş liste alır (uçta zaten 403).
 */
export function guardianLinksView(
  links: readonly GuardianLink[],
  viewer: { role: Role; membershipId: string },
): GuardianLinkView[] {
  if ((GUARDIAN_MANAGER_ROLES as readonly Role[]).includes(viewer.role)) return [...links]
  if (viewer.role !== 'veli') return []
  return links
    .filter((link) => link.membershipId === viewer.membershipId && !link.contactRestricted)
    .map((link) => {
      const own: GuardianLinkView = { ...link }
      delete own.contactRestricted
      return own
    })
}
