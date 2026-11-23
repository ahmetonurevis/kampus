import {
  canRevealPersonnelNationalId,
  filledPersonnelFileGroups,
  personnelFileAccess,
  personnelFileInputSchema,
  personnelFileUpdateSchema,
  personnelFileView,
  planPersonnelFile,
  planPersonnelFileUpdate,
  readablePersonnelFileGroups,
  storedEducationSchema,
  storedEmergencyContactsSchema,
  type PersonnelFileGroup,
  type PersonnelFileValues,
} from '@kampus/school-core/lib/finance-personnel-files.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { isStaffRole } from '@kampus/school-core/lib/staff-accounts.ts'

import type { Database } from '../db/client.ts'
import { findStaffMember } from '../db/finance-pay-rates.ts'
import {
  findPersonnelFile,
  insertPersonnelFile,
  listPersonnelFileStaff,
  personnelCertificateSummary,
  updatePersonnelFile,
  type PersonnelFileColumns,
  type PersonnelFileStaffQuery,
  type StoredPersonnelFile,
} from '../db/finance-personnel-files.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { ConflictError, ForbiddenError, NotFoundError } from '../errors.ts'
import type { FieldBinding, FieldCipher } from '../lib/field-crypto.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { personnelDevelopmentSummary } from './finance-professional-development-hours.ts'
import { runCommand, type CommandResponse, type IdempotencyRequest } from './operation-runner.ts'
import { auditWork } from './task-work.ts'

/**
 * Personel özlük kartı (DOM-FIN-140; ON-172; K-475…K-477). Kural ve alan grubu × rol matrisi core
 * `lib/finance-personnel-files.ts`'tedir; servis kurum kilidi altında üyeliği ve kartı yükler, T.C.
 * kimlik no ile IBAN'ı alan anahtarıyla şifreleyip çözer ve aynı transaction'da yazar. Yanıt yalnız
 * rolün okuyabildiği grupları taşır (`personnelFileView`); T.C. kimlik no ve IBAN okumada maskelidir.
 * Tam T.C. kimlik no yalnız yöneticiye döner ve her okuma denetim kaydına düşer (K-476). Denetim
 * kaydına alan adları yazılır, değer yazılmaz; değerler loga hiç verilmez. Rol ve modül denetimi
 * rotadadır.
 */

const ENTITY = 'staff_personnel_files'
const TABLE = 'staff_personnel_files'

export interface PersonnelFileDeps {
  cipher: FieldCipher
}

const binding = (
  institutionId: string,
  membershipId: string,
  column: 'national_id' | 'iban',
): FieldBinding => ({ institutionId, table: TABLE, column, rowKey: membershipId })

function decrypt(
  deps: PersonnelFileDeps,
  institutionId: string,
  stored: StoredPersonnelFile,
  column: 'national_id' | 'iban',
): string | null {
  const ciphertext = column === 'national_id' ? stored.nationalIdCiphertext : stored.ibanCiphertext
  const keyVersion = column === 'national_id' ? stored.nationalIdKeyVersion : stored.ibanKeyVersion
  if (ciphertext === null || keyVersion === null) return null
  return deps.cipher.decrypt(binding(institutionId, stored.membershipId, column), {
    ciphertext,
    keyVersion,
  })
}

/**
 * Saklanan satırı çözülmüş değerlere çevirir (yalnız bellekte). Self-servis onayı da (DOM-FIN-166)
 * kartı bu yoldan okur.
 */
export function valuesOf(
  deps: PersonnelFileDeps,
  institutionId: string,
  stored: StoredPersonnelFile,
): PersonnelFileValues {
  return {
    nationalId: decrypt(deps, institutionId, stored, 'national_id'),
    birthDate: stored.birthDate,
    address: stored.address,
    phone: stored.phone,
    email: stored.email,
    education: storedEducationSchema.parse(stored.education),
    iban: decrypt(deps, institutionId, stored, 'iban'),
    accountHolder: stored.bankAccountHolder,
    emergencyContacts: storedEmergencyContactsSchema.parse(stored.emergencyContacts),
  }
}

/** Değerleri yazılacak kolonlara çevirir; T.C. kimlik no ve IBAN şifrelenir (DOM-FIN-166 onayı da). */
export function columnsOf(
  deps: PersonnelFileDeps,
  institutionId: string,
  membershipId: string,
  values: PersonnelFileValues,
): PersonnelFileColumns {
  const nationalId =
    values.nationalId === null
      ? null
      : deps.cipher.encrypt(binding(institutionId, membershipId, 'national_id'), values.nationalId)
  const iban =
    values.iban === null
      ? null
      : deps.cipher.encrypt(binding(institutionId, membershipId, 'iban'), values.iban)
  return {
    nationalIdCiphertext: nationalId?.ciphertext ?? null,
    nationalIdKeyVersion: nationalId?.keyVersion ?? null,
    birthDate: values.birthDate,
    address: values.address,
    phone: values.phone,
    email: values.email,
    education: values.education,
    ibanCiphertext: iban?.ciphertext ?? null,
    ibanKeyVersion: iban?.keyVersion ?? null,
    bankAccountHolder: values.accountHolder,
    emergencyContacts: values.emergencyContacts,
  }
}

/** Rolün okuyabildiği grupların erişimi (`read` ya da `write`). */
function accessView(role: string): Partial<Record<PersonnelFileGroup, 'read' | 'write'>> {
  const access = personnelFileAccess(role)
  const view: Partial<Record<PersonnelFileGroup, 'read' | 'write'>> = {}
  for (const group of readablePersonnelFileGroups(role)) {
    const level = access[group]
    if (level !== 'none') view[group] = level
  }
  return view
}

/** Kartın personeli: kurumun personel üyeliği; yoksa, öğrenci ya da veliyse 404. */
async function staffOf(db: Database, ctx: ServiceContext, membershipId: string) {
  const staff = await findStaffMember(db, ctx.institutionId, membershipId)
  if (staff === null || !isStaffRole(staff.role)) throw new NotFoundError()
  return staff
}

async function fileBody(
  db: Database,
  ctx: ServiceContext,
  deps: PersonnelFileDeps,
  membershipId: string,
) {
  const staff = await staffOf(db, ctx, membershipId)
  const stored = await findPersonnelFile(db, ctx.institutionId, membershipId)
  if (stored === null) throw new NotFoundError()
  const role = ctx.actor.role
  const access = personnelFileAccess(role)
  const view = personnelFileView(valuesOf(deps, ctx.institutionId, stored), role)
  return {
    membershipId,
    name: staff.name,
    role: staff.role,
    active: staff.active,
    version: stored.version,
    updatedAt: stored.updatedAt.toISOString(),
    access: accessView(role),
    canRevealNationalId: canRevealPersonnelNationalId(role) && access.identity !== 'none',
    ...view,
    // Sertifika özeti eğitim grubuyla birlikte görünür (özlük belgeleri, DOM-FIN-113).
    ...(view.education === undefined
      ? {}
      : {
          certificates: await personnelCertificateSummary(
            db,
            ctx.institutionId,
            membershipId,
            dayKey(ctx.now),
          ),
          // Mesleki gelişim saati özeti (DOM-FIN-144, K-489): içinde bulunulan öğretim yılı.
          professionalDevelopment: await personnelDevelopmentSummary(
            ctx,
            db,
            membershipId,
            staff.role,
          ),
        }),
  }
}

/** Personel listesi ve kart durumu; dolu gruplar yalnız rolün okuyabildiklerinden. */
export async function listPersonnelFilesFor(ctx: ServiceContext, query: PersonnelFileStaffQuery) {
  const readable = new Set(readablePersonnelFileGroups(ctx.actor.role))
  const { items, total } = await listPersonnelFileStaff(ctx.db, ctx.institutionId, query)
  return {
    items: items.map((row) => ({
      membershipId: row.membershipId,
      name: row.name,
      role: row.role,
      active: row.active,
      hasFile: row.version !== null,
      version: row.version,
      updatedAt: row.updatedAt?.toISOString() ?? null,
      filledGroups: (Object.keys(row.filled) as PersonnelFileGroup[]).filter(
        (group) => readable.has(group) && row.filled[group],
      ),
    })),
    total,
  }
}

export async function getPersonnelFileFor(
  ctx: ServiceContext,
  deps: PersonnelFileDeps,
  membershipId: string,
) {
  return fileBody(ctx.db, ctx, deps, membershipId)
}

/**
 * Tam T.C. kimlik no (K-476): yalnız yönetici; okuma aynı transaction'da denetime yazılır
 * (`finance.personnel_file.national_id_read`, alan adı); denetim yazılamazsa değer dönmez.
 */
export async function revealPersonnelNationalIdFor(
  ctx: ServiceContext,
  deps: PersonnelFileDeps,
  membershipId: string,
) {
  if (!canRevealPersonnelNationalId(ctx.actor.role)) throw new ForbiddenError()
  return ctx.db.transaction(async (tx) => {
    await staffOf(tx, ctx, membershipId)
    const stored = await findPersonnelFile(tx, ctx.institutionId, membershipId)
    if (stored === null) throw new NotFoundError()
    const nationalId = decrypt(deps, ctx.institutionId, stored, 'national_id')
    await tx.insert(auditLog).values({
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: 'finance.personnel_file.national_id_read',
      entityType: ENTITY,
      entityId: membershipId,
      // kvkk: değer değil, dönen alanın adı.
      changes: { fields: nationalId === null ? [] : ['identity.nationalId'] },
      createdAt: ctx.now,
    })
    return { nationalId }
  })
}

/** Yeni kart (DOM-FIN-140, K-475); 201. */
export function createPersonnelFileCommand(
  ctx: ServiceContext,
  deps: PersonnelFileDeps,
  input: unknown,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const target = personnelFileInputSchema.safeParse(input).data?.membershipId ?? 'unknown'
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.personnel_file.create',
      collections: [],
      entity: { type: ENTITY, id: target },
      load: async (tx) => {
        const parsed = personnelFileInputSchema.parse(input)
        const staff = await findStaffMember(tx, ctx.institutionId, parsed.membershipId)
        const exists =
          (await findPersonnelFile(tx, ctx.institutionId, parsed.membershipId)) !== null
        return {
          run: () => ({
            membershipId: parsed.membershipId,
            values: planPersonnelFile(ctx.actor.role, parsed, {
              staff,
              exists,
              today: dayKey(ctx.now),
            }),
          }),
        }
      },
      after: async (tx, { membershipId, values }) => {
        await insertPersonnelFile(tx, ctx.institutionId, {
          membershipId,
          columns: columnsOf(deps, ctx.institutionId, membershipId, values),
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        const entity = { type: ENTITY, id: membershipId }
        await auditWork(
          tx,
          ctx,
          'finance.personnel_file.create',
          entity,
          filledPersonnelFileGroups(values),
        )
        body = { data: await fileBody(tx, ctx, deps, membershipId) }
      },
    },
    () => ({ statusCode: 201, body }),
    idempotency,
  )
}

/** Kart düzeltmesi (K-475); `If-Match` kart sürümü. */
export function updatePersonnelFileCommand(
  ctx: ServiceContext,
  deps: PersonnelFileDeps,
  membershipId: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
): Promise<CommandResponse> {
  const entity = { type: ENTITY, id: membershipId }
  let body: unknown
  return runCommand(
    ctx,
    {
      action: 'finance.personnel_file.update',
      collections: [],
      entity,
      load: async (tx) => {
        const parsed = personnelFileUpdateSchema.parse(input)
        await staffOf(tx, ctx, membershipId)
        const stored = await findPersonnelFile(tx, ctx.institutionId, membershipId)
        if (stored === null) throw new NotFoundError()
        if (stored.version !== expectedVersion) throw new ConflictError()
        const current = valuesOf(deps, ctx.institutionId, stored)
        return {
          run: () => planPersonnelFileUpdate(ctx.actor.role, current, parsed, dayKey(ctx.now)),
        }
      },
      after: async (tx, { values, changed }) => {
        const saved = await updatePersonnelFile(tx, ctx.institutionId, {
          membershipId,
          columns: columnsOf(deps, ctx.institutionId, membershipId, values),
          expectedVersion,
          userId: ctx.actor.userId,
          now: ctx.now,
        })
        if (!saved) throw new ConflictError()
        await auditWork(tx, ctx, 'finance.personnel_file.update', entity, changed)
        body = { data: await fileBody(tx, ctx, deps, membershipId) }
      },
    },
    () => ({ statusCode: 200, body }),
    idempotency,
  )
}
