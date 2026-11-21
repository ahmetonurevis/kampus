import { randomUUID } from 'node:crypto'

import pg from 'pg'

import { e2e } from './env.ts'

/**
 * Ziyaretçi saklama ekranı için süresi dolmuş kayıt (DOM-FIN-141; ON-166; K-480). Uçlar 24 saatten
 * eski giriş yazmadığı için kurumda 1 Mart 2025'te gelip çıkmış bir ziyaretçi doğrudan yazılır;
 * varsayılan 30 günlük süre 31 Mart 2025'te dolmuştur. Kural dalları API testindedir
 * (`apps/api/test/finance-visitors.test.ts`).
 */
export async function seedExpiredVisitor(
  institutionId: string,
  visitorName: string,
): Promise<void> {
  const client = new pg.Client({ connectionString: e2e.databaseUrl })
  await client.connect()
  try {
    const admin = await client.query<{ user_id: string }>(
      `select user_id from memberships where institution_id = $1 and role = 'yonetici' limit 1`,
      [institutionId],
    )
    const userId = admin.rows[0]?.user_id
    if (userId === undefined) throw new Error('e2e tenant has no manager membership')
    await client.query(
      `insert into visitor_logs (institution_id, id, visitor_name, identity_verified,
        identity_document_type, phone, purpose, visit_on, checked_in_at, checked_out_at,
        privacy_notice_version, checked_in_by_user_id, checked_out_by_user_id)
       values ($1, $2, $3, true, 'national_id', '05321234567', 'supplier', '2025-03-01',
        '2025-03-01T07:00:00Z', '2025-03-01T08:00:00Z', 'v1', $4, $4)`,
      [institutionId, randomUUID(), visitorName, userId],
    )
  } finally {
    await client.end()
  }
}
