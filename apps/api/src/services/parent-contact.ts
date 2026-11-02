import {
  revealParentContact,
  type RevealedParentContact,
  type RevealParentContactInput,
} from '@kampus/school-core/lib/parent-contact.ts'

import { findRecord } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { mapOperationError } from './operation-runner.ts'
import { readScope } from './read-scope.ts'

/**
 * Öğretmenin velinin tam iletişim bilgisini açması (DOM-YTK-055, DOM-YTK-052). Karar core
 * `revealParentContact`'tadır: yalnız ders verdiği öğrencinin o öğrenciye bağlı velisi; kapsam
 * dışı, bağsız veya olmayan veli 404, boş alan 422.
 *
 * Değer yalnız denetim kaydı yazıldıktan sonra döner; kayıt yazılamazsa değer de dönmez. Denetim
 * kaydına değer değil alan adı ve öğrenci kimliği yazılır (`changes`); log yalnız kimlik taşır.
 * İşlem kayıt değiştirmediği için kurum kilidi ve sürüm denetimi gerekmez.
 */
export async function revealParentContactCommand(
  ctx: ServiceContext,
  parentId: string,
  input: RevealParentContactInput,
): Promise<RevealedParentContact> {
  const [scope, row] = await Promise.all([
    readScope(ctx),
    findRecord(ctx.db, ctx.institutionId, 'parents', parentId),
  ])
  let revealed: RevealedParentContact
  try {
    revealed = revealParentContact(scope, row ? { ...row.data, id: row.id } : undefined, input)
  } catch (error) {
    throw mapOperationError(error)
  }
  await ctx.db.insert(auditLog).values({
    institutionId: ctx.institutionId,
    actorUserId: ctx.actor.userId,
    actorRole: ctx.actor.role,
    action: 'parent_contact.reveal',
    entityType: 'parents',
    entityId: revealed.parentId,
    // kvkk: K — değer yazılmaz; yalnız açılan alanın adı ve hangi öğrencinin velisi olduğu.
    changes: { fields: [revealed.field], studentId: revealed.studentId },
    createdAt: ctx.now,
  })
  ctx.log.info({
    event: 'parent_contact.reveal',
    parentId: revealed.parentId,
    studentId: revealed.studentId,
    field: revealed.field,
  })
  return revealed
}
