import { randomUUID } from 'node:crypto'

import pg from 'pg'

import { e2e } from './env.ts'

/**
 * Kayıp eşya saklama ekranı için süresi dolmuş eşya (DOM-FIN-145; ON-171; K-492). Uç 90 günden eski
 * bulunma günü yazmadığı için kurumda 1 Mart 2025'te bulunmuş bekleyen bir eşya doğrudan yazılır;
 * varsayılan 30 günlük süre 31 Mart 2025'te dolmuştur. Kural dalları API testindedir
 * (`apps/api/test/finance-lost-items.test.ts`).
 */
export async function seedExpiredLostItem(institutionId: string, description: string) {
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
      `insert into lost_items (institution_id, id, description, category, found_location, found_on,
        storage_location, created_by_user_id)
       values ($1, $2, $3, 'clothing', 'Bahçe', '2025-03-01', 'Ön büro dolabı', $4)`,
      [institutionId, randomUUID(), description, userId],
    )
  } finally {
    await client.end()
  }
}
