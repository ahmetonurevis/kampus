import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import { sql } from 'drizzle-orm'

import type { PlacementSessionDraft } from '@kampus/school-core/cefr/placement.ts'
import type { ProgressionBasis } from '@kampus/school-core/cefr/progression.ts'
import type { EvidenceSnapshot } from '@kampus/school-core/cefr/suggestion.ts'

import type { App } from '../src/app.ts'
import {
  findPlacementSession,
  insertLevelDecisions,
  insertPlacementSession,
  insertProgressionDecision,
  listLevelDecisions,
  listPlacementSessions,
  listProgressionDecisions,
  loadCurrentLevels,
  type GroupProgressionDraft,
  type LevelDecisionDraft,
} from '../src/db/cefr.ts'
import type { Database } from '../src/db/client.ts'
import { databaseErrorInfo } from '../src/errors.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
} from './support/app.ts'
import { seedResource } from './support/resources-sample.ts'

/**
 * CEFR tabloları ve deposu (OG-053; migration 0034; ADR 0004 karar 8; IST-058, IST-060, IST-062).
 * Uç bu dilimde yok (OG-054); satırlar depo fonksiyonuyla ya da doğrudan SQL ile yazılır ve
 * ihlal kısıt adıyla doğrulanır. Her test kendi kurumlarını kurar.
 */

const TABLES = ['placement_sessions', 'level_decisions', 'progression_decisions'] as const
const minutes = (n: number) => new Date(FIXED_NOW.getTime() + n * 60_000).toISOString()

const SNAPSHOT: EvidenceSnapshot = {
  schemaVersion: 2,
  context: 'placement',
  computedAt: FIXED_NOW.toISOString(),
  overall: { status: 'insufficient', missingSkills: ['reading'] },
  skills: [],
  evidence: [],
}

const BASIS: ProgressionBasis = {
  schemaVersion: 1,
  attendance: {
    totalHours: 12,
    attendedHours: 11,
    absentHours: 1,
    unrecordedHours: 0,
    requiredHours: 10,
    minAttendancePermille: 800,
    met: true,
  },
  finalPassScore: 60,
  assessments: [],
  conditions: { attendance: true, finalScore: true, skills: true },
}

/** Sürücüden bağımsız kısıt ihlali beklentisi: PGlite hatası `cause`'ta. */
async function violates(work: Promise<unknown>, constraint: string) {
  await assert.rejects(work, (error: unknown) => {
    assert.equal(databaseErrorInfo(error)?.constraint, constraint)
    return true
  })
}

/** Değişmez satır tetikleyicisinin reddi (`kampus_reject_immutable_change`): 55000. */
async function rejectsImmutable(work: Promise<unknown>, table: string) {
  await assert.rejects(work, (error: unknown) => {
    assert.equal(databaseErrorInfo(error)?.code, '55000')
    const cause = (error as { cause?: { message?: string } }).cause
    assert.match(cause?.message ?? String(error), new RegExp(`${table} rows are immutable`))
    return true
  })
}

describe('0034: CEFR tabloları ve deposu', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  const rows = async <T>(query: ReturnType<typeof sql>) =>
    ((await db.execute(query)) as unknown as { rows: T[] }).rows

  /** Dil okulu, öğrencisi, adayı, öğretmeni ve tespit formu. */
  async function tenant() {
    const institution = await createInstitution(app, { type: 'language_school' })
    const teacher = await createMember(app, institution.id, 'ogretmen')
    const coordinator = await createMember(app, institution.id, 'ogretmen')
    const student = `s-${randomUUID().slice(0, 8)}`
    const prospect = `p-${randomUUID().slice(0, 8)}`
    for (const [collection, id] of [
      ['students', student],
      ['prospects', prospect],
    ] as const)
      await db.execute(sql`insert into records (institution_id, collection, id, data, position)
        values (${institution.id}, ${collection}, ${id}, ${JSON.stringify({ id })}::jsonb, 1)`)
    const form = await seedResource(db, institution.id, { ownerUserId: institution.admin.id })
    const formVersion = form.versions[0]
    assert.ok(formVersion)
    const session = (overrides: Partial<PlacementSessionDraft> = {}): PlacementSessionDraft => ({
      learnerKind: 'student',
      learnerId: student,
      formId: form.resource.id,
      formVersionId: formVersion.id,
      mode: 'in_person',
      startedAt: FIXED_NOW.toISOString(),
      completedAt: minutes(60),
      ...overrides,
    })
    return { institution, teacher, coordinator, student, prospect, session }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  const decision = (
    t: Tenant,
    overrides: Partial<Exclude<LevelDecisionDraft, { kind: 'placement' }>> = {},
  ): LevelDecisionDraft => ({
    kind: 'correction',
    learnerKind: 'student',
    learnerId: t.student,
    skill: null,
    level: 'B1',
    rationale: 'Ara değerlendirme sonrası düzeltildi.',
    decidedByUserId: t.teacher.id,
    decidedAt: FIXED_NOW.toISOString(),
    evidenceSnapshot: SNAPSHOT,
    ...overrides,
  })

  /** Kurumun etkin bir kuru. */
  async function course(t: Tenant) {
    const courseId = randomUUID()
    await db.execute(sql`insert into courses (institution_id, id, name, name_key, language, level,
        total_hours, weekly_hours, session_minutes, min_learners, max_learners, certified, status,
        activated_at, e_ozel_approval)
      values (${t.institution.id}, ${courseId}, ${courseId}, ${courseId}, 'en', 'B1', 12, 4, 45, 2,
        12, false, 'active', ${FIXED_NOW}, 'not_submitted')`)
    return courseId
  }

  /** Kurun dil grubu ve öğrencinin grup kaydı (`language_group_members`). */
  async function enrollment(t: Tenant) {
    const courseId = await course(t)
    const groupId = randomUUID()
    const memberId = randomUUID()
    await db.execute(sql`insert into language_groups (institution_id, id, course_id, name, name_key,
        age_band, teacher_membership_id, delivery, room, room_key, schedule, start_date, end_date,
        capacity, state)
      values (${t.institution.id}, ${groupId}, ${courseId}, ${groupId}, ${groupId}, 'adult',
        ${t.teacher.membershipId}, 'online', null, null,
        '[{"weekday":1,"startTime":"18:00"}]'::jsonb, '2026-10-12', '2026-10-28', 10, 'planned')`)
    await db.execute(sql`insert into language_group_members (institution_id, id, group_id,
        student_id, status, joined_at)
      values (${t.institution.id}, ${memberId}, ${groupId}, ${t.student}, 'active', ${FIXED_NOW})`)
    return { courseId, groupId, enrollmentId: memberId }
  }
  type Enrollment = Awaited<ReturnType<typeof enrollment>>

  const progression = (
    t: Tenant,
    e: Enrollment,
    overrides: Partial<GroupProgressionDraft> = {},
  ): GroupProgressionDraft => ({
    enrollmentId: e.enrollmentId,
    groupId: e.groupId,
    learnerId: t.student,
    courseId: e.courseId,
    outcome: 'passed',
    status: 'pending',
    rationale: 'Koşullar sağlandı.',
    correctsDecisionId: null,
    decidedByUserId: t.teacher.id,
    decidedAt: FIXED_NOW.toISOString(),
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    basis: BASIS,
    evidenceSnapshot: SNAPSHOT,
    ...overrides,
  })

  test('migration uygulanır: indeksler institution_id ile başlar, zamanlar timestamptz, tetikleyiciler kurulu', async () => {
    for (const table of TABLES) {
      const indexes = await rows<{ indexname: string; indexdef: string }>(
        sql`select indexname, indexdef from pg_indexes where tablename = ${table}`,
      )
      assert.ok(indexes.length >= 3, table)
      for (const index of indexes)
        assert.match(index.indexdef, /\(institution_id[,)]/, index.indexname)
      const columns = await rows<{ column_name: string; data_type: string; is_nullable: string }>(
        sql`select column_name, data_type, is_nullable from information_schema.columns
            where table_name = ${table}`,
      )
      const byName = new Map(columns.map((column) => [column.column_name, column]))
      for (const required of ['institution_id', 'created_at', 'updated_at', 'version'])
        assert.equal(byName.get(required)?.is_nullable, 'NO', `${table}.${required}`)
      assert.equal(byName.get('archived_at')?.is_nullable, 'YES', `${table}.archived_at`)
      for (const column of columns)
        assert.notEqual(column.data_type, 'timestamp without time zone', column.column_name)
    }
    const triggers = await rows<{ tgname: string }>(
      sql`select tgname from pg_trigger where not tgisinternal
          and tgrelid in ('level_decisions'::regclass, 'progression_decisions'::regclass)
          order by tgname`,
    )
    assert.deepEqual(
      triggers.map((row) => row.tgname),
      [
        'level_decisions_immutable_trigger',
        'level_decisions_truncate_trigger',
        'progression_decisions_decided_trigger',
        'progression_decisions_truncate_trigger',
      ],
    )
  })

  test('IST-058, DOM-DIL-012: tespit oturumu yazılır ve okunur; kişinin tek süren oturumu olur', async () => {
    const t = await tenant()
    const first = await insertPlacementSession(db, t.institution.id, t.session())
    assert.deepEqual(await findPlacementSession(db, t.institution.id, first.id), first)
    assert.equal(first.completedAt, minutes(60))
    const open = await insertPlacementSession(
      db,
      t.institution.id,
      t.session({ startedAt: minutes(120), completedAt: null, mode: 'remote' }),
    )
    await violates(
      insertPlacementSession(db, t.institution.id, t.session({ completedAt: null })),
      'placement_sessions_in_progress_key',
    )
    const prospect = await insertPlacementSession(
      db,
      t.institution.id,
      t.session({ learnerKind: 'prospect', learnerId: t.prospect, completedAt: null }),
    )
    assert.deepEqual(
      (await listPlacementSessions(db, t.institution.id, { kind: 'student', id: t.student })).map(
        (s) => s.id,
      ),
      [first.id, open.id],
    )
    assert.deepEqual(
      await listPlacementSessions(db, t.institution.id, { kind: 'prospect', id: t.prospect }),
      [prospect],
    )
    // Aynı kimlik öğrenci değil aday koleksiyonundadır: tür ve kimlik birlikte süzülür.
    assert.deepEqual(
      await listPlacementSessions(db, t.institution.id, { kind: 'student', id: t.prospect }),
      [],
    )
  })

  test('IST-058: kısıtlar geçersiz değeri ve başka kurumun kaydını reddeder', async () => {
    const t = await tenant()
    const other = await tenant()
    await violates(
      insertPlacementSession(db, t.institution.id, t.session({ learnerId: other.student })),
      'placement_sessions_learner_fkey',
    )
    // Öğrenci kimliği aday koleksiyonunda aranır: tür ve kayıt uyuşmalıdır.
    await violates(
      insertPlacementSession(db, t.institution.id, t.session({ learnerKind: 'prospect' })),
      'placement_sessions_learner_fkey',
    )
    await violates(
      insertPlacementSession(db, t.institution.id, other.session({ learnerId: t.student })),
      'placement_sessions_form_fkey',
    )
    await violates(
      insertPlacementSession(
        db,
        t.institution.id,
        t.session({ mode: 'online' as unknown as 'remote' }),
      ),
      'placement_sessions_mode_check',
    )
    await violates(
      insertPlacementSession(db, t.institution.id, t.session({ completedAt: minutes(-1) })),
      'placement_sessions_completed_check',
    )

    await violates(
      insertLevelDecisions(db, t.institution.id, [decision(t, { level: 'B3' as 'B2' })]),
      'level_decisions_level_check',
    )
    await violates(
      insertLevelDecisions(db, t.institution.id, [decision(t, { skill: 'grammar' as 'reading' })]),
      'level_decisions_skill_check',
    )
    await violates(
      insertLevelDecisions(db, t.institution.id, [decision(t, { rationale: '   ' })]),
      'level_decisions_rationale_check',
    )
    await violates(
      insertLevelDecisions(db, t.institution.id, [decision(t, { learnerId: other.student })]),
      'level_decisions_learner_fkey',
    )
    await violates(
      insertLevelDecisions(db, t.institution.id, [
        decision(t, { decidedByUserId: other.teacher.id }),
      ]),
      'level_decisions_decided_by_fkey',
    )
    await violates(
      insertLevelDecisions(db, t.institution.id, [
        decision(t, {
          evidenceSnapshot: { ...SNAPSHOT, schemaVersion: 1 as 2 },
        }),
      ]),
      'level_decisions_evidence_snapshot_check',
    )
    // Yerleştirme kararı oturumsuz, oturumlu karar da yerleştirme dışı olamaz.
    await violates(
      db.execute(sql`insert into level_decisions (institution_id, id, learner_kind, learner_id,
          kind, level, rationale, decided_by_user_id, decided_at, evidence_snapshot)
        values (${t.institution.id}, gen_random_uuid(), 'student', ${t.student}, 'placement', 'B1',
          'Gerekçe', ${t.teacher.id}, ${FIXED_NOW}, ${JSON.stringify(SNAPSHOT)}::jsonb)`),
      'level_decisions_placement_check',
    )
  })

  test('IST-058, DOM-DIL-010: yerleştirme kararı oturumun kişisine bağlıdır; oturum ve beceri başına tek karar', async () => {
    const t = await tenant()
    const other = await tenant()
    const session = await insertPlacementSession(db, t.institution.id, t.session())
    const otherSession = await insertPlacementSession(db, other.institution.id, other.session())
    const placement = (
      overrides: Partial<Extract<LevelDecisionDraft, { kind: 'placement' }>> = {},
    ): LevelDecisionDraft => ({
      kind: 'placement',
      learnerKind: 'student',
      learnerId: t.student,
      placementSessionId: session.id,
      skill: null,
      level: 'B1',
      rationale: 'Tespit sonucu.',
      decidedByUserId: t.teacher.id,
      decidedAt: minutes(90),
      evidenceSnapshot: SNAPSHOT,
      ...overrides,
    })
    const saved = await insertLevelDecisions(db, t.institution.id, [
      placement(),
      placement({ skill: 'writing', level: 'A2+' }),
    ])
    assert.deepEqual(
      saved.map((d) => [d.kind, d.skill, d.level, d.placementSessionId]),
      [
        ['placement', null, 'B1', session.id],
        ['placement', 'writing', 'A2+', session.id],
      ],
    )
    await violates(
      insertLevelDecisions(db, t.institution.id, [placement({ level: 'B2' })]),
      'level_decisions_placement_skill_key',
    )
    // Oturum başka kişinin (aday) ya da başka kurumun oturumu olamaz.
    await violates(
      insertLevelDecisions(db, t.institution.id, [
        placement({ learnerKind: 'prospect', learnerId: t.prospect, skill: 'reading' }),
      ]),
      'level_decisions_placement_session_fkey',
    )
    await violates(
      insertLevelDecisions(db, t.institution.id, [
        placement({ placementSessionId: otherSession.id, skill: 'reading' }),
      ]),
      'level_decisions_placement_session_fkey',
    )
    assert.equal(
      (await listLevelDecisions(db, t.institution.id, { kind: 'student', id: t.student })).length,
      2,
    )
  })

  test('IST-060, DOM-BEC-034: güncel seviye beceri başına en son karardan gelir; zaman çizelgesi en yeniden eskiye', async () => {
    const t = await tenant()
    const session = await insertPlacementSession(db, t.institution.id, t.session())
    const [overall, reading] = await insertLevelDecisions(db, t.institution.id, [
      {
        kind: 'placement',
        learnerKind: 'student',
        learnerId: t.student,
        placementSessionId: session.id,
        skill: null,
        level: 'A2',
        rationale: 'Tespit sonucu.',
        decidedByUserId: t.teacher.id,
        decidedAt: minutes(90),
        evidenceSnapshot: SNAPSHOT,
      },
      {
        kind: 'placement',
        learnerKind: 'student',
        learnerId: t.student,
        placementSessionId: session.id,
        skill: 'reading',
        level: 'B1',
        rationale: 'Okuma bölümü güçlü.',
        decidedByUserId: t.teacher.id,
        decidedAt: minutes(90),
        evidenceSnapshot: SNAPSHOT,
      },
    ])
    // Sonraki kararlar sırasız eklenir; sıra karar anından gelir, ekleme sırasından değil.
    const [later] = await insertLevelDecisions(db, t.institution.id, [
      decision(t, { kind: 'progression', level: 'B1', decidedAt: minutes(3000) }),
    ])
    const [middle] = await insertLevelDecisions(db, t.institution.id, [
      decision(t, { level: 'A2+', decidedAt: minutes(1000) }),
    ])
    // Başka kurum ve başka kişinin kararı karışmaz.
    const other = await tenant()
    await insertLevelDecisions(db, other.institution.id, [
      decision(other, { learnerId: other.student, level: 'C1', decidedAt: minutes(5000) }),
    ])
    await insertLevelDecisions(db, t.institution.id, [
      decision(t, { learnerKind: 'prospect', learnerId: t.prospect, decidedAt: minutes(5000) }),
    ])
    assert.ok(overall && reading && later && middle)

    const learner = { kind: 'student', id: t.student } as const
    const timeline = await listLevelDecisions(db, t.institution.id, learner)
    assert.deepEqual(
      timeline.map((d) => d.id),
      [later.id, middle.id, ...[overall.id, reading.id].sort().reverse()],
    )
    const current = await loadCurrentLevels(db, t.institution.id, learner)
    assert.deepEqual(
      Object.fromEntries(
        current.map((c) => [c.skill ?? 'overall', [c.decision.id, c.decision.level]]),
      ),
      { overall: [later.id, 'B1'], reading: [reading.id, 'B1'] },
    )
    assert.deepEqual(await listLevelDecisions(db, other.institution.id, learner), [])
    assert.deepEqual(await loadCurrentLevels(db, other.institution.id, learner), [])
  })

  test('IST-060: seviye kararı değişmez; güncelleme ve silme 55000 ile reddedilir', async () => {
    const t = await tenant()
    const [saved] = await insertLevelDecisions(db, t.institution.id, [decision(t)])
    assert.ok(saved)
    await rejectsImmutable(
      db.execute(sql`update level_decisions set level = 'C1' where id = ${saved.id}`),
      'level_decisions',
    )
    await rejectsImmutable(
      db.execute(sql`delete from level_decisions where id = ${saved.id}`),
      'level_decisions',
    )
    const [row] = await rows<{ level: string }>(
      sql`select level from level_decisions where id = ${saved.id}`,
    )
    assert.equal(row?.level, 'B1')
  })

  test('IST-062, DOM-DIL-070: kur sonu kararı yazılır ve listelenir; kayıtta tek açık karar, başka kurum görmez', async () => {
    const t = await tenant()
    const e = await enrollment(t)
    const pending = await insertProgressionDecision(db, t.institution.id, progression(t, e))
    assert.equal(pending.status, 'pending')
    assert.deepEqual(pending.basis, BASIS)
    await violates(
      insertProgressionDecision(
        db,
        t.institution.id,
        progression(t, e, { decidedAt: minutes(10), outcome: 'repeat' }),
      ),
      'progression_decisions_pending_key',
    )
    // Koordinatör onaylar (açık karar güncellenebilir); onaylanmış karar artık değişmez.
    await db.execute(sql`update progression_decisions set status = 'approved',
        reviewed_by_user_id = ${t.coordinator.id}, reviewed_at = ${new Date(minutes(30))}
      where institution_id = ${t.institution.id} and id = ${pending.id}`)
    await rejectsImmutable(
      db.execute(sql`update progression_decisions set outcome = 'repeat' where id = ${pending.id}`),
      'progression_decisions',
    )
    const correction = await insertProgressionDecision(
      db,
      t.institution.id,
      progression(t, e, {
        outcome: 'repeat',
        correctsDecisionId: pending.id,
        decidedAt: minutes(60),
      }),
    )
    assert.deepEqual(
      (await listProgressionDecisions(db, t.institution.id, { enrollmentId: e.enrollmentId })).map(
        (d) => [d.id, d.status, d.correctsDecisionId],
      ),
      [
        [pending.id, 'approved', null],
        [correction.id, 'pending', pending.id],
      ],
    )
    assert.equal(
      (await listProgressionDecisions(db, t.institution.id, { learnerId: t.student })).length,
      2,
    )

    const other = await tenant()
    assert.deepEqual(
      await listProgressionDecisions(db, other.institution.id, { enrollmentId: e.enrollmentId }),
      [],
    )
    assert.deepEqual(
      await listProgressionDecisions(db, other.institution.id, { learnerId: t.student }),
      [],
    )
    // Başka kurumun kaydına, kuruna ya da öğrencisine karar yazılamaz.
    await violates(
      insertProgressionDecision(
        db,
        other.institution.id,
        progression(other, e, { learnerId: other.student }),
      ),
      'progression_decisions_enrollment_fkey',
    )
    const otherEnrollment = await enrollment(other)
    await violates(
      insertProgressionDecision(
        db,
        other.institution.id,
        progression(other, otherEnrollment, { learnerId: t.student }),
      ),
      'progression_decisions_enrollment_fkey',
    )
    await violates(
      insertProgressionDecision(
        db,
        other.institution.id,
        progression(other, { ...otherEnrollment, courseId: e.courseId }),
      ),
      'progression_decisions_group_fkey',
    )
  })

  test('IST-062, DOM-DIL-070: kur sonu kararı kaydın kursiyerine, grubuna ve kuruna kilitlidir', async () => {
    const t = await tenant()
    const e = await enrollment(t)
    const write = (overrides: Partial<GroupProgressionDraft>) =>
      insertProgressionDecision(db, t.institution.id, progression(t, e, overrides))
    // Aynı kurumun başka öğrencisi: A'nın kaydına B'nin kararı yazılamaz.
    const otherStudent = `s-${randomUUID().slice(0, 8)}`
    await db.execute(sql`insert into records (institution_id, collection, id, data, position)
      values (${t.institution.id}, 'students', ${otherStudent},
        ${JSON.stringify({ id: otherStudent })}::jsonb, 1)`)
    await violates(write({ learnerId: otherStudent }), 'progression_decisions_enrollment_fkey')
    // Aynı kurumun başka kuru ve başka grubu: kayıt yalnız kendi grubuna ve o grubun kuruna bağlıdır.
    const otherCourse = await course(t)
    await violates(write({ courseId: otherCourse }), 'progression_decisions_group_fkey')
    const sibling = await enrollment(t)
    await violates(write({ groupId: sibling.groupId }), 'progression_decisions_enrollment_fkey')
    await violates(
      write({ groupId: sibling.groupId, courseId: sibling.courseId }),
      'progression_decisions_enrollment_fkey',
    )
    // Düzeltme yalnız aynı kaydın kararına yapılır.
    const siblingDecision = await insertProgressionDecision(
      db,
      t.institution.id,
      progression(t, sibling, {
        status: 'approved',
        reviewedByUserId: t.coordinator.id,
        reviewedAt: minutes(5),
      }),
    )
    await violates(
      write({ correctsDecisionId: siblingDecision.id }),
      'progression_decisions_corrects_fkey',
    )
    const decided = await write({})
    assert.equal(decided.learnerId, t.student)
    assert.deepEqual(
      await listProgressionDecisions(db, t.institution.id, { learnerId: otherStudent }),
      [],
    )
  })

  test('DOM-DIL-070: kur sonu kararının sonuç, inceleme ve kopya kısıtları', async () => {
    const t = await tenant()
    const e = await enrollment(t)
    const write = (overrides: Partial<GroupProgressionDraft>) =>
      insertProgressionDecision(db, t.institution.id, progression(t, e, overrides))
    await violates(write({ outcome: 'failed' as 'repeat' }), 'progression_decisions_outcome_check')
    await violates(write({ status: 'approved' }), 'progression_decisions_review_check')
    await violates(
      write({ status: 'rejected', reviewedByUserId: t.coordinator.id, reviewedAt: minutes(5) }),
      'progression_decisions_review_check',
    )
    await violates(write({ rejectionReason: 'Eksik.' }), 'progression_decisions_review_check')
    await violates(
      write({ basis: { ...BASIS, schemaVersion: 2 as 1 } }),
      'progression_decisions_basis_check',
    )
    await violates(
      write({ correctsDecisionId: randomUUID() }),
      'progression_decisions_corrects_fkey',
    )
    await violates(
      write({ reviewedByUserId: randomUUID(), reviewedAt: minutes(5), status: 'approved' }),
      'progression_decisions_reviewed_by_fkey',
    )
    const rejected = await write({
      status: 'rejected',
      reviewedByUserId: t.coordinator.id,
      reviewedAt: minutes(5),
      rejectionReason: 'Ara ölçme eksik.',
    })
    await rejectsImmutable(
      db.execute(sql`delete from progression_decisions where id = ${rejected.id}`),
      'progression_decisions',
    )
    assert.equal(
      (await listProgressionDecisions(db, t.institution.id, { enrollmentId: e.enrollmentId }))
        .length,
      1,
    )
  })
})
