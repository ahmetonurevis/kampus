import { randomUUID } from 'node:crypto'

import { isNotGuardian, type ParentBond } from '@kampus/school-core/lib/enrollment.ts'
import {
  addAdultPayer,
  resolveAdultPayer,
  type AdultPayerInput,
} from '@kampus/school-core/lib/finance-payers.ts'
import type { GuardianDraft } from '@kampus/school-core/lib/guardianship.ts'
import type { NotificationType } from '@kampus/school-core/modules/notification-types.ts'

import type { Database } from '../db/client.ts'
import { loadParentBonds } from '../db/enrollment-bonds.ts'
import { payerStudentIdsOf } from '../db/finance-payers.ts'
import { findRecord } from '../db/records.ts'
import { insertGuardianLink, loadStudentGuardians } from '../db/student-guardians.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { getInstitutionModules } from './modules.ts'
import {
  learnerMinor,
  notify,
  type NotifyContext,
  type NotifyInput,
  type NotifyResult,
} from './notify.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Yetişkin kursiyerin ayrı ödeyicisi (ON-124; docs/domain/kayit-ve-crm.md DOM-KAY-012,
 * iletisim-ve-veli.md DOM-ILT-074; kural core `lib/finance-payers.ts`). Kesin kayıtta gövdenin
 * `payer` alanıyla (`services/prospects.ts`), sonradan bu servisle kurulur: velayetsiz ödeyici bağı
 * (`student_guardians`, `custody: 'none'`, `isPayer: true`). Bağ finans okumasını ve finans
 * bildirimini açar, akademik kapsam ve rıza vermez. Kişi ve iletişimi loglanmaz; denetime yalnız
 * alan adları yazılır.
 */

const ENTITY = 'student_guardian'

/** Ödeyici bağının yanıtı: veli bağı uçlarının yönetici görünümüyle aynı biçim. */
async function payerView(tx: Database, ctx: ServiceContext, studentId: string, id: string) {
  const link = (await loadStudentGuardians(tx, ctx.institutionId, studentId)).find(
    (item) => item.id === id,
  )
  if (link === undefined) throw new Error('payer link disappeared after write')
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
    updatedAt: link.updatedAt,
    archivedAt: null,
    rowVersion: link.rowVersion,
  }
}

/**
 * Kayıtlı yetişkin kursiyere ödeyici ekler (ON-124). Olmayan, arşivli ya da başka kurumun öğrencisi
 * ve olmayan veli kaydı 404; okulda ve 18 yaş altında 422 `payer_not_applicable` (yaş kimlik
 * satırındaki doğum tarihinden, yoksa adayın yaş grubundan: `learnerMinor`); kursiyerin kendi satırı
 * ya da iletişim kısıtlı kişi 422 `payer_not_eligible`; ödeyicisi olan öğrenci 409
 * `guardian_payer_exists`, aynı kişi 409 `guardian_link_exists`. Yeni kişinin veli kaydı ve bağ
 * kurum kilidi altında tek transaction'da yazılır. Başarı 201.
 */
export function addAdultPayerCommand(
  ctx: ServiceContext,
  studentId: string,
  input: AdultPayerInput,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const id = randomUUID()
  const out: { body?: unknown } = {}
  // Yalnız bu öğrencinin kaydı ve sözleşmeleri yüklenir; veliler ve adaylar kural için bütündür.
  const ofStudent = {
    match: [{ kind: 'equals' as const, field: 'studentId', values: [studentId] }],
  }
  return runCommand<{ bond: GuardianDraft; contractIds: string[]; awaiting: string[] }>(
    ctx,
    {
      action: 'student.payer.link',
      collections: ['parents', 'prospects', 'students', 'contracts'],
      loadScope: { students: { ids: [studentId] }, contracts: ofStudent },
      entity: { type: ENTITY, id },
      load: async (tx) => {
        if ((await findRecord(tx, ctx.institutionId, 'students', studentId)) === null)
          throw new NotFoundError()
        const institution = await getInstitutionModules(tx, ctx.institutionId)
        if (institution === null) throw new NotFoundError()
        const minor = await learnerMinor(tx, ctx, institution.type, studentId)
        const links = await loadStudentGuardians(tx, ctx.institutionId, studentId)
        const parentBonds =
          'existingParentId' in input
            ? await loadParentBonds(tx, ctx.institutionId, [input.existingParentId])
            : []
        return {
          run: (state, { makeId }) => {
            const payer = resolveAdultPayer(state.parents, input, {
              minor,
              parentBonds,
              isSelfRecord: (parent) => isNotGuardian(parent, state.prospects),
            })
            const added = addAdultPayer(state, payer, { studentId, minor, links, makeId })
            // İmza yetkilisi işlenmiş, onay bekleyen sözleşmenin onay isteği ödeyiciye gider.
            const awaiting = added.contractIds.filter(
              (contractId) =>
                state.contracts.find((contract) => contract.id === contractId)?.signatory !==
                undefined,
            )
            return { ...added, awaiting }
          },
        }
      },
      after: async (tx, { bond, awaiting }) => {
        await insertGuardianLink(tx, ctx.institutionId, { id, ...bond }, ctx.now)
        await auditWork(tx, ctx, 'guardian.link', { type: ENTITY, id }, Object.keys(bond))
        for (const contractId of awaiting)
          await notify(tx, ctx, {
            type: 'contract_approval_requested',
            recipients: { studentIds: [studentId], minor: new Map([[studentId, true]]) },
            audiences: ['parent'],
            data: { contractId },
            dedupeKey: contractId,
          })
        out.body = { data: await payerView(tx, ctx, studentId, id) }
      },
    },
    () => {
      if (out.body === undefined) throw new Error('payer link was not written')
      return { statusCode: 201, body: out.body }
    },
    idempotency,
  )
}

/**
 * Finans bildirimi (taksit vadesi, tahsilat, iade; ON-124, DOM-ILT-074 "finans bildirimleri
 * ödeyiciye gider"). Bildirim türün yaşa göre kitlesine yazılır (`notify`): 18 yaş altında veli,
 * yetişkin kursiyerde kursiyer. Yetişkin kursiyerin ayrı ödeyicisi varsa aynı bildirim veli
 * kitlesine de yazılır; ödeyici onu ödeyici bağlantısıyla görür (`canSeeNotification`,
 * `PAYER_NOTIFICATION_KINDS`), velayetli veli kitlesi yetişkinde boştur. Sözleşme bildirimleri bu
 * yoldan gitmez: kitlesi sözleşmenin tarafıdır (`contractPayerIsGuardian`).
 */
export async function notifyFinance<T extends NotificationType>(
  tx: Database,
  ctx: NotifyContext,
  input: NotifyInput<T>,
): Promise<NotifyResult> {
  const result = await notify(tx, ctx, input)
  if (result.skipped !== null) return result
  if (input.audiences !== undefined && !input.audiences.includes('parent')) return result
  const payers = await payerStudentIdsOf(tx, ctx.institutionId, input.recipients.studentIds)
  if (payers.size === 0) return result
  const institution = await getInstitutionModules(tx, ctx.institutionId)
  if (institution === null) return result
  const adults: string[] = []
  for (const studentId of [...payers].sort())
    if (!(await learnerMinor(tx, ctx, institution.type, studentId))) adults.push(studentId)
  if (adults.length === 0) return result
  const extra = await notify(tx, ctx, {
    ...input,
    recipients: { studentIds: adults, minor: new Map(adults.map((id) => [id, true])) },
    audiences: ['parent'],
  })
  return {
    ...result,
    created: [...result.created, ...extra.created],
    deduplicated: result.deduplicated + extra.deduplicated,
  }
}

/**
 * Veli kaydının bağlarına, yalnız ödeyici bağlarda, bağın öğrencisinin yaşını ekler (ON-124;
 * core `isAdultPayerOnlyBond`, kullanıcı kararı 2026-11-04): yetişkin kursiyerin yalnız ödeyici
 * bağı velayetsizliği nedeniyle kişiyi küçük kardeşin veliliğinden çıkarmaz. Yaş kimlik satırındaki
 * doğum tarihinden, yoksa adayın yaş grubundandır (`learnerMinor`); okulda her öğrenci 18 yaş
 * altıdır. Diğer bağlar olduğu gibi döner.
 */
export async function withLearnerAge<B extends ParentBond & { studentId: string }>(
  db: Database,
  ctx: NotifyContext,
  bonds: readonly B[],
): Promise<B[]> {
  const payerOnly = (bond: B) =>
    bond.isPayer === true && bond.custody === 'none' && !bond.contactRestricted
  if (!bonds.some(payerOnly)) return [...bonds]
  const institution = await getInstitutionModules(db, ctx.institutionId)
  if (institution === null) return [...bonds]
  const out: B[] = []
  for (const bond of bonds)
    out.push(
      payerOnly(bond)
        ? { ...bond, learnerMinor: await learnerMinor(db, ctx, institution.type, bond.studentId) }
        : bond,
    )
  return out
}
