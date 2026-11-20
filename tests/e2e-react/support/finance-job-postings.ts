import { randomUUID } from 'node:crypto'

import pg from 'pg'

import { e2e } from './env.ts'

/**
 * İş ilanı saklama ekranı için süresi dolmuş başvuru (DOM-FIN-128; ON-177; K-441). Uçlar geçmiş
 * tarihli kapanış yazmadığı için kurumda 2025'te kapanmış bir ilan ve 1 Mart 2025'te reddedilmiş
 * başvurusu doğrudan yazılır; varsayılan 12 aylık süre 1 Mart 2026'da dolmuştur. Kural dalları API
 * testindedir (`apps/api/test/finance-job-postings.test.ts`).
 */
export async function seedExpiredJobApplication(
  institutionId: string,
  candidateName: string,
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
    const postingId = randomUUID()
    const applicationId = randomUUID()
    await client.query(
      `insert into job_postings (institution_id, id, title, position, employment_type, description,
        publish_on, deadline_on, status, closed_on, created_by_user_id)
       values ($1, $2, 'Geçen yılın matematik ilanı', 'Matematik öğretmeni', 'full_time',
        'Lise matematik dersleri için öğretmen.', '2025-01-01', '2025-02-01', 'closed',
        '2025-02-15', $3)`,
      [institutionId, postingId, userId],
    )
    await client.query(
      `insert into job_applications (institution_id, id, job_posting_id, candidate_name, email,
        channel, received_on, privacy_notice_version, privacy_notice_shown_on, stage,
        stage_changed_on, recorded_by_user_id)
       values ($1, $2, $3, $4, 'eski.aday@ornek.com', 'email', '2025-01-20', 'v1', '2025-01-20',
        'rejected', '2025-03-01', $5)`,
      [institutionId, applicationId, postingId, candidateName, userId],
    )
    for (const [from, to, day] of [
      [null, 'new', '2025-01-20'],
      ['new', 'rejected', '2025-03-01'],
    ] as const)
      await client.query(
        `insert into job_application_stage_changes (institution_id, id, job_application_id,
          from_stage, to_stage, changed_on, changed_by_user_id)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [institutionId, randomUUID(), applicationId, from, to, day, userId],
      )
  } finally {
    await client.end()
  }
}
