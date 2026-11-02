import { randomUUID } from 'node:crypto'

import {
  guardianLinksView,
  planGuardianLink,
  planGuardianUnlink,
  planGuardianUpdate,
  type GuardianAccount,
  type GuardianDraft,
  type GuardianLink,
  type LinkGuardianInput,
  type UpdateGuardianLinkInput,
} from '@kampus/school-core/lib/guardianship.ts'

import { roleSchema } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { findInstitutionMembership } from '../db/coordinator-duties.ts'
import { findRecord } from '../db/records.ts'
import {
  archiveGuardianLink,
  insertGuardianLink,
  loadIdentityGuardians,
  loadStudentGuardians,
  updateGuardianLink,
  type StoredGuardianLink,
} from '../db/student-guardians.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Veli–öğrenci bağı (IST-019; docs/domain/iletisim-ve-veli.md DOM-ILT-070…075). Kural core
 * `lib/guardianship.ts`'tedir: tek ödeyici, kısıtlı velinin velayet/ödeme/teslim yasağı, vasinin
 * velayeti ve en az bir velayetli bağ. Bağı yönetici ve ön büro kurar, değiştirir, kaldırır
 * (`guardian.manage`); okumada veli yalnız kendi bağını, kısıt alanı olmadan görür (DOM-ILT-073).
 * Yazmalar `runCommand` ile kurum kilidi altında tek transaction'dır; denetime yalnız alan adları
 * yazılır (velayet ve kısıt değeri loglanmaz).
 *
 * TODO(velayet-kapsam): okuma kapsamı hâlâ üyelik bağlantısından (`membership_links` `child`)
 * gelir; bağ `membership_links`'i güncellemez. Velayetsiz ebeveynin kapsam dışı kalması OG-032'de
 * core `accessibleStudentIds` ile bağlanır. Rıza velayeti bu tablodan okur (`services/consents.ts`).
 */

const ENTITY = 'student_guardian'

/** Yönetici ve ön büro görünümü (yazma yanıtları ve personel listesi). */
function staffView(link: StoredGuardianLink, archivedAt: string | null = null) {
  return {
    id: link.id,
    studentId: link.studentId,
    parentId: link.parentId,
    membershipId: link.membershipId,
    relationship: link.relationship,
    custody: link.custody,
    contactRestricted: link.contactRestricted,
    isPayer: link.isPayer,
    canPickUp: link.canPickUp,
    createdAt: link.createdAt,
    updatedAt: archivedAt ?? link.updatedAt,
    archivedAt,
    rowVersion: archivedAt === null ? link.rowVersion : link.rowVersion + 1,
  }
}

/** Velinin kendi bağı: kısıt alanı ve kayıt bilgileri yok (DOM-ILT-073). */
function parentView(link: Omit<GuardianLink, 'contactRestricted'>) {
  return {
    id: link.id,
    studentId: link.studentId,
    parentId: link.parentId,
    membershipId: link.membershipId,
    relationship: link.relationship,
    custody: link.custody,
    isPayer: link.isPayer,
    canPickUp: link.canPickUp,
  }
}

async function requireStudent(tx: Database, ctx: ServiceContext, studentId: string) {
  if ((await findRecord(tx, ctx.institutionId, 'students', studentId)) === null)
    throw new NotFoundError()
}

/**
 * Öğrencinin etkin bağları (DOM-ILT-073). Yönetici ve ön büro hepsini görür; veli yalnız kendi
 * kısıtsız bağını görür, bağı yoksa ya da iletişim kısıtlıysa 404 (öğrencinin varlığı da
 * açılmaz). Olmayan, arşivli ya da başka kurumun öğrencisi 404.
 */
export async function listStudentGuardians(ctx: ServiceContext, studentId: string) {
  return ctx.db.transaction(async (tx) => {
    await requireStudent(tx, ctx, studentId)
    const links = await loadStudentGuardians(tx, ctx.institutionId, studentId)
    const visible = guardianLinksView(links, ctx.actor)
    if (ctx.actor.role !== 'veli') {
      const byId = new Map(links.map((link) => [link.id, link]))
      return visible.flatMap((link) => {
        const stored = byId.get(link.id)
        return stored === undefined ? [] : [staffView(stored)]
      })
    }
    if (visible.length === 0) throw new NotFoundError()
    return visible.map(parentView)
  })
}

/** Bağlanacak veli hesabı: kurumda yoksa 404; rol core denetler (422). */
async function accountOf(
  tx: Database,
  ctx: ServiceContext,
  membershipId: string | undefined,
): Promise<GuardianAccount | null> {
  if (membershipId === undefined) return null
  const member = await findInstitutionMembership(tx, ctx.institutionId, membershipId)
  if (member === null) throw new NotFoundError()
  const role = roleSchema.safeParse(member.role)
  if (!role.success) throw new NotFoundError()
  return { role: role.data }
}

async function savedLink(tx: Database, ctx: ServiceContext, studentId: string, id: string) {
  const saved = (await loadStudentGuardians(tx, ctx.institutionId, studentId)).find(
    (link) => link.id === id,
  )
  if (saved === undefined) throw new Error('guardian link disappeared after write')
  return saved
}

/**
 * Bağ kurar (DOM-ILT-070…075). Öğrenci, veli kaydı (`parentId`) ya da hesap (`membershipId`)
 * kurumda yoksa 404; kural reddi core'dan (422 `guardian_account_not_parent`,
 * `guardian_restricted_*`, `guardian_legal_custody`, `guardian_custody_required`,
 * `guardian_identity_mismatch`; 409
 * `guardian_link_exists`, `guardian_payer_exists`). Başarı 201.
 */
export function linkStudentGuardian(
  ctx: ServiceContext,
  studentId: string,
  input: LinkGuardianInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const out: { body?: unknown } = {}
  return runCommand<GuardianDraft>(
    ctx,
    {
      action: 'guardian.link',
      collections: [],
      entity: { type: ENTITY, id },
      load: async (tx) => {
        await requireStudent(tx, ctx, studentId)
        if (
          input.parentId !== undefined &&
          (await findRecord(tx, ctx.institutionId, 'parents', input.parentId)) === null
        )
          throw new NotFoundError()
        const { parentId, membershipId } = input
        const [account, links, identityLinks] = await Promise.all([
          accountOf(tx, ctx, membershipId),
          loadStudentGuardians(tx, ctx.institutionId, studentId),
          parentId !== undefined && membershipId !== undefined
            ? loadIdentityGuardians(tx, ctx.institutionId, { parentId, membershipId })
            : Promise.resolve([]),
        ])
        return {
          run: () => planGuardianLink({ studentId, links, identityLinks, account, input }),
        }
      },
      after: async (tx, draft) => {
        await insertGuardianLink(tx, ctx.institutionId, { id, ...draft }, ctx.now)
        await auditWork(tx, ctx, 'guardian.link', { type: ENTITY, id }, Object.keys(draft))
        out.body = { data: staffView(await savedLink(tx, ctx, studentId, id)) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('guardian link was not written')
      return { statusCode: 201, body: out.body }
    },
    idempotency,
  )
}

export interface GuardianTarget {
  studentId: string
  linkId: string
  expectedVersion: number
}

/** Hedef bağ: öğrenci ya da bağ yoksa 404, sürüm tutmazsa 409. */
async function loadTarget(tx: Database, ctx: ServiceContext, target: GuardianTarget) {
  await requireStudent(tx, ctx, target.studentId)
  const links = await loadStudentGuardians(tx, ctx.institutionId, target.studentId)
  const link = links.find((item) => item.id === target.linkId)
  if (link === undefined) throw new NotFoundError()
  if (link.rowVersion !== target.expectedVersion) throw new ConflictError()
  return { links, link }
}

/**
 * Bağı değiştirir (DOM-ILT-071…075): yakınlık, velayet, kısıt, ödeyici, teslim alma. Veli kimliği
 * değişmez (yeni bağ açılır). `If-Match` bağın `rowVersion`'ı; kurallar bağ kurmadaki gibidir.
 */
export function updateStudentGuardian(
  ctx: ServiceContext,
  target: GuardianTarget,
  input: UpdateGuardianLinkInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  type Planned = { link: GuardianLink; fields: string[] }
  const out: { body?: unknown } = {}
  let version = target.expectedVersion
  return runCommand<Planned>(
    ctx,
    {
      action: 'guardian.update',
      collections: [],
      entity: { type: ENTITY, id: target.linkId },
      load: async (tx) => {
        const { links, link } = await loadTarget(tx, ctx, target)
        version = link.rowVersion
        return {
          run: () =>
            planGuardianUpdate({
              studentId: target.studentId,
              linkId: target.linkId,
              links,
              input,
            }),
        }
      },
      after: async (tx, { link, fields }) => {
        if (
          !(await updateGuardianLink(
            tx,
            ctx.institutionId,
            { ...link, rowVersion: version },
            ctx.now,
          ))
        )
          throw new ConflictError()
        await auditWork(tx, ctx, 'guardian.update', { type: ENTITY, id: link.id }, fields)
        out.body = { data: staffView(await savedLink(tx, ctx, target.studentId, link.id)) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('guardian link was not updated')
      return { statusCode: 200, body: out.body }
    },
    idempotency,
  )
}

/**
 * Bağı kaldırır (arşiv; DOM-ILT-071, DOM-ILT-075). Başka bağ dururken son velayetli bağ
 * kaldırılamaz (422 `guardian_custody_required`); son bağ kaldırılabilir. Kaldırılan bağ rıza,
 * velayet ve kapsam vermez; verdiği rızalar kayıtta kalır.
 */
export function unlinkStudentGuardian(
  ctx: ServiceContext,
  target: GuardianTarget,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const out: { body?: unknown } = {}
  let stored: StoredGuardianLink | null = null
  return runCommand<GuardianLink>(
    ctx,
    {
      action: 'guardian.unlink',
      collections: [],
      entity: { type: ENTITY, id: target.linkId },
      load: async (tx) => {
        const { links, link } = await loadTarget(tx, ctx, target)
        stored = link
        return {
          run: () =>
            planGuardianUnlink({ studentId: target.studentId, linkId: target.linkId, links }),
        }
      },
      after: async (tx) => {
        const link = stored
        if (link === null) throw new Error('guardian link was not loaded')
        if (!(await archiveGuardianLink(tx, ctx.institutionId, link, ctx.now)))
          throw new ConflictError()
        await auditWork(tx, ctx, 'guardian.unlink', { type: ENTITY, id: link.id }, ['archivedAt'])
        out.body = { data: staffView(link, ctx.now.toISOString()) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('guardian link was not removed')
      return { statusCode: 200, body: out.body }
    },
    idempotency,
  )
}
