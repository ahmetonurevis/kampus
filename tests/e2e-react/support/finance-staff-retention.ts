import { randomUUID } from 'node:crypto'

import pg from 'pg'

import { e2e } from './env.ts'

/**
 * Özlük saklama ve imha ekranı için ayrılmış personel (DOM-FIN-122; ON-176). Uçlar pasif personele
 * belge yazmadığı ve ayrılış günü geçmişe alınamadığı için kurumun öğretmeni 1 Mayıs 2014'te
 * pasifleştirilmiş sayılır ve ona bir adli sicil kaydı ile bir diploma yazılır. Kural dalları API
 * testindedir (`apps/api/test/finance-staff-retention.test.ts`).
 */
export async function seedDepartedTeacher(institutionId: string): Promise<void> {
  const client = new pg.Client({ connectionString: e2e.databaseUrl })
  await client.connect()
  try {
    const left = await client.query<{ id: string; admin: string }>(
      `update memberships m set deactivated_at = '2014-05-01T09:00:00Z'
        where m.institution_id = $1 and m.role = 'ogretmen'
        returning m.id, (select user_id from memberships a
          where a.institution_id = $1 and a.role = 'yonetici' limit 1) as admin`,
      [institutionId],
    )
    const teacher = left.rows[0]
    if (teacher === undefined) throw new Error('e2e tenant has no teacher membership')
    for (const documentType of ['criminal_record', 'diploma'])
      await client.query(
        `insert into staff_documents (institution_id, id, membership_id, document_type,
          document_date, valid_until_source, created_by_user_id)
         values ($1, $2, $3, $4, '2013-01-10', 'type', $5)`,
        [institutionId, randomUUID(), teacher.id, documentType, teacher.admin],
      )
  } finally {
    await client.end()
  }
}
