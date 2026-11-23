import { payerChildren, type PayerChild } from '@kampus/school-core/lib/finance-payer-children.ts'

import { loadRecordsByIds } from '../db/records.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { assertReadable, readScope } from './read-scope.ts'

/**
 * Ödeyicisi olunan çocuklar (`GET /finance/payer-children`; ON-313, K-04; DOM-FIN-052,
 * DOM-ILT-074). Kapsam core `scope.payerStudentIds`'tir: velayeti olsun olmasın ödeyici ve iletişim
 * kısıtı olmayan bağ. Kapsamın kendisi finans okumasıdır (`invoices` kuralı, modül `finance`).
 * Yalnız kurumun arşivlenmemiş öğrenci ve sınıf kayıtları okunur; satır core `payerChildren` ile
 * ad ve sınıf adına indirgenir (KVKK asgarisi). Hiçbir şey yazılmaz ve loglanmaz.
 */
export async function listPayerChildrenFor(ctx: ServiceContext): Promise<PayerChild[]> {
  const scope = await readScope(ctx)
  assertReadable(ctx, scope, 'invoices')
  const ids = [...scope.payerStudentIds]
  if (ids.length === 0) return []
  const students = await loadRecordsByIds(ctx.db, ctx.institutionId, 'students', ids)
  const classIds = [
    ...new Set(
      students.flatMap((row) => (typeof row.data.classId === 'string' ? [row.data.classId] : [])),
    ),
  ]
  const classes = await loadRecordsByIds(ctx.db, ctx.institutionId, 'classes', classIds)
  return payerChildren(
    scope,
    students.map((row) => ({ id: row.id, name: row.data.name, classId: row.data.classId })),
    classes.map((row) => ({ id: row.id, name: row.data.name })),
  )
}
