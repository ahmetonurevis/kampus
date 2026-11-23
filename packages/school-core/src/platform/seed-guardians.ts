import type { GuardianDraft, GuardianRelationship } from '../lib/guardianship.ts'

/**
 * Örnek veli–öğrenci bağları (IST-019; DOM-ILT-070…075). Bağlar State'te değil ilişkisel
 * tablodadır (`student_guardians`); çevrimdışı demo bunları kullanmaz. Hesap, kurumun demo
 * hesabının rolüyle verilir (`account`): API tohumu o kurumdaki üyelik kimliğine çevirir; hesabı
 * olmayan kurumda o bağ yazılmaz.
 *
 * - Örnek veli (`p1`; Akademi'de Ayşe Yılmaz) Deniz (`s1`) ve Ece'nin (`s2`) velayet sahibi
 *   annesi, ödeyicisi ve teslim alma yetkilisidir.
 * - Deniz'in ikinci velisi (`restrictedParent`; Akademi'de Kemal Yılmaz) velayeti olmayan ve
 *   iletişim kısıtlı babasıdır: öğrencinin verisini görmez, ödeyici ve teslim alan değildir.
 *
 * Kimlikler sabittir (`seedGuardianLinkId`); mevcut kayıt kimlikleri değişmez.
 */

export type GuardianSeedAccount = 'parent' | 'restrictedParent'

export type GuardianSeed = Omit<GuardianDraft, 'membershipId'> & {
  id: string
  account: GuardianSeedAccount
}

export const seedGuardianLinkId = (sequence: number) =>
  `00000000-0000-4000-9000-${String(sequence).padStart(12, '0')}`

export function createGuardianLinks(
  options: { parentRelationship?: GuardianRelationship } = {},
): GuardianSeed[] {
  const relationship = options.parentRelationship ?? 'mother'
  const parent = (sequence: number, studentId: string): GuardianSeed => ({
    id: seedGuardianLinkId(sequence),
    account: 'parent',
    studentId,
    parentId: 'p1',
    relationship,
    custody: 'full',
    contactRestricted: false,
    isPayer: true,
    canPickUp: true,
  })
  return [
    parent(1, 's1'),
    parent(2, 's2'),
    {
      id: seedGuardianLinkId(3),
      account: 'restrictedParent',
      studentId: 's1',
      parentId: null,
      relationship: 'father',
      custody: 'none',
      contactRestricted: true,
      isPayer: false,
      canPickUp: false,
    },
  ]
}
