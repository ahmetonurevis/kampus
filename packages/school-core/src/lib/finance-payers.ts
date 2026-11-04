import { z } from 'zod'

import type { State } from '../data/seed.ts'
import { requiredText, type MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import type { GuardianDraft, GuardianLink } from './guardianship.ts'

/**
 * Yetişkin kursiyerin ayrı ödeyicisi (ON-124; docs/domain/kayit-ve-crm.md DOM-KAY-012,
 * iletisim-ve-veli.md DOM-ILT-074; ADR 0008 karar 5; kullanıcı kararı 2 Kasım 2026). Kursta 18 yaş
 * ve üstü kursiyerin velisi yoktur, sözleşmenin tarafı kendisidir; ücreti başka biri (aile) ödüyorsa
 * o kişi yalnız ödeyici olarak bağlanır:
 *
 * - Bağ `student_guardians` satırıdır: velayet `none`, `isPayer: true`, iletişim kısıtı ve teslim
 *   yetkisi kapalı. Velayetsiz bağ çocuk bağlantısına kapsam vermez (`guardedActorLinks`): ödeyici
 *   not, devam, ödev, mesaj ve randevu görmez, rıza veremez (`isCustodial`). Ödeyici bağı finans
 *   okumasını (fatura, sözleşme, tahsilat ve dekont, bakiye, ekstre) ve finans bildirimini açar
 *   (K-04, `payerActorLinks`).
 * - Ödeyici velayetli veli sayılmaz; bu yüzden yetişkin kursiyerde `guardian_not_applicable`
 *   almaz. Velayetli veli kuralı (en az bir velayetli bağ, DOM-ILT-075) yalnız 18 yaş altındaki
 *   öğrencinin bağ kümesidir; yetişkin kursiyerin ödeyici bağı ondan muaftır.
 * - Okulda (`school`) ve 18 yaş altında ödeyici velidir; ayrı ödeyici 422 `payer_not_applicable`.
 * - Sözleşmenin `payer` alanı `student` kalır: borcun ve onayın tarafı kursiyerdir, sözleşme onayı
 *   ve sözleşme bildirimleri (ON-044) kursiyere gider. Ödeyici taksit, tahsilat ve iade
 *   bildirimini veli kitlesinden alır.
 *
 * Fonksiyonlar saftır; öğrencinin yaşı (`minor`, core `isMinorLearner`) ve bağları servisçe
 * yüklenir.
 */

z.config(z.locales.tr())

/**
 * Ödeyicinin kursiyere yakınlığı. Vasi (`legal_guardian`) velayetli bağdır (DOM-ILT-072);
 * yetişkinin vasisi yasal temsilcidir, yalnız ödeyici olarak kaydedilmez.
 */
export const ADULT_PAYER_RELATIONSHIPS = ['mother', 'father', 'other'] as const
export type AdultPayerRelationship = (typeof ADULT_PAYER_RELATIONSHIPS)[number]

/**
 * Ödeyici kişi: kurumdaki bir veli kaydı (`existingParentId`, ör. kardeşin annesi) ya da yeni kişi.
 * Kesin kayıt gövdesinin `payer` alanı ve `POST /finance/students/:studentId/payers` gövdesidir.
 */
export const adultPayerSchema = z.union([
  z.strictObject({ existingParentId: requiredText }),
  z.strictObject({
    // kvkk: K — ödeyicinin adı
    name: requiredText.max(80),
    // kvkk: K — ödeyicinin telefonu
    phone: z.string().regex(/^0\d{10}$/, 'Telefonu 05XXXXXXXXX biçiminde girin.'),
    relationship: z.enum(ADULT_PAYER_RELATIONSHIPS, 'Yakınlık derecesini seçin.'),
  }),
])
export type AdultPayerInput = z.input<typeof adultPayerSchema>

/** Ödeyici olacak mevcut veli kaydı (`parents`) ve kurumdaki etkin bağları. */
export interface PayerParent {
  id: string
  relationship?: string | undefined
}
export type PayerParentBond = Pick<GuardianLink, 'contactRestricted'>

const NOT_APPLICABLE =
  'Ayrı ödeyici yalnız 18 yaş ve üstü kursiyere eklenir; okulda ve 18 yaş altında ödeyici velidir.'

/**
 * Ayrı ödeyici bu öğrenciye eklenebilir mi: yalnız kurs türünde 18 yaş ve üstü kursiyer
 * (`minor` core `isMinorLearner`; okulda her öğrenci 18 yaş altı sayılır). Değilse 422
 * `payer_not_applicable`.
 */
export function requireSeparatePayerAllowed(minor: boolean) {
  if (minor) throw new DomainError('payer_not_applicable', NOT_APPLICABLE, { path: ['payer'] })
}

/**
 * Mevcut veli kaydı ödeyici olabilir mi: yetişkin kursiyerin kendi satırı (`relationship: 'self'`)
 * başka birinin ödeyicisi olarak bağlanmaz; kurumdaki herhangi bir bağında iletişim kısıtı olan
 * kişi ödeyici olamaz (DOM-ILT-074). Kısıtın hangi öğrencide olduğu iletide söylenmez.
 */
export function requireEligiblePayerParent(
  bonds: readonly PayerParentBond[],
  isSelfRecord: boolean,
) {
  if (isSelfRecord || bonds.some((bond) => bond.contactRestricted))
    throw new DomainError(
      'payer_not_eligible',
      'Seçilen kayıt ödeyici olarak bağlanamaz (kursiyerin kendi kaydı ya da iletişim kısıtı var). Ödeyiciyi yeni kişi olarak girin.',
      { path: ['payer'] },
    )
}

/** Mevcut kaydın yakınlığı ödeyici yakınlığıysa o, değilse `other`. */
export function payerRelationshipOf(
  input: z.infer<typeof adultPayerSchema>,
  parent: PayerParent | undefined,
): AdultPayerRelationship {
  const wanted = 'relationship' in input ? input.relationship : parent?.relationship
  return ADULT_PAYER_RELATIONSHIPS.find((item) => item === wanted) ?? 'other'
}

/**
 * Ödeyici bağını kurar (ON-124). `links` öğrencinin etkin bağlarıdır: ödeyicisi varsa 409
 * `guardian_payer_exists`, aynı veli kaydı zaten bağlıysa 409 `guardian_link_exists`. Bağ velayetsiz,
 * kısıtsız, teslim yetkisizdir; hesap (`membershipId`) veli hesabı davetiyle bağlanır
 * (`POST /institution-members/guardian-invitations`, DOM-YTK-071). Doğrulama hatasında hiçbir şey
 * değişmez; dönen taslak servisçe yazılır.
 */
export function planAdultPayerLink(input: {
  studentId: string
  parentId: string
  relationship: AdultPayerRelationship
  minor: boolean
  links: readonly GuardianLink[]
}): GuardianDraft {
  requireSeparatePayerAllowed(input.minor)
  const own = input.links.filter((link) => link.studentId === input.studentId)
  if (own.some((link) => link.isPayer))
    throw new DomainError('guardian_payer_exists', 'Öğrencinin ödeyicisi zaten var.', {
      kind: 'conflict',
      path: ['payer'],
    })
  if (own.some((link) => link.parentId === input.parentId))
    throw new DomainError('guardian_link_exists', 'Bu kişi öğrenciye zaten bağlı.', {
      kind: 'conflict',
      path: ['payer'],
    })
  return {
    studentId: input.studentId,
    parentId: input.parentId,
    membershipId: null,
    relationship: input.relationship,
    custody: 'none',
    contactRestricted: false,
    isPayer: true,
    canPickUp: false,
  }
}

/**
 * Yeni ödeyici kişinin veli kaydı (`parents`). Öğrenci `studentIds`'e yazılmaz: veli kaydının
 * öğrencileri öğretmenin ve öğrencinin okuduğu veli satırlarını belirler (`platform/scope.ts`
 * `parents`); yalnız ödeyen kişi öğretmene ve kursiyere veli olarak görünmez. Kişiyle öğrenci
 * arasındaki tek bağ `student_guardians` satırıdır.
 */
export function newPayerParent(
  id: string,
  input: { name: string; phone: string; relationship: AdultPayerRelationship },
) {
  return {
    id,
    // kvkk: K
    name: input.name,
    studentIds: [] as string[],
    // kvkk: K
    phone: input.phone,
    relationship: input.relationship,
  }
}

/** Doğrulanmış ödeyici kişi: mevcut veli kaydı ya da açılacak yeni kayıt. */
export type ResolvedPayer =
  | { kind: 'existing'; parentId: string; relationship: AdultPayerRelationship }
  | { kind: 'new'; name: string; phone: string; relationship: AdultPayerRelationship }

/**
 * Gövdedeki ödeyiciyi doğrular, hiçbir şey yazmaz: ayrı ödeyici yalnız yetişkin kursiyerde
 * (`payer_not_applicable`), mevcut kayıt kurumda olmalı (404 `parent_not_found`) ve ödeyici
 * olabilmeli (`payer_not_eligible`). `isSelfRecord` veli kaydının gerçekte bir kişi olarak veli
 * olmadığını (yetişkin kursiyerin kendi satırı ya da eski yer tutucu; `lib/enrollment.ts`
 * `isNotGuardian`) söyler; `parentBonds` mevcut kaydın kurumdaki etkin bağlarıdır.
 */
export function resolveAdultPayer<P extends PayerParent>(
  parents: readonly P[],
  input: z.infer<typeof adultPayerSchema>,
  options: {
    minor: boolean
    parentBonds: readonly PayerParentBond[]
    isSelfRecord: (parent: P) => boolean
  },
): ResolvedPayer {
  requireSeparatePayerAllowed(options.minor)
  if ('name' in input) return { kind: 'new', ...input }
  const parent = parents.find((item) => item.id === input.existingParentId)
  if (parent === undefined)
    throw new DomainError('parent_not_found', 'Ödeyici olarak seçilen kayıt bulunamadı.', {
      kind: 'not_found',
      path: ['payer'],
    })
  requireEligiblePayerParent(options.parentBonds, options.isSelfRecord(parent))
  return { kind: 'existing', parentId: parent.id, relationship: payerRelationshipOf(input, parent) }
}

/**
 * Doğrulanmış ödeyiciyi öğrenciye bağlar: bağ kuralı (`planAdultPayerLink`) yazmadan önce
 * çalışır; geçerse yeni kişinin veli kaydı `parents`'a eklenir. Ret durumunda State değişmez.
 */
export function attachAdultPayer(
  state: Pick<State, 'parents'>,
  payer: ResolvedPayer,
  input: { studentId: string; minor: boolean; links: readonly GuardianLink[]; makeId: MakeId },
): GuardianDraft {
  const created = payer.kind === 'new' ? newPayerParent(input.makeId('p'), payer) : null
  const draft = planAdultPayerLink({
    studentId: input.studentId,
    parentId: created?.id ?? (payer.kind === 'existing' ? payer.parentId : ''),
    relationship: payer.relationship,
    minor: input.minor,
    links: input.links,
  })
  if (created !== null) state.parents.push(created)
  return draft
}
