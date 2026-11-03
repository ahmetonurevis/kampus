import { and, eq, inArray, isNull } from 'drizzle-orm'

import { subjects } from '@kampus/school-core/data/curriculum.ts'
import {
  parseStaffImport,
  planStaffImport,
  STAFF_IMPORT_MESSAGES,
  type StaffImportContext,
  type StaffImportInput,
  type StaffImportIssue,
  type StaffImportRow,
  type StaffImportTeacher,
} from '@kampus/school-core/lib/staff-import.ts'

import type { Auth } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { loadRecords, type StoredRecord } from '../db/records.ts'
import { invitations, memberships, users } from '../db/schema/auth.ts'
import { membershipLinks } from '../db/schema/membership-links.ts'
import { AppError, type Issue } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { authTransaction } from './auth-transaction.ts'
import {
  mapOperationError,
  runCommand,
  type CommandResponse,
  type IdempotencyRequest,
} from './operation-runner.ts'
import {
  loadActorAdmin,
  pendingTeacherInvitations,
  writeStaffInvitation,
} from './staff-accounts.ts'
import type { StaffLinkJobData, StaffLinkScheduler } from './staff-password-links.ts'

/**
 * Toplu personel aktarımı (IST-007, DOM-YTK-070). CSV core `lib/staff-import.ts` ile ayrıştırılır
 * ve satır satır doğrulanır; kurum durumu (üyeler, bekleyen davetler, öğretmen kayıtları,
 * kampüsler) kurum kilidi altında okunur. Herhangi bir satır hatalıysa hiçbir şey yazılmaz (422
 * `staff_import_invalid`, `issues` satır numarasıyla). Hata yoksa her satır tek davetle aynı
 * yazımı (`writeStaffInvitation`) tek transaction'da yapar; parola bağlantıları yanıtı
 * beklemeden gider (`services/staff-password-links.ts`). Önizleme (`dryRun`) aynı doğrulamayı yazmadan yapar. Satır içeriği loglanmaz ve
 * denetime yazılmaz (yalnız davet başına alan adları).
 */

const IMPORT_ACTION = 'staff.import'

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value : ''
}

const isActive = (record: StoredRecord) => record.data.isActive !== false

/** Satırlardaki olası e-postalar (küçük harf); kurum durumu yalnız bunlar için okunur. */
function candidateEmails(rows: readonly StaffImportRow[]): string[] {
  return [...new Set(rows.map((row) => row.email.trim().toLowerCase()).filter(Boolean))]
}

async function loadImportContext(
  tx: Database,
  institutionId: string,
  emails: readonly string[],
): Promise<{ context: StaffImportContext; existingUsers: Map<string, string> }> {
  const list = [...emails]
  const [members, pending, accounts, records, links, heldTeachers] = await Promise.all([
    list.length === 0
      ? []
      : tx
          .select({ email: users.email })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.institutionId, institutionId), inArray(users.email, list))),
    list.length === 0
      ? []
      : tx
          .select({ email: invitations.email })
          .from(invitations)
          .where(
            and(
              eq(invitations.institutionId, institutionId),
              eq(invitations.status, 'pending'),
              inArray(invitations.email, list),
            ),
          ),
    list.length === 0
      ? []
      : tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.email, list)),
    loadRecords(tx, institutionId, ['teachers', 'branches']),
    tx
      .select({ recordId: membershipLinks.recordId })
      .from(membershipLinks)
      .where(
        and(
          eq(membershipLinks.institutionId, institutionId),
          eq(membershipLinks.kind, 'teacher'),
          isNull(membershipLinks.archivedAt),
        ),
      ),
    pendingTeacherInvitations(tx, institutionId),
  ])
  const teachers: StaffImportTeacher[] = records
    .filter((record) => record.collection === 'teachers' && isActive(record))
    .map((record) => ({
      id: record.id,
      name: text(record.data, 'name'),
      email: text(record.data, 'email'),
      subjectId: text(record.data, 'subjectId'),
      branchId: text(record.data, 'branchId'),
    }))
  const campuses = records
    .filter((record) => record.collection === 'branches' && isActive(record))
    .map((record) => ({ id: record.id, name: text(record.data, 'name') }))
  return {
    context: {
      memberEmails: new Set(members.map((row) => row.email.toLowerCase())),
      pendingEmails: new Set(pending.map((row) => row.email.toLowerCase())),
      teachers,
      linkedTeacherIds: new Set(links.map((row) => row.recordId)),
      pendingTeacherIds: heldTeachers,
      campuses,
      subjects: subjects.map(({ id, name }) => ({ id, name })),
    },
    existingUsers: new Map(accounts.map((row) => [row.email.toLowerCase(), row.id])),
  }
}

function parseRows(csv: string): StaffImportRow[] {
  try {
    return parseStaffImport(csv)
  } catch (error) {
    throw mapOperationError(error)
  }
}

/** Satır hatası → hata zarfı maddesi: yol `['rows', satır, alan]` (satırın bütününde alan yok). */
function toIssue(issue: StaffImportIssue): Issue {
  return {
    path: ['rows', issue.line, ...(issue.field === null ? [] : [issue.field])],
    code: issue.code,
    message: `${issue.line}. satır: ${issue.message}`,
  }
}

function result(
  dryRun: boolean,
  rowCount: number,
  invitedCount: number,
  issues: StaffImportIssue[],
) {
  return { data: { dryRun, rowCount, invitedCount, issues } }
}

/**
 * Toplu personel aktarımı ya da önizlemesi (IST-007, DOM-YTK-070). Önizleme 200 ve satır hataları;
 * aktarım 201, hatalı dosyada 422 `staff_import_invalid` ve hiçbir yazma. Dosya düzeyindeki sorun
 * (başlık, satır sınırı, tırnak) iki yolda da 422 ve sorunun kodu.
 */
export async function importStaffMembers(
  ctx: ServiceContext,
  auth: Auth,
  links: StaffLinkScheduler,
  input: Required<StaffImportInput>,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const rows = parseRows(input.csv)
  const emails = candidateEmails(rows)

  if (input.dryRun) {
    // Önizleme yazmaz, kurum kilidi almaz; istek anahtarı saklanmaz. Aktarım aynı denetimi kilit
    // altında yeniden yapar: arada açılan üyelik ya da davet orada reddedilir.
    const plan = await ctx.db.transaction(async (tx) => {
      await loadActorAdmin(tx, ctx)
      const { context } = await loadImportContext(tx, ctx.institutionId, emails)
      return planStaffImport(rows, context)
    })
    return {
      statusCode: 200,
      body: result(true, rows.length, plan.invitations.length, plan.issues),
      replayed: false,
    }
  }

  const out: { body?: unknown } = {}
  const written: StaffLinkJobData[] = []
  let existingUsers = new Map<string, string>()
  const response = await runCommand(
    ctx,
    {
      action: IMPORT_ACTION,
      collections: [],
      // Çalıştırıcının koleksiyon denetimi yazılmaz; her davetin denetimi `after`'da yazılır.
      entity: { type: 'staff_import', id: 'new' },
      load: async (tx) => {
        await loadActorAdmin(tx, ctx)
        const loaded = await loadImportContext(tx, ctx.institutionId, emails)
        existingUsers = loaded.existingUsers
        return {
          run: () => {
            const plan = planStaffImport(rows, loaded.context)
            if (plan.issues.length > 0)
              throw new AppError(
                422,
                'staff_import_invalid',
                STAFF_IMPORT_MESSAGES.staff_import_invalid,
                { issues: plan.issues.map(toIssue) },
              )
            return plan.invitations
          },
        }
      },
      after: async (tx, planned) => {
        const bound = await authTransaction(auth, tx)
        const inviter = await bound.internalAdapter.findUserById(ctx.actor.userId)
        if (inviter === null) throw new Error('inviter not found')
        // `line` yalnız hata iletisi içindir; Better Auth'a yalnız davet alanları gider.
        for (const { line, ...invitation } of planned) {
          void line
          written.push(
            await writeStaffInvitation(tx, ctx, bound, inviter, {
              input: invitation,
              existingUserId: existingUsers.get(invitation.email) ?? null,
              action: IMPORT_ACTION,
              links,
            }),
          )
        }
        out.body = result(false, rows.length, planned.length, [])
      },
    },
    () => {
      if (out.body === undefined) throw new Error('staff import produced no body')
      return { statusCode: 201, body: out.body }
    },
    idempotency,
  )
  if (!response.replayed) links.afterCommit(written)
  return response
}
