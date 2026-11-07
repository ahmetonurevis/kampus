import { createHmac } from 'node:crypto'

import type { Database } from '../db/client.ts'
import { auditLog } from '../db/schema/audit-log.ts'

export type AuditEntry = Omit<typeof auditLog.$inferInsert, 'id' | 'createdAt' | 'ipHash'> & {
  ip?: string | null | undefined
}

/** Ham IP tutulmaz: sunucu sırrıyla tuzlanmış SHA-256 (HMAC). */
export function hashIp(secret: string, ip: string): string {
  return createHmac('sha256', `${secret}:audit-ip`).update(ip).digest('hex')
}

export async function recordAudit(
  ctx: { db: Database; secret: string },
  { ip, ...entry }: AuditEntry,
): Promise<void> {
  await ctx.db.insert(auditLog).values({ ...entry, ipHash: ip ? hashIp(ctx.secret, ip) : null })
}
