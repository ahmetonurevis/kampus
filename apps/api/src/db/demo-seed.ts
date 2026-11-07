import { createSeed, type State } from '@kampus/school-core/data/seed.ts'
import { createAcademicYears } from '@kampus/school-core/platform/seed-academic.ts'
import {
  createGuardianLinks,
  type GuardianSeedAccount,
} from '@kampus/school-core/platform/seed-guardians.ts'
import { createCourses } from '@kampus/school-core/platform/seed-courses.ts'
import { samplePlatformOutcomes } from '@kampus/school-core/content/outcomes.ts'

import type { Auth, InstitutionType, Role } from '../auth.ts'
import { AppError, MESSAGES } from '../errors.ts'
import {
  ensureInstitution,
  ensureInstitutionSettings,
  ensureMember,
  ensureMembershipLinks,
  ensureUser,
  type MembershipLinkInput,
} from '../services/identity.ts'
import { ensureAcademicYears } from './academic-years.ts'
import type { Database } from './client.ts'
import { ensureCourses } from './courses.ts'
import { syncPlatformOutcomes } from './learning-outcomes.ts'
import { recordKey, STORED_COLLECTIONS, type RecordData } from './collections.ts'
import { insertMissingRecords } from './records.ts'
import { ensureGuardianLinks } from './student-guardians.ts'

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
  memberships: {
    institution: string
    role: Role
    links?: MembershipLinkInput[]
    /** Örnek veli bağlarındaki hesap (`platform/seed-guardians.ts`; IST-019). */
    guardian?: GuardianSeedAccount
  }[]
}

export const DEMO_INSTITUTIONS = [
  { slug: 'akademi', name: 'Akademi Özel Okulları', type: 'school' },
  { slug: 'kampus-dil', name: 'Kampüs Dil Akademisi', type: 'language_school' },
] as const satisfies readonly DemoInstitution[]

/**
 * Kurucu yönetici her iki kurumun da sahibidir. Akademi kişileri ve kayıt kimlikleri
 * school-core örnek verisiyle aynıdır (`data/seed.ts`: öğretmen `t1` Selin Kaya, öğrenci `s1`
 * Deniz, `s2` Ece, veli `p1` Ayşe Yılmaz). Dil akademisi şimdilik aynı örnek veriyi kullanır;
 * bağlı dört kişinin adı o kurumun demo hesaplarına göre değiştirilir (`LANGUAGE_SCHOOL_NAMES`).
 * Kimlikler veri olduğu için burada sabittir. Gerçek kişi verisi yoktur.
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
        guardian: 'parent',
        links: [
          { kind: 'child', recordId: 's1' },
          { kind: 'child', recordId: 's2' },
        ],
      },
    ],
  },
  {
    // Deniz'in velayeti olmayan ve iletişim kısıtlı babası (DOM-ILT-070, -074): çocuk bağlantısı
    // yoktur, öğrencinin verisini görmez, rıza veremez.
    name: 'Kemal Yılmaz',
    email: 'kemal.yilmaz@kampus.example',
    memberships: [{ institution: 'akademi', role: 'veli', guardian: 'restrictedParent' }],
  },
  {
    name: 'Gizem Tunç',
    email: 'gizem.tunc@kampus.example',
    memberships: [{ institution: 'kampus-dil', role: 'onburo' }],
  },
  {
    name: 'Ozan Er',
    email: 'ozan.er@kampus.example',
    memberships: [
      { institution: 'kampus-dil', role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] },
    ],
  },
  {
    name: 'Lale Sezer',
    email: 'lale.sezer@kampus.example',
    memberships: [
      { institution: 'kampus-dil', role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] },
    ],
  },
  {
    name: 'Hakan Sezer',
    email: 'hakan.sezer@kampus.example',
    memberships: [
      {
        institution: 'kampus-dil',
        role: 'veli',
        guardian: 'parent',
        links: [
          { kind: 'child', recordId: 's1' },
          { kind: 'child', recordId: 's2' },
        ],
      },
    ],
  },
]

/** Örnek veli bağı yakınlığı: Akademi'de Ayşe anne, dil akademisinde Hakan baba. */
const GUARDIAN_RELATIONSHIP = { akademi: 'mother', 'kampus-dil': 'father' } as const

/**
 * TODO(F-dil-okulu): dil okuluna özgü örnek veri (CEFR düzeyleri, beceriler) gelince bu
 * yeniden adlandırma ve okul verisinin kopyası kalkar.
 */
const LANGUAGE_SCHOOL_NAMES = {
  teachers: { t1: 'Ozan Er' },
  students: { s1: 'Lale Sezer', s2: 'Can Sezer' },
  parents: { p1: 'Hakan Sezer' },
} as const

type DemoSlug = (typeof DEMO_INSTITUTIONS)[number]['slug']

function rename(items: { id: string; name: string }[], names: Readonly<Record<string, string>>) {
  for (const item of items) item.name = names[item.id] ?? item.name
}

/** Kurumun örnek State'i; `now` örnek tarihlerin başlangıç günüdür. */
export function demoState(slug: DemoSlug, now: Date): State {
  const state = createSeed(now)
  if (slug === 'kampus-dil') {
    rename(state.teachers, LANGUAGE_SCHOOL_NAMES.teachers)
    rename(state.students, LANGUAGE_SCHOOL_NAMES.students)
    rename(state.parents, LANGUAGE_SCHOOL_NAMES.parents)
  }
  return state
}

/** State'in saklanan koleksiyonlarını `records` satırlarına çevirir (core `audit` hariç). */
export function stateRecords(state: State) {
  return STORED_COLLECTIONS.flatMap((collection) => {
    const items: readonly RecordData[] = state[collection]
    return items.map((data) => {
      const id = recordKey(collection, data)
      if (id === null)
        throw new AppError(500, 'internal_error', MESSAGES.internal_error, {
          cause: new Error(`seed item without key in ${collection}`),
        })
      return { collection, id, data }
    })
  })
}

/** Üyeliğin örnek veli bağları (`platform/seed-guardians.ts`), üyelik kimliğiyle. */
function guardianSeedsFor(membership: DemoMember['memberships'][number], membershipId: string) {
  const slug = membership.institution as DemoSlug
  return createGuardianLinks({ parentRelationship: GUARDIAN_RELATIONSHIP[slug] })
    .filter((seed) => seed.account === membership.guardian)
    .map((seed) => ({
      id: seed.id,
      studentId: seed.studentId,
      parentId: seed.parentId,
      membershipId,
      relationship: seed.relationship,
      custody: seed.custody,
      contactRestricted: seed.contactRestricted,
      isPayer: seed.isPayer,
      canPickUp: seed.canPickUp,
    }))
}

export interface SeedOptions {
  /** Örnek verinin başlangıç günü; betik o anı, testler sabit tarihi verir. */
  now: Date
}

/**
 * İdempotent: var olan kullanıcı, kurum, üyelik, bağlantı ve kayıt yeniden açılmaz, parola
 * değişmez; sonradan değiştirilmiş kayıt ezilmez.
 */
export async function seedDemo(auth: Auth, db: Database, password: string, options: SeedOptions) {
  // Örnek platform kazanım kataloğu (DOM-KYN-011): kurumdan bağımsızdır, bakım betiğinin işidir
  // (ADR 0004 karar 9); resmî program içe aktarımı gelene kadar (OG-132) örnek kodlar yazılır.
  const platformOutcomes = await syncPlatformOutcomes(db, samplePlatformOutcomes(), options.now)
  const founder = await ensureUser(auth, { ...FOUNDER, password })
  const institutionIds = new Map<string, string>()
  for (const institution of DEMO_INSTITUTIONS) {
    const { id } = await ensureInstitution(auth, db, { ...institution, creatorUserId: founder.id })
    institutionIds.set(institution.slug, id)
  }
  // Örnek veri velisi `p1`; veli yazışması kalıcı kullanıcı kimliğiyle eşleşir (DOM-ILT-010).
  const sampleParentUsers = new Map<string, string>()
  for (const member of DEMO_MEMBERS) {
    const user = await ensureUser(auth, { name: member.name, email: member.email, password })
    for (const membership of member.memberships) {
      const institutionId = institutionIds.get(membership.institution)
      if (!institutionId) continue
      if (membership.guardian === 'parent') sampleParentUsers.set(membership.institution, user.id)
      const { id } = await ensureMember(auth, db, {
        institutionId,
        userId: user.id,
        role: membership.role,
      })
      // Örnek bağlar bağlantıdan önce: çocuk bağlantısının varsayılan (velayetli) bağı onların
      // yerini almaz.
      if (membership.guardian !== undefined)
        await ensureGuardianLinks(db, institutionId, guardianSeedsFor(membership, id))
      await ensureMembershipLinks(db, institutionId, id, membership.links ?? [])
    }
  }
  const insertedRecords: Record<string, number> = {}
  for (const institution of DEMO_INSTITUTIONS) {
    const institutionId = institutionIds.get(institution.slug)
    if (!institutionId) continue
    const state = demoState(institution.slug, options.now)
    const parentUserId = sampleParentUsers.get(institution.slug)
    // Mesajlar yazışmanın taraf anahtarlarını kopyalar (ADR 0005); veli kimliği ikisinde aynı.
    for (const record of [...state.conversations, ...state.conversationMessages])
      if (record.parentUserId !== undefined)
        if (parentUserId === undefined) delete record.parentUserId
        else record.parentUserId = parentUserId
    // Etkin örnek yıl kurum ayarındaki yılla aynıdır: okulda iki dönem, dil okulunda dönemsiz.
    // Ayardan önce yazılır: kurum açılışının varsayılan dönemsiz yılı örnek yılın yerini almaz.
    await ensureAcademicYears(
      db,
      institutionId,
      createAcademicYears(state.academicYear, institution.type),
      options.now,
    )
    // Dil okulunun örnek kur programı (IST-076); e-Özel izini kurucu yönetici işaretlemiş sayılır.
    if (institution.type === 'language_school')
      await ensureCourses(
        db,
        institutionId,
        createCourses(state.academicYear, founder.id),
        options.now,
      )
    await ensureInstitutionSettings(db, institutionId, {
      academicYear: state.academicYear,
      now: options.now,
    })
    const rows = stateRecords(state)
    insertedRecords[institution.slug] = await insertMissingRecords(
      db,
      institutionId,
      rows,
      options.now,
    )
  }
  return { institutionIds: Object.fromEntries(institutionIds), insertedRecords, platformOutcomes }
}
