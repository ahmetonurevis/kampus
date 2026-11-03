import { randomUUID } from 'node:crypto'

import { connectPostgres } from '../../../apps/api/src/db/client.ts'
import { insertLessonHourAttendances } from '../../../apps/api/src/db/progression.ts'
import { expect } from '@playwright/test'

import { CORE_SKILLS } from '../../../packages/school-core/src/cefr/suggestion.ts'

import type { ApiClient } from './api.ts'
import { userIdOf } from './tasks.ts'
import { e2e } from './env.ts'

/**
 * Kurum başarı belgesi e2e verisi (OG-088; IST-081; DOM-DIL-070, DOM-DIL-081): onaylı `passed`
 * kur sonu kararı. Kur, grup, kur ölçmeleri, karar önerisi ve onay API'den yapılır; kurs bitirme
 * kararı bütün ders saatlerinin yoklaması alınmadan verilemez (409 `attendance_pending`). Ders
 * saati yoklamasının yazma ucu henüz yoktur (OG-269), bu yüzden yalnız yoklama satırları API'nin
 * depo işleviyle (`insertLessonHourAttendances`) doğrudan veritabanına yazılır; API testi de aynı
 * yolu kullanır (`apps/api/test/certificates.test.ts`). Kursiyer üyeliği `seedTeacherGroup`'ta
 * aynı gerekçeyle doğrudan yazılır.
 */

const HOURS = 12
const SCORE = 82

async function data<T>(result: Promise<{ status: number; body: unknown }>, status: number) {
  const response = await result
  expect(response.status, JSON.stringify(response.body)).toBe(status)
  return (response.body as { data: T }).data
}

export async function seedApprovedPass(input: {
  institutionId: string
  enrollment: { id: string; groupId: string; studentId: string }
  /** Grubun öğretmeni: ölçmeleri girer ve kararı önerir. */
  teacher: ApiClient
  /** Seviyenin akademik koordinatörü: kararı onaylar (dört göz; DOM-DIL-070). */
  coordinator: ApiClient
}): Promise<{ decisionId: string }> {
  const teacherUserId = await userIdOf(input.teacher)
  const { db, close } = connectPostgres(e2e.databaseUrl)
  try {
    await insertLessonHourAttendances(
      db,
      input.institutionId,
      input.enrollment,
      Array.from({ length: HOURS }, (_, index) => ({
        lessonHourId: `e2e-ders-${String(index + 1)}`,
        status: 'present' as const,
      })),
      { userId: teacherUserId, at: new Date() },
    )
  } finally {
    await close()
  }

  for (const point of ['baseline', 'midterm', 'final'])
    await data(
      input.teacher.post(
        '/api/v1/course-assessments',
        {
          enrollmentId: input.enrollment.id,
          point,
          score: SCORE,
          skills: CORE_SKILLS.map((skill) => ({ skill, score: SCORE, feedback: `${skill} iyi` })),
        },
        { 'idempotency-key': randomUUID() },
      ),
      201,
    )
  const proposed = await data<{ id: string; rowVersion: number }>(
    input.teacher.post(
      '/api/v1/progression-decisions',
      {
        enrollmentId: input.enrollment.id,
        outcome: 'passed',
        rationale: 'Kur sonu ölçmesi ve tam devamla kuru geçti.',
      },
      { 'idempotency-key': randomUUID() },
    ),
    201,
  )
  const approved = await data<{ id: string }>(
    input.coordinator.post(
      `/api/v1/progression-decisions/${proposed.id}/approve`,
      {},
      { 'idempotency-key': randomUUID(), 'if-match': `"${String(proposed.rowVersion)}"` },
    ),
    200,
  )
  return { decisionId: approved.id }
}
