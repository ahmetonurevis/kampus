import { randomUUID } from 'node:crypto'

import pg from 'pg'

import { e2e } from './env.ts'

/**
 * Mülakat aşamasındaki başvuru (DOM-FIN-138; ON-178; K-469). Yayındaki ilan ve "mülakat"
 * aşamasına geçmiş başvuru aşama geçmişiyle doğrudan yazılır; ilan ve başvuru girişi ON-177
 * e2e'sinde sınanır. Günler bugünün İstanbul gününden geriye sayılır.
 */
export async function seedInterviewStageApplication(
  institutionId: string,
  candidateName: string,
  today: string,
): Promise<void> {
  const daysAgo = (days: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
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
        publish_on, deadline_on, status, created_by_user_id)
       values ($1, $2, 'Fen bilimleri öğretmeni', 'Fen bilimleri', 'full_time',
        'Ortaokul fen bilimleri dersleri için öğretmen.', $3, $4, 'published', $5)`,
      [institutionId, postingId, daysAgo(30), daysAgo(-30), userId],
    )
    await client.query(
      `insert into job_applications (institution_id, id, job_posting_id, candidate_name, email,
        channel, received_on, privacy_notice_version, privacy_notice_shown_on, stage,
        stage_changed_on, recorded_by_user_id)
       values ($1, $2, $3, $4, 'fen.aday@ornek.com', 'email', $5, 'v1', $5, 'interview', $6, $7)`,
      [institutionId, applicationId, postingId, candidateName, daysAgo(20), daysAgo(10), userId],
    )
    for (const [from, to, day] of [
      [null, 'new', daysAgo(20)],
      ['new', 'interview', daysAgo(10)],
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
