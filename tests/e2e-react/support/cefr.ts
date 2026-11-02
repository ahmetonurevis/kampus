import { randomUUID } from 'node:crypto'

import { connectPostgres } from '../../../apps/api/src/db/client.ts'
import { levelDecisions } from '../../../apps/api/src/db/schema/cefr.ts'
import { languageGroupMembers } from '../../../apps/api/src/db/schema/language-groups.ts'
import { expect } from '@playwright/test'

import type { ApiClient } from './api.ts'
import { e2e } from './env.ts'

/**
 * CEFR profili ekranları için test verisi (OG-054). Kur ve grup API'den açılır; kursiyer üyeliği
 * kayıt akışına (Onur'un alanı) ve seviye kararı tam tespit akışına (form, beş bölüm, bitirme)
 * bağlı olduğundan ikisi doğrudan veritabanına yazılır. Tespit akışının kuralları API testindedir
 * (`apps/api/test/cefr.test.ts`).
 */

/** Bugünden en az iki hafta sonraki pazartesi (YYYY-MM-DD, UTC); grup ileri tarihli başlar. */
function futureMonday(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 14))
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

async function teacherMembershipId(admin: ApiClient, name: string): Promise<string> {
  const result = await admin.get('/api/v1/institution-members?role=ogretmen&pageSize=100')
  expect(result.status).toBe(200)
  const member = (result.body as { data: { id: string; name: string }[] }).data.find(
    (item) => item.name === name,
  )
  expect(member, `öğretmen üyeliği: ${name}`).toBeDefined()
  return member?.id ?? ''
}

/** Etkin B1 kuru ve öğretmenin planlı grubu; öğrenci gruba kursiyer olarak eklenir. */
export async function seedTeacherGroup(
  admin: ApiClient,
  input: { institutionId: string; teacherName: string; studentId: string; groupName: string },
): Promise<void> {
  const course = await admin.post(
    '/api/v1/courses',
    {
      name: 'E2E Genel İngilizce B1',
      level: 'B1',
      totalHours: 12,
      weeklyHours: 4,
      minLearners: 2,
      maxLearners: 12,
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(course.status, JSON.stringify(course.body)).toBe(201)
  const courseId = (course.body as { data: { id: string } }).data.id
  const activated = await admin.post(
    `/api/v1/courses/${courseId}/activate`,
    {},
    { 'idempotency-key': randomUUID(), 'if-match': '"1"' },
  )
  expect(activated.status, JSON.stringify(activated.body)).toBe(200)
  const group = await admin.post(
    '/api/v1/groups',
    {
      courseId,
      name: input.groupName,
      ageBand: 'adult',
      teacherMembershipId: await teacherMembershipId(admin, input.teacherName),
      delivery: 'in_person',
      room: 'Derslik 1',
      schedule: [
        { weekday: 1, startTime: '18:00' },
        { weekday: 1, startTime: '18:45' },
        { weekday: 3, startTime: '18:00' },
        { weekday: 3, startTime: '18:45' },
      ],
      startDate: futureMonday(),
      capacity: 10,
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(group.status, JSON.stringify(group.body)).toBe(201)
  const groupId = (group.body as { data: { id: string } }).data.id

  const { db, close } = connectPostgres(e2e.databaseUrl)
  try {
    await db.insert(languageGroupMembers).values({
      institutionId: input.institutionId,
      id: randomUUID(),
      groupId,
      studentId: input.studentId,
      status: 'active',
      joinedAt: new Date(),
    })
  } finally {
    await close()
  }
}

/** Öğrencinin genel seviyesine gerekçeli bir düzeltme kararı yazar (`level_decisions`). */
export async function seedLevelDecision(input: {
  institutionId: string
  studentId: string
  decidedByUserId: string
  level: 'B1'
  rationale: string
}): Promise<void> {
  const now = new Date()
  const { db, close } = connectPostgres(e2e.databaseUrl)
  try {
    await db.insert(levelDecisions).values({
      institutionId: input.institutionId,
      id: randomUUID(),
      learnerKind: 'student',
      learnerId: input.studentId,
      kind: 'correction',
      placementSessionId: null,
      skill: null,
      level: input.level,
      rationale: input.rationale,
      decidedByUserId: input.decidedByUserId,
      decidedAt: now,
      evidenceSnapshot: {
        schemaVersion: 2,
        context: 'general',
        computedAt: now.toISOString(),
        overall: { status: 'insufficient', missingSkills: [] },
        skills: [],
        evidence: [],
      },
    })
  } finally {
    await close()
  }
}
