import { randomUUID } from 'node:crypto'

import { createSeed } from '../../../packages/school-core/src/data/seed.ts'

import { createAuth, type InstitutionType, type Role } from '../../../apps/api/src/auth.ts'
import { loadConfig } from '../../../apps/api/src/config.ts'
import { connectPostgres } from '../../../apps/api/src/db/client.ts'
import {
  recordKey,
  type CollectionName,
  type RecordData,
} from '../../../apps/api/src/db/collections.ts'
import { insertMissingRecords } from '../../../apps/api/src/db/records.ts'
import {
  ensureInstitution,
  ensureInstitutionSettings,
  ensureMember,
  ensureMembershipLinks,
  ensureUser,
  type MembershipLinkInput,
} from '../../../apps/api/src/services/identity.ts'
import { accounts, e2e, type RoleKey } from './env.ts'

/**
 * Teste özel kurum (temiz durum stratejisi, test-stratejisi.md §6): seed kurumlarına yazan testler
 * kendi kurumunu kurar. Kurum, kullanıcılar ve kayıtlar `kampus_e2e` veritabanına doğrudan, API'nin
 * `services/identity.ts` ve `db/records.ts` işlevleriyle yazılır (UI'dan kurulum yok); çalışan API
 * aynı veritabanını okuduğu için testin girişi ve istekleri bu kurumu görür. Kayıt kimlikleri
 * (`s10`, `c3`, `t1`, `inv-s10-5` …) Akademi seed'iyle aynıdır, kurumlar ayrı olduğu için çakışmaz.
 */

/** Her kurumda bulunan, öğrenciden bağımsız temel koleksiyonlar. */
const BASE_COLLECTIONS = [
  'subjects',
  'branches',
  'teachers',
  'classes',
  'assignments',
  'students',
  'parents',
] as const satisfies readonly CollectionName[]

/** Öğrenciye bağlı (`studentId`) koleksiyonlardan varsayılan olarak taşınanlar. */
const DEFAULT_STUDENT_COLLECTIONS = [
  'attendance',
  'grades',
  'invoices',
  'contracts',
] as const satisfies readonly CollectionName[]

/** Rolün seed'deki kayıt bağlantıları (demo-seed.ts `DEMO_MEMBERS` ile aynı kimlikler). */
const ROLE_LINKS: Record<RoleKey, readonly MembershipLinkInput[]> = {
  yonetici: [],
  onburo: [],
  ogretmen: [{ kind: 'teacher', recordId: 't1' }],
  ogrenci: [{ kind: 'student', recordId: 's1' }],
  veli: [
    { kind: 'child', recordId: 's1' },
    { kind: 'child', recordId: 's2' },
  ],
}

export interface TenantOptions {
  /** Kurum türü; verilmezse `school`. Dil okulu için `language_school`. */
  type?: InstitutionType
  /** Yöneticiden başka hesabı açılacak roller; yönetici her kurumda vardır (kurumu o açar). */
  roles: readonly RoleKey[]
  /** Kuruma konacak öğrenci kimlikleri (ve kendi attendance/grades/invoices/contracts kayıtları). */
  students?: readonly string[]
  /** Bu sınıfların bütün öğrencileri de konur. */
  classes?: readonly string[]
  /** Varsayılanlara ek taşınacak koleksiyonlar (öğrenciye bağlıysa süzülür, değilse bütün gelir). */
  collections?: readonly CollectionName[]
  /**
   * Seed'de olmayan, testin kendi kayıtları (ör. optik analiz, geçmiş etüt); API'de bunları
   * yazan uç yoksa doğrudan veritabanına konur. Kimlik `recordKey` kuralıyla (`id`) belirlenir.
   */
  records?: readonly { collection: CollectionName; data: RecordData }[]
}

export interface TenantUser {
  email: string
  name: string
}

export interface Tenant {
  institutionId: string
  /** Rol → o kurumun hesabı; `loginAs(tenant.user('ogretmen'))` kendi oturumunu açar. */
  user: (role: RoleKey) => TenantUser
}

export interface TenantFactory {
  create: (options: TenantOptions) => Promise<Tenant>
  close: () => Promise<void>
}

const ACCOUNT_ROLES: Record<RoleKey, Role> = {
  yonetici: 'yonetici',
  onburo: 'onburo',
  ogretmen: 'ogretmen',
  ogrenci: 'ogrenci',
  veli: 'veli',
}

/** Seed'in `now`'ı: `db:seed` de `new Date()` kullanır; tarih bağımlı kayıtlar aynı günü görür. */
function tenantRecords(options: TenantOptions, now: Date) {
  const state = createSeed(now)
  const items = (collection: CollectionName): readonly RecordData[] => state[collection]

  const kept = new Set(options.students ?? [])
  for (const role of options.roles)
    for (const link of ROLE_LINKS[role]) if (link.kind !== 'teacher') kept.add(link.recordId)
  const classes = new Set(options.classes ?? [])
  for (const student of state.students) if (classes.has(student.classId)) kept.add(student.id)

  const keepStudents = (item: RecordData) => {
    const record = item as Record<string, unknown>
    if (typeof record.studentId === 'string') return kept.has(record.studentId)
    if (Array.isArray(record.studentIds))
      return record.studentIds.some((id) => typeof id === 'string' && kept.has(id))
    return true
  }
  const keepStudent = (item: RecordData) => kept.has((item as { id: string }).id)

  const wanted = new Set<CollectionName>([
    ...BASE_COLLECTIONS,
    ...DEFAULT_STUDENT_COLLECTIONS,
    ...(options.collections ?? []),
  ])
  const fromSeed = [...wanted].flatMap((collection) =>
    items(collection)
      .filter(collection === 'students' ? keepStudent : keepStudents)
      .map((data) => {
        const id = recordKey(collection, data)
        if (id === null) throw new Error(`Anahtarsız seed kaydı: ${collection}`)
        return { collection, id, data }
      }),
  )
  const extra = (options.records ?? []).map(({ collection, data }) => {
    const id = recordKey(collection, data)
    if (id === null) throw new Error(`Anahtarsız test kaydı: ${collection}`)
    return { collection, id, data }
  })
  return [...fromSeed, ...extra]
}

/**
 * Worker başına bir kez kurulur (bağlantı havuzu ve Better Auth örneği paylaşılır). Çalışan API'nin
 * gizli anahtarı gerekmez: yalnız kullanıcı ve parola özeti yazılır, oturum açmayı API yapar.
 */
export function createTenantFactory(): TenantFactory {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: e2e.databaseUrl,
    BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
    BETTER_AUTH_URL: e2e.webOrigin,
    CORS_ORIGINS: e2e.webOrigin,
  })
  const { db, close } = connectPostgres(config.DATABASE_URL)
  const auth = createAuth(config, db)

  async function create(options: TenantOptions): Promise<Tenant> {
    const now = new Date()
    const suffix = randomUUID().slice(0, 8)
    const slug = `e2e-${suffix}`
    const users: Partial<Record<RoleKey, TenantUser>> = {}
    const provision = async (role: RoleKey) => {
      const account = accounts[role]
      const email = `e2e-${suffix}.${role}@kampus.example`
      const { id } = await ensureUser(auth, { name: account.name, email, password: e2e.password })
      users[role] = { email, name: account.name }
      return id
    }

    // Kurumu yönetici açar (Better Auth onu `yonetici` üyesi yapar); her kurumda bir yönetici vardır.
    const creator = await provision('yonetici')
    const { id: institutionId } = await ensureInstitution(auth, db, {
      name: `E2E Kurumu ${suffix}`,
      slug,
      type: options.type ?? 'school',
      creatorUserId: creator,
    })
    await ensureInstitutionSettings(db, institutionId, {
      academicYear: createSeed(now).academicYear,
    })

    for (const role of options.roles.filter((item) => item !== 'yonetici')) {
      const userId = await provision(role)
      const { id } = await ensureMember(auth, db, {
        institutionId,
        userId,
        role: ACCOUNT_ROLES[role],
      })
      await ensureMembershipLinks(db, institutionId, id, ROLE_LINKS[role])
    }

    await insertMissingRecords(db, institutionId, tenantRecords(options, now), now)
    return {
      institutionId,
      user: (role) => {
        const user = users[role]
        if (!user) throw new Error(`Kurumda ${role} hesabı yok (TenantOptions.roles).`)
        return user
      },
    }
  }

  return { create, close }
}
