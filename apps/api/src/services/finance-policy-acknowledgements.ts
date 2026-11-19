import { randomUUID } from 'node:crypto'

import {
  acknowledgementRate,
  assertPolicyAcknowledgement,
  audienceIncludesRole,
  FINANCE_POLICY_ROLES,
  planPolicyVersion,
  policyAcknowledgementInputSchema,
  policyDocumentInputSchema,
  type PolicyType,
} from '@kampus/school-core/lib/finance-policy-acknowledgements.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from '../db/client.ts'
import { findStaffMember } from '../db/finance-pay-rates.ts'
import {
  findPolicyAcknowledgement,
  findPolicyDocument,
  insertPolicyAcknowledgement,
  insertPolicyDocument,
  listPolicyAudienceStaff,
  listPolicyDocuments,
  loadAcknowledgementsOf,
  loadActiveStaff,
  loadCurrentPolicyDocuments,
  loadPolicySeries,
  policyAcknowledgementExists,
  policyDocumentExists,
  supersedePolicyDocument,
  type PolicyStaff,
  type StoredPolicyDocument,
} from '../db/finance-policy-acknowledgements.ts'
import { ConflictError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { defineFileAttachment } from './file-registry.ts'
import { attachFile } from './files.ts'
import { getInstitutionModules } from './modules.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Politika belgesi okundu onayı (DOM-FIN-127; ON-190). Kural core
 * `lib/finance-policy-acknowledgements.ts`'tedir; servis kurum kilidi altında belgeyi, personeli ve
 * mevcut onayı yükler, aynı transaction'da yazar. Belge PDF'i ve ıslak imza taraması platform dosya
 * altyapısındadır (amaç `document`; bağ türleri `policy_document`, `policy_acknowledgement`);
 * bağlantı `GET /files/:id/url` ile finans rolleri için üretilir. Denetim kaydına alan adları
 * yazılır. Rol ve modül denetimi rotadadır.
 */

const DOCUMENT_ENTITY = 'policy_documents'
const ACK_ENTITY = 'policy_acknowledgements'

async function financeReader(tx: Database, ctx: ServiceContext) {
  if (!(FINANCE_POLICY_ROLES as readonly string[]).includes(ctx.actor.role)) return false
  const institution = await getInstitutionModules(tx, ctx.institutionId)
  return institution?.modules.finance === true
}

defineFileAttachment('policy_document', {
  purposes: ['document'],
  canRead: async (tx, ctx, documentId) =>
    (await financeReader(tx, ctx)) && policyDocumentExists(tx, ctx.institutionId, documentId),
})
defineFileAttachment('policy_acknowledgement', {
  purposes: ['document'],
  canRead: async (tx, ctx, acknowledgementId) =>
    (await financeReader(tx, ctx)) &&
    policyAcknowledgementExists(tx, ctx.institutionId, acknowledgementId),
})

// --- Görünüm -------------------------------------------------------------------------------------

/** Onay oranı (K-438): hedef kitledeki etkin personel ve geçerli sürümü onaylayanlar. */
function statsOf(
  doc: StoredPolicyDocument,
  staff: readonly PolicyStaff[],
  acknowledgedBy: ReadonlySet<string>,
) {
  const target = staff.filter((member) => audienceIncludesRole(doc.audience, member.role))
  const acknowledged = target.filter((member) => acknowledgedBy.has(member.membershipId)).length
  return {
    targetCount: target.length,
    acknowledgedCount: acknowledged,
    pendingCount: target.length - acknowledged,
    rate: acknowledgementRate(acknowledged, target.length),
  }
}

async function documentViews(
  db: Database,
  institutionId: string,
  docs: readonly StoredPolicyDocument[],
) {
  const staff = await loadActiveStaff(db, institutionId)
  const acks = await loadAcknowledgementsOf(db, institutionId, {
    documentIds: docs.map((doc) => doc.id),
  })
  const byDoc = new Map<string, Set<string>>()
  for (const ack of acks) {
    const set = byDoc.get(ack.policyDocumentId) ?? new Set<string>()
    set.add(ack.membershipId)
    byDoc.set(ack.policyDocumentId, set)
  }
  return docs.map((doc) => ({
    ...doc,
    current: doc.supersededAt === null,
    ...statsOf(doc, staff, byDoc.get(doc.id) ?? new Set()),
  }))
}

// --- Okuma ---------------------------------------------------------------------------------------

export async function listPolicyDocumentsFor(
  ctx: ServiceContext,
  query: {
    page: number
    pageSize: number
    q?: string | undefined
    policyType?: PolicyType | undefined
    status: 'current' | 'all'
  },
) {
  const { items, total } = await listPolicyDocuments(ctx.db, ctx.institutionId, query)
  return { items: await documentViews(ctx.db, ctx.institutionId, items), total }
}

/** Sürümün ayrıntısı ve aynı belgenin bütün sürümleri (en yeni önce) onay sayılarıyla. */
export async function getPolicyDocumentFor(ctx: ServiceContext, documentId: string) {
  const doc = await findPolicyDocument(ctx.db, ctx.institutionId, documentId)
  if (doc === null) throw new NotFoundError()
  const series = await loadPolicySeries(ctx.db, ctx.institutionId, doc.seriesId)
  const views = await documentViews(ctx.db, ctx.institutionId, series)
  const view = views.find((item) => item.id === doc.id)
  if (view === undefined) throw new NotFoundError()
  return { ...view, versions: views }
}

/** Sürümün hedef kitlesindeki etkin personel: onaylamayanlar ya da onaylayanlar (sayfalı). */
export async function listPolicyDocumentStaffFor(
  ctx: ServiceContext,
  documentId: string,
  query: {
    status: 'pending' | 'acknowledged'
    q?: string | undefined
    page: number
    pageSize: number
  },
) {
  const doc = await findPolicyDocument(ctx.db, ctx.institutionId, documentId)
  if (doc === null) throw new NotFoundError()
  const { items, total } = await listPolicyAudienceStaff(ctx.db, ctx.institutionId, {
    ...query,
    documentId: doc.id,
    audience: doc.audience,
  })
  return {
    items: items.map((item) => ({
      membershipId: item.membershipId,
      name: item.name,
      role: item.role,
      acknowledgement:
        item.acknowledgementId === null || item.acknowledgedOn === null || item.channel === null
          ? null
          : {
              id: item.acknowledgementId,
              acknowledgedOn: item.acknowledgedOn,
              channel: item.channel,
              scanFileId: item.scanFileId,
            },
    })),
    total,
  }
}

/**
 * Personel başına eksik onaylar: etkin personel ve hedef kitlesinde olduğu geçerli sürümlerden
 * onaylamadıkları. `missing=true` yalnız eksiği olanları verir. Sayfalama bellekte yapılır
 * (kurum personeli yüzlerle sınırlıdır; eksik süzgeci SQL'de ifade edilmez).
 */
export async function listPolicyStaffFor(
  ctx: ServiceContext,
  query: { page: number; pageSize: number; q?: string | undefined; missing: boolean },
) {
  const [staff, current] = await Promise.all([
    loadActiveStaff(ctx.db, ctx.institutionId),
    loadCurrentPolicyDocuments(ctx.db, ctx.institutionId),
  ])
  const acks = await loadAcknowledgementsOf(ctx.db, ctx.institutionId, {
    documentIds: current.map((doc) => doc.id),
  })
  const acked = new Set(acks.map((ack) => `${ack.policyDocumentId}:${ack.membershipId}`))
  const needle = query.q?.trim().toLocaleLowerCase('tr-TR')
  const rows = staff
    .filter(
      (member) =>
        needle === undefined ||
        needle === '' ||
        member.name.toLocaleLowerCase('tr-TR').includes(needle),
    )
    .map((member) => {
      const required = current.filter((doc) => audienceIncludesRole(doc.audience, member.role))
      const missing = required.filter((doc) => !acked.has(`${doc.id}:${member.membershipId}`))
      return {
        ...member,
        requiredCount: required.length,
        acknowledgedCount: required.length - missing.length,
        missingDocuments: missing.map((doc) => ({
          id: doc.id,
          title: doc.title,
          policyType: doc.policyType,
          version: doc.version,
          publishedOn: doc.publishedOn,
        })),
      }
    })
    .filter((row) => !query.missing || row.missingDocuments.length > 0)
  const start = (query.page - 1) * query.pageSize
  return { items: rows.slice(start, start + query.pageSize), total: rows.length }
}

// --- Yazma ---------------------------------------------------------------------------------------

/** Belge ya da yeni sürüm yayımlar (K-436): önceki sürüm aynı transaction'da geçmiş olur. 201. */
export function createPolicyDocumentCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: DOCUMENT_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.policy_document.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = policyDocumentInputSchema.parse(input)
        const previous =
          parsed.replacesDocumentId === null
            ? null
            : await findPolicyDocument(tx, ctx.institutionId, parsed.replacesDocumentId)
        return {
          run: () => ({
            parsed,
            plan: planPolicyVersion(parsed, { previous, today: dayKey(ctx.now) }),
          }),
        }
      },
      after: async (tx, { parsed, plan }) => {
        if (plan.supersedes !== null) {
          const done = await supersedePolicyDocument(tx, ctx.institutionId, {
            id: plan.supersedes,
            now: ctx.now,
          })
          if (!done) throw new ConflictError()
        }
        await attachFile(tx, ctx, {
          fileId: parsed.fileId,
          attachedType: 'policy_document',
          attachedId: id,
          dataSubjectId: null,
        })
        await insertPolicyDocument(tx, ctx.institutionId, {
          id,
          seriesId: plan.seriesId ?? id,
          version: plan.version,
          title: parsed.title,
          policyType: parsed.policyType,
          audience: parsed.audience,
          publishedOn: parsed.publishedOn,
          fileId: parsed.fileId,
          replacesId: plan.supersedes,
          createdByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        if (plan.supersedes !== null)
          await auditWork(
            tx,
            ctx,
            'finance.policy_document.supersede',
            { type: DOCUMENT_ENTITY, id: plan.supersedes },
            ['supersededAt'],
          )
        await auditWork(
          tx,
          ctx,
          'finance.policy_document.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        const created = await findPolicyDocument(tx, ctx.institutionId, id)
        if (created === null) throw new NotFoundError()
        const [view] = await documentViews(tx, ctx.institutionId, [created])
        body = { data: view }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Personel adına okundu onayı (K-437); aynı sürüme ikinci onay 409. 201. */
export function createPolicyAcknowledgementCommand(
  ctx: ServiceContext,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const entity = { type: ACK_ENTITY, id }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.policy_acknowledgement.create',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = policyAcknowledgementInputSchema.parse(input)
        const [document, staff, existing] = await Promise.all([
          findPolicyDocument(tx, ctx.institutionId, parsed.policyDocumentId),
          findStaffMember(tx, ctx.institutionId, parsed.membershipId),
          findPolicyAcknowledgement(tx, ctx.institutionId, parsed),
        ])
        return {
          run: () => {
            assertPolicyAcknowledgement(parsed, {
              document,
              staff,
              alreadyAcknowledged: existing !== null,
              today: dayKey(ctx.now),
            })
            return parsed
          },
        }
      },
      after: async (tx, parsed) => {
        if (parsed.scanFileId !== null)
          await attachFile(tx, ctx, {
            fileId: parsed.scanFileId,
            attachedType: 'policy_acknowledgement',
            attachedId: id,
            dataSubjectId: null,
          })
        await insertPolicyAcknowledgement(tx, ctx.institutionId, {
          id,
          policyDocumentId: parsed.policyDocumentId,
          membershipId: parsed.membershipId,
          acknowledgedOn: parsed.acknowledgedOn,
          channel: parsed.channel,
          scanFileId: parsed.scanFileId,
          recordedByUserId: ctx.actor.userId,
          now: ctx.now,
        })
        await auditWork(
          tx,
          ctx,
          'finance.policy_acknowledgement.create',
          entity,
          Object.keys(parsed).filter((key) => parsed[key as keyof typeof parsed] !== null),
        )
        const created = await findPolicyAcknowledgement(tx, ctx.institutionId, parsed)
        if (created === null) throw new NotFoundError()
        body = { data: created }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}
