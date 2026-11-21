import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { DomainError } from './errors.ts'
import { FINANCE_TRANSPORT_ROLES } from './finance-transport.ts'
import {
  GUARDIAN_RELATIONSHIPS,
  GUARDIAN_RELATIONSHIP_KEYS,
  isCustodial,
  type GuardianLink,
  type GuardianRelationship,
} from './guardianship.ts'
import { maskPhone } from './parent-contact.ts'

/**
 * Servis listesi (docs/domain/finans.md DOM-FIN-148; ON-148; IST-028; K-499…K-501). Bir güzergâh
 * (araç × yön) için durak sırasına göre öğrenciler: ad, sınıf, durak ve saat, acil iletişim (veli
 * adı, yakınlığı ve telefonu). Liste yalnız kayıtlı (aktif) öğrenciyi taşır; ayrılan, mezun ve
 * arşivli öğrenci yazılmaz (DOM-KAY-026). Sağlık ve alerji bilgisi listeye girmez (ON-165).
 *
 * - Amaç (K-500): `office` kurum içi liste, veli telefonu maskeli (varsayılan); `driver` sürücüye
 *   verilecek liste, veli telefonu tam. Tam telefon yalnız `TRANSPORT_ROSTER_DRIVER_ROLES`'tadır;
 *   çağıran (API) her okumayı amacıyla denetime yazar, değer yazmaz.
 * - Sürücü telefonu her amaçta maskelidir (K-481); liste sürücünün kendisine verilir.
 * - Acil iletişim (K-501): öğrencinin etkin veli bağlarından velayetli ve iletişim kısıtı olmayanlar
 *   (`isCustodial`); öğrencinin hiç bağı yoksa öğrenci kaydındaki veli (`parentId`). Bağı olup
 *   hiçbiri uygun olmayan öğrencide kayıttaki veliye düşülmez: kısıtlı veli o yoldan sızmaz.
 *   En çok iki kişi, bağ sırasıyla.
 *
 * Fonksiyonlar saftır: kayıtları çağıran yükler.
 */

/** Listeyi okuyan roller: servis yönetimiyle aynı (K-482, K-499). */
export const TRANSPORT_ROSTER_ROLES = FINANCE_TRANSPORT_ROLES
/** Tam veli telefonlu "sürücüye verilecek liste"yi alan roller (K-500). */
export const TRANSPORT_ROSTER_DRIVER_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const TRANSPORT_ROSTER_PURPOSES = ['office', 'driver'] as const
export type TransportRosterPurpose = (typeof TRANSPORT_ROSTER_PURPOSES)[number]
export const TRANSPORT_ROSTER_PURPOSE_LABELS = {
  office: 'Kurum içi liste (veli telefonu maskeli)',
  driver: 'Sürücüye verilecek liste (veli telefonu tam)',
} as const satisfies Record<TransportRosterPurpose, string>

/** Öğrenci başına en çok acil iletişim kişisi (K-501). */
export const TRANSPORT_ROSTER_CONTACTS_MAX = 2

export const transportRosterPurposeSchema = z
  .enum(TRANSPORT_ROSTER_PURPOSES, 'Liste amacı `office` ya da `driver` olmalıdır.')
  .default('office')
  .describe(
    '`office` kurum içi (veli telefonu maskeli, varsayılan), `driver` sürücüye verilecek liste (veli telefonu tam; yalnız yönetici)',
  )

/** Rol bu amaçla listeyi alabilir mi (K-500); web seçeneği de buna göre gösterir. */
export const canUseTransportRosterPurpose = (role: string, purpose: TransportRosterPurpose) =>
  purpose === 'office'
    ? (TRANSPORT_ROSTER_ROLES as readonly string[]).includes(role)
    : (TRANSPORT_ROSTER_DRIVER_ROLES as readonly string[]).includes(role)

/** Tam telefonlu liste yetkisizse 403 (K-500). */
export function assertTransportRosterPurpose(role: string, purpose: TransportRosterPurpose): void {
  if (!canUseTransportRosterPurpose(role, purpose))
    throw new DomainError(
      'transport_roster_driver_forbidden',
      'Sürücüye verilecek tam telefonlu listeyi yalnız yönetici alabilir.',
      { kind: 'forbidden' },
    )
}

// --- Acil iletişim -------------------------------------------------------------------------------

/** Veli kaydı (`parents`): ad, telefon ve isteğe bağlı yakınlık. */
export interface RosterParentRecord {
  id: string
  // kvkk: K (veli kimliği)
  name: string | null
  // kvkk: K (veli iletişimi)
  phone: string | null
  relationship: string | null
}

export interface RosterContact {
  // kvkk: K
  name: string | null
  relationship: GuardianRelationship | null
  // kvkk: K — amaca göre maskeli ya da tam
  phone: string | null
}

const relationshipOf = (value: string | null): GuardianRelationship | null =>
  value !== null && (GUARDIAN_RELATIONSHIP_KEYS as readonly string[]).includes(value)
    ? (value as GuardianRelationship)
    : null

const phoneFor = (phone: string | null, purpose: TransportRosterPurpose): string | null => {
  const value = phone?.trim() ?? ''
  if (value === '') return null
  return purpose === 'driver' ? value : maskPhone(value)
}

/**
 * Öğrencinin acil iletişim kişileri (K-501). `links` öğrencinin etkin bağlarıdır (bağ sırasıyla);
 * `memberNames` hesaplı bağın hesap adı, `parents` veli kayıtları, `studentParentId` öğrenci
 * kaydındaki veli. Telefon amaca göre maskelenir.
 */
export function transportRosterContacts(input: {
  links: readonly Pick<
    GuardianLink,
    'parentId' | 'membershipId' | 'relationship' | 'custody' | 'contactRestricted'
  >[]
  memberNames: ReadonlyMap<string, string>
  parents: ReadonlyMap<string, RosterParentRecord>
  studentParentId: string | null
  purpose: TransportRosterPurpose
}): RosterContact[] {
  const { links, parents, purpose } = input
  if (links.length > 0)
    return links
      .filter(isCustodial)
      .slice(0, TRANSPORT_ROSTER_CONTACTS_MAX)
      .map((link) => {
        const parent = link.parentId === null ? undefined : parents.get(link.parentId)
        const account =
          link.membershipId === null ? undefined : input.memberNames.get(link.membershipId)
        return {
          name: account ?? parent?.name ?? null,
          relationship: link.relationship,
          phone: phoneFor(parent?.phone ?? null, purpose),
        }
      })
  const parent = input.studentParentId === null ? undefined : parents.get(input.studentParentId)
  if (parent === undefined) return []
  return [
    {
      name: parent.name,
      relationship: relationshipOf(parent.relationship),
      phone: phoneFor(parent.phone, purpose),
    },
  ]
}

/** Yakınlık metni (`Anne`); bilinmiyorsa `null`. */
export const transportRosterRelationshipLabel = (relationship: GuardianRelationship | null) =>
  relationship === null ? null : GUARDIAN_RELATIONSHIPS[relationship].label

// --- Liste ---------------------------------------------------------------------------------------

export interface RosterStop {
  id: string
  position: number
  name: string
  time: string
}

export interface RosterAssignment {
  studentId: string
  stopId: string
}

/** Öğrenci kaydının listeye giren alanları; `null` kurumda yok ya da arşivli. */
export interface RosterStudent {
  // kvkk: K
  name: string
  classId: string | null
  isActive: boolean
}

export interface TransportRosterStudentRow {
  // kvkk: K
  studentName: string
  className: string | null
  contacts: RosterContact[]
}

export interface TransportRosterStopGroup extends RosterStop {
  students: TransportRosterStudentRow[]
}

/**
 * Durak grupları (K-499): duraklar sırasıyla (boş durak da yazılır), durakta öğrenciler ada göre.
 * Kurumda olmayan, arşivli ya da aktif olmayan (ayrılan, mezun) öğrencinin ataması atlanır;
 * güzergâhta olmayan durağa bağlı atama da yazılmaz.
 */
export function transportRosterGroups(input: {
  stops: readonly RosterStop[]
  assignments: readonly RosterAssignment[]
  students: ReadonlyMap<string, RosterStudent>
  classNames: ReadonlyMap<string, string>
  contactsOf: (studentId: string) => RosterContact[]
}): TransportRosterStopGroup[] {
  return [...input.stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => ({
      id: stop.id,
      position: stop.position,
      name: stop.name,
      time: stop.time,
      students: input.assignments
        .filter((assignment) => assignment.stopId === stop.id)
        .flatMap((assignment) => {
          const student = input.students.get(assignment.studentId)
          if (student === undefined || !student.isActive) return []
          return [
            {
              studentId: assignment.studentId,
              row: {
                studentName: student.name,
                className:
                  student.classId === null ? null : (input.classNames.get(student.classId) ?? null),
                contacts: input.contactsOf(assignment.studentId),
              },
            },
          ]
        })
        .sort(
          (a, b) =>
            a.row.studentName.localeCompare(b.row.studentName, 'tr') ||
            a.studentId.localeCompare(b.studentId),
        )
        .map((item) => item.row),
    }))
}

/** Listedeki öğrenci sayısı. */
export const transportRosterCount = (groups: readonly { students: readonly unknown[] }[]) =>
  groups.reduce((sum, group) => sum + group.students.length, 0)
