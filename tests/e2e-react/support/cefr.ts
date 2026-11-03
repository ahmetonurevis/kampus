import { randomUUID } from 'node:crypto'

import { connectPostgres } from '../../../apps/api/src/db/client.ts'
import { levelDecisions } from '../../../apps/api/src/db/schema/cefr.ts'
import { languageGroupMembers } from '../../../apps/api/src/db/schema/language-groups.ts'
import { expect } from '@playwright/test'

import type { CefrLevel, PrimarySkill } from '../../../packages/school-core/src/content/taxonomy.ts'

import type { ApiClient } from './api.ts'
import { e2e } from './env.ts'

/**
 * CEFR profili ekranları için test verisi (OG-054, OG-079). Kur ve grup API'den açılır; kursiyer üyeliği
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

/**
 * Etkin B1 kuru ve planlı grubu; öğrenci gruba kursiyer olarak eklenir. `teacherName: null`
 * öğretmensiz grup açar (koordinatör kapsamı, OG-079).
 */
export async function seedTeacherGroup(
  admin: ApiClient,
  input: {
    institutionId: string
    teacherName: string | null
    studentId: string
    groupName: string
  },
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
      teacherMembershipId:
        input.teacherName === null ? null : await teacherMembershipId(admin, input.teacherName),
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

/** Öğretmene seviyenin akademik koordinatörlüğünü verir (DOM-YTK-027). */
export async function assignCoordinator(
  admin: ApiClient,
  teacherName: string,
  level: CefrLevel,
): Promise<void> {
  const result = await admin.post(
    '/api/v1/coordinator-duties',
    { membershipId: await teacherMembershipId(admin, teacherName), scopeId: level },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status, JSON.stringify(result.body)).toBe(201)
}

/** Karar anı kopyasına konacak kanıt görevi (`evidence_snapshot.evidence`). */
export interface SeedEvidence {
  title: string
  skill: PrimarySkill
  percent: number
  successful: boolean
}

/**
 * Öğrenciye gerekçeli bir seviye kararı yazar (`level_decisions`). Varsayılan genel seviyeye
 * bugünkü düzeltme kararıdır; `daysAgo` kararı geçmişe alır, `evidence` karar anı kopyasına
 * kanıt görevi koyar (OG-079).
 */
export async function seedLevelDecision(input: {
  institutionId: string
  studentId: string
  decidedByUserId: string
  level: CefrLevel
  rationale: string
  skill?: PrimarySkill | null
  /** Yerleştirme tespit oturumu ister (`level_decisions_placement_check`); burada yazılmaz. */
  kind?: 'progression' | 'correction'
  daysAgo?: number
  evidence?: readonly SeedEvidence[]
}): Promise<void> {
  const now = new Date(Date.now() - (input.daysAgo ?? 0) * 24 * 60 * 60_000)
  const evidence = (input.evidence ?? []).map((item) => ({
    id: randomUUID(),
    taskId: randomUUID(),
    title: item.title,
    source: 'task' as const,
    skill: item.skill,
    targetLevel: input.level,
    performedAt: new Date(now.getTime() - 60 * 60_000).toISOString(),
    successful: item.successful,
    percent: item.percent,
    items: null,
  }))
  const { db, close } = connectPostgres(e2e.databaseUrl)
  try {
    await db.insert(levelDecisions).values({
      institutionId: input.institutionId,
      id: randomUUID(),
      learnerKind: 'student',
      learnerId: input.studentId,
      kind: input.kind ?? 'correction',
      placementSessionId: null,
      skill: input.skill ?? null,
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
        evidence,
      },
    })
  } finally {
    await close()
  }
}
