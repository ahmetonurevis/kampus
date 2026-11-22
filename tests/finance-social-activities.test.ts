import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  activityCovers,
  approvedMinutes,
  assertSocialActivityArchivable,
  assertSocialActivityResponsible,
  assertSocialHourPending,
  assertSocialHourReversible,
  assertSocialStudent,
  canManageSocialActivity,
  certificateRows,
  DEFAULT_SOCIAL_TARGETS,
  hoursLabel,
  hoursToMinutes,
  isHighSchoolGrade,
  minutesToHours,
  planSocialActivity,
  planSocialActivityUpdate,
  planSocialHourDeclaration,
  planSocialHourEntries,
  socialAcademicYearLabel,
  socialAcademicYearOf,
  socialActivityCreateSchema,
  socialActivitySettingsSchema,
  socialActivityUpdateSchema,
  socialHourDeclarationSchema,
  socialHourEntrySchema,
  socialHourRejectSchema,
  socialProgress,
  type StoredSocialActivityFields,
} from '../packages/school-core/src/lib/finance-social-activities.ts'

/** Lise sosyal etkinlik ve gönüllülük saati kuralları (DOM-FIN-160; ON-170; K-535…K-537). */

const ACTIVITY_ID = '00000000-0000-4000-8000-000000000001'
const CLUB_ID = '00000000-0000-4000-8000-000000000002'
const admin = { role: 'yonetici', membershipId: 'm-admin' }
const teacher = { role: 'ogretmen', membershipId: 'm-teacher' }

function rejects(fn: () => unknown, code: string, kind: 'rule' | 'conflict' = 'rule') {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const createInput = {
  name: ' Huzurevi ziyareti ',
  kind: 'volunteering',
  startDate: '2026-10-01',
  location: 'Kadıköy',
  responsibleMembershipId: 'm-teacher',
  organizationScope: 'external',
  organizationName: 'Kadıköy Huzurevi',
}

const stored: StoredSocialActivityFields = {
  name: 'Huzurevi ziyareti',
  kind: 'volunteering',
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  location: 'Kadıköy',
  responsibleMembershipId: 'm-teacher',
  organizationScope: 'external',
  organizationName: 'Kadıköy Huzurevi',
  clubId: null,
}
const lise = { active: true, grade: 10 }

describe('DOM-FIN-160: sosyal etkinlik şemaları', () => {
  test('DOM-FIN-160: etkinlik varsayılanları, bitiş sırası, kurum dışı kuruluş ve kulüp türü (K-535)', () => {
    const parsed = socialActivityCreateSchema.parse(createInput)
    assert.equal(parsed.name, 'Huzurevi ziyareti')
    assert.equal(parsed.endDate, null)
    assert.equal(parsed.clubId, null)
    const issues = (value: Record<string, unknown>) =>
      socialActivityCreateSchema
        .safeParse({ ...createInput, ...value })
        .error?.issues.map((issue) => issue.path.join('.'))
    assert.deepEqual(issues({ endDate: '2026-09-30' }), ['endDate'])
    assert.deepEqual(issues({ organizationName: null }), ['organizationName'])
    assert.deepEqual(issues({ clubId: CLUB_ID }), ['clubId'])
    assert.equal(issues({ kind: 'club', clubId: CLUB_ID }), undefined)
    assert.equal(issues({ organizationScope: 'internal', organizationName: null }), undefined)
    assert.ok(issues({ extra: 1 })?.length)
    assert.equal(socialActivityUpdateSchema.safeParse({}).success, false)
    assert.equal(socialActivityUpdateSchema.safeParse({ endDate: null }).success, true)
  })

  test('DOM-FIN-160: saat yarım saat adımlı 0,5–10; öğrenciler tekil 1–100; not boşsa null (K-536)', () => {
    const base = { activityDate: '2026-10-05', hours: 2.5, studentIds: ['s5'] }
    assert.equal(socialHourEntrySchema.parse({ ...base, note: '  ' }).note, null)
    for (const hours of [0, 0.25, 1.2, 10.5])
      assert.equal(
        socialHourEntrySchema.safeParse({ ...base, hours }).success,
        false,
        String(hours),
      )
    assert.equal(socialHourEntrySchema.safeParse({ ...base, studentIds: [] }).success, false)
    assert.equal(
      socialHourEntrySchema.safeParse({ ...base, studentIds: ['s5', 's5'] }).success,
      false,
    )
    assert.equal(
      socialHourDeclarationSchema.safeParse({
        activityId: 'yok',
        activityDate: '2026-10-05',
        hours: 1,
      }).success,
      false,
    )
    assert.equal(socialHourRejectSchema.safeParse({ reason: 'kısa' }).success, false)
    assert.equal(socialHourRejectSchema.safeParse({ reason: 'Fotoğraf yok' }).success, true)
    assert.equal(socialActivitySettingsSchema.safeParse({}).success, false)
    assert.equal(socialActivitySettingsSchema.safeParse({ yearlyTargetHours: null }).success, true)
    assert.equal(socialActivitySettingsSchema.safeParse({ totalTargetHours: 201 }).success, false)
    assert.equal(hoursToMinutes(2.5), 150)
    assert.equal(minutesToHours(150), 2.5)
    assert.equal(hoursLabel(150), '2,5 saat')
  })
})

describe('DOM-FIN-160: etkinlik kuralları', () => {
  test('DOM-FIN-160: öğretmen yalnız kendini sorumlu yazar; sorumlu etkin öğretmen ya da yönetici (K-535)', () => {
    const parsed = socialActivityCreateSchema.parse(createInput)
    const ok = { role: 'ogretmen', active: true }
    planSocialActivity(parsed, { actor: teacher, responsible: ok, clubFound: null })
    planSocialActivity(parsed, {
      actor: admin,
      responsible: { role: 'yonetici', active: true },
      clubFound: null,
    })
    rejects(
      () =>
        planSocialActivity(
          { ...parsed, responsibleMembershipId: 'm-other' },
          { actor: teacher, responsible: ok, clubFound: null },
        ),
      'social_activity_teacher_not_self',
    )
    rejects(() => assertSocialActivityResponsible(null), 'social_activity_teacher_not_found')
    rejects(
      () => assertSocialActivityResponsible({ role: 'onburo', active: true }),
      'social_activity_teacher_not_teacher',
    )
    rejects(
      () => assertSocialActivityResponsible({ role: 'ogretmen', active: false }),
      'social_activity_teacher_inactive',
    )
    rejects(
      () => planSocialActivity(parsed, { actor: admin, responsible: ok, clubFound: false }),
      'social_activity_club_not_found',
    )
    assert.equal(canManageSocialActivity(admin, stored), true)
    assert.equal(canManageSocialActivity(teacher, stored), true)
    assert.equal(canManageSocialActivity({ role: 'ogretmen', membershipId: 'x' }, stored), false)
    assert.equal(
      canManageSocialActivity({ role: 'onburo', membershipId: 'm-teacher' }, stored),
      false,
    )
  })

  test('DOM-FIN-160: düzenleme değişen alanları verir; kayıtlı gün aralık dışına bırakılamaz (K-535)', () => {
    const checks = {
      actor: admin,
      responsible: undefined,
      clubFound: null,
      entryDays: { first: '2026-10-05', last: '2026-10-20' },
    }
    const plan = planSocialActivityUpdate(stored, { endDate: null, location: 'Moda' }, checks)
    assert.deepEqual(plan.changed, ['endDate', 'location'])
    assert.equal(plan.next.endDate, null)
    rejects(
      () => planSocialActivityUpdate(stored, { name: stored.name }, checks),
      'social_activity_unchanged',
    )
    rejects(
      () => planSocialActivityUpdate(stored, { endDate: '2026-10-10' }, checks),
      'social_activity_entries_outside_range',
    )
    rejects(
      () => planSocialActivityUpdate(stored, { startDate: '2026-10-06' }, checks),
      'social_activity_entries_outside_range',
    )
    rejects(
      () =>
        planSocialActivityUpdate(stored, { endDate: '2026-09-01' }, { ...checks, entryDays: null }),
      'social_activity_date_order',
    )
    rejects(
      () =>
        planSocialActivityUpdate(
          stored,
          { responsibleMembershipId: 'm-x' },
          { ...checks, actor: teacher },
        ),
      'social_activity_teacher_not_self',
    )
    rejects(
      () =>
        planSocialActivityUpdate(
          stored,
          { responsibleMembershipId: 'm-x' },
          { ...checks, responsible: { role: 'onburo', active: true } },
        ),
      'social_activity_teacher_not_teacher',
    )
    rejects(
      () => planSocialActivityUpdate(stored, { organizationName: null }, checks),
      'social_activity_organization_required',
    )
    rejects(
      () => planSocialActivityUpdate(stored, { clubId: CLUB_ID }, checks),
      'social_activity_club_kind',
    )
    rejects(
      () =>
        planSocialActivityUpdate(
          stored,
          { kind: 'club', clubId: CLUB_ID },
          { ...checks, clubFound: false },
        ),
      'social_activity_club_not_found',
    )
    assert.deepEqual(
      planSocialActivityUpdate(
        stored,
        { kind: 'club', clubId: CLUB_ID },
        { ...checks, clubFound: true },
      ).changed,
      ['kind', 'clubId'],
    )
    assertSocialActivityArchivable(0)
    rejects(() => assertSocialActivityArchivable(1), 'social_activity_has_pending')
    assert.equal(activityCovers({ startDate: '2026-10-01', endDate: null }, '2027-05-01'), true)
    assert.equal(activityCovers(stored, '2026-11-01'), false)
  })
})

describe('DOM-FIN-160: saat girişi, beyan, karar ve ters kayıt', () => {
  const entry = { activityDate: '2026-10-05', hours: 2, studentIds: ['s5', 's6'], note: null }

  test('DOM-FIN-160: yalnız etkin lise öğrencisi; gün bugünü geçmez ve aralıkta; aynı gün yinelenmez (K-536)', () => {
    const students = new Map([
      ['s5', lise],
      ['s6', { active: true, grade: 12 }],
    ])
    const checks = { today: '2026-10-06', students, existing: new Set<string>() }
    planSocialHourEntries(stored, entry, checks)
    rejects(
      () => planSocialHourEntries(stored, { ...entry, activityDate: '2026-10-07' }, checks),
      'social_activity_date_future',
    )
    rejects(
      () => planSocialHourEntries(stored, { ...entry, activityDate: '2026-09-30' }, checks),
      'social_activity_date_outside',
    )
    rejects(
      () => planSocialHourEntries(stored, entry, { ...checks, existing: new Set(['s6']) }),
      'social_activity_entry_exists',
      'conflict',
    )
    rejects(
      () => planSocialHourEntries(stored, entry, { ...checks, students: new Map([['s5', lise]]) }),
      'social_activity_student_not_found',
    )
    rejects(
      () => assertSocialStudent({ active: false, grade: 9 }, []),
      'social_activity_student_inactive',
    )
    rejects(
      () => assertSocialStudent({ active: true, grade: 8 }, []),
      'social_activity_student_not_high_school',
    )
    rejects(
      () => assertSocialStudent({ active: true, grade: undefined }, []),
      'social_activity_student_not_high_school',
    )
    assert.deepEqual([8, 9, 12, 13].map(isHighSchoolGrade), [false, true, true, false])
    const declaration = {
      activityId: ACTIVITY_ID,
      activityDate: '2026-10-05',
      hours: 1,
      note: null,
    }
    planSocialHourDeclaration(stored, declaration, {
      today: '2026-10-06',
      student: lise,
      exists: false,
    })
    rejects(
      () =>
        planSocialHourDeclaration(stored, declaration, {
          today: '2026-10-06',
          student: lise,
          exists: true,
        }),
      'social_activity_entry_exists',
      'conflict',
    )
    rejects(
      () =>
        planSocialHourDeclaration(stored, declaration, {
          today: '2026-10-06',
          student: null,
          exists: false,
        }),
      'social_activity_student_not_found',
    )
  })

  test('DOM-FIN-160: karar yalnız bekleyen beyanda; ters kayıt yalnız onaylı ve düzeltilmemiş kayıtta (K-536)', () => {
    assertSocialHourPending({ kind: 'entry', status: 'pending', reversedByEntryId: null })
    for (const status of ['approved', 'rejected'] as const)
      rejects(
        () => assertSocialHourPending({ kind: 'entry', status, reversedByEntryId: null }),
        'social_activity_entry_decided',
        'conflict',
      )
    assertSocialHourReversible({ kind: 'entry', status: 'approved', reversedByEntryId: null })
    rejects(
      () =>
        assertSocialHourReversible({ kind: 'entry', status: 'pending', reversedByEntryId: null }),
      'social_activity_entry_not_reversible',
      'conflict',
    )
    rejects(
      () =>
        assertSocialHourReversible({
          kind: 'reversal',
          status: 'approved',
          reversedByEntryId: null,
        }),
      'social_activity_entry_not_reversible',
      'conflict',
    )
    rejects(
      () =>
        assertSocialHourReversible({ kind: 'entry', status: 'approved', reversedByEntryId: 'x' }),
      'social_activity_entry_reversed',
      'conflict',
    )
  })
})

describe('DOM-FIN-160: özet ve belge', () => {
  test('DOM-FIN-160: öğretim yılı Eylül başlar; onaylı net dakika ters kaydı düşer (K-537)', () => {
    assert.equal(socialAcademicYearOf('2026-09-01'), 2026)
    assert.equal(socialAcademicYearOf('2027-08-31'), 2026)
    assert.equal(socialAcademicYearLabel(2026), '2026–2027')
    assert.equal(
      approvedMinutes([
        { status: 'approved', minutes: 120 },
        { status: 'approved', minutes: -120 },
        { status: 'approved', minutes: 90 },
        { status: 'pending', minutes: 300 },
        { status: 'rejected', minutes: 60 },
      ]),
      90,
    )
  })

  test('DOM-FIN-160: hedefe göre durum: toplam tamam met, yıllık tamam on_track, aksi behind (K-537)', () => {
    assert.deepEqual(DEFAULT_SOCIAL_TARGETS, { totalTargetHours: 40, yearlyTargetHours: 10 })
    const progress = (
      totalMinutes: number,
      yearMinutes: number,
      yearlyTargetHours: number | null = 10,
    ) =>
      socialProgress({
        totalMinutes,
        yearMinutes,
        targets: { totalTargetHours: 40, yearlyTargetHours },
      })
    assert.equal(progress(2400, 0).status, 'met')
    assert.equal(progress(2400, 0).totalMissingMinutes, 0)
    assert.equal(progress(600, 600).status, 'on_track')
    const behind = progress(300, 300)
    assert.equal(behind.status, 'behind')
    assert.equal(behind.totalMissingMinutes, 2100)
    assert.equal(behind.yearMissingMinutes, 300)
    const noYearly = progress(600, 600, null)
    assert.equal(noYearly.status, 'behind')
    assert.equal(noYearly.yearMissingMinutes, null)
  })

  test('DOM-FIN-160: belge yalnız onaylı ve düzeltilmemiş kayıtları gün sırasıyla taşır (K-537)', () => {
    const row = (id: string, extra: Partial<Parameters<typeof certificateRows>[0][number]>) => ({
      id,
      kind: 'entry' as const,
      status: 'approved' as const,
      reversedByEntryId: null,
      activityDate: '2026-10-05',
      minutes: 60,
      ...extra,
    })
    const result = certificateRows([
      row('b', { activityDate: '2026-11-02', minutes: 120 }),
      row('a', { activityDate: '2026-10-01' }),
      row('c', { reversedByEntryId: 'r' }),
      row('r', { kind: 'reversal', minutes: -60 }),
      row('p', { status: 'pending' }),
      row('x', { status: 'rejected' }),
    ])
    assert.deepEqual(
      result.rows.map((item) => item.id),
      ['a', 'b'],
    )
    assert.equal(result.totalMinutes, 180)
  })
})
