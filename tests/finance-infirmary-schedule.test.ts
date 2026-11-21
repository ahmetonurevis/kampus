import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  administrationCorrectionSchema,
  assertDoseSlotOpen,
  correctionHealthSchema,
  DEFAULT_MEDICATION_SETTINGS,
  DOSE_SKIP_REASON_LABELS,
  DOSE_STATE_LABELS,
  doseSlotKey,
  doseState,
  effectiveAdministration,
  effectiveSkip,
  FINANCE_MEDICATION_CHART_ROLES,
  FINANCE_MEDICATION_CORRECTION_ROLES,
  guardianDoseRange,
  istanbulInstant,
  medicationDoseSkipSchema,
  medicationSettingsSchema,
  planAdministrationCorrection,
  planDoseSkip,
  planMedicationSettings,
  planSkipCorrection,
  resolveDoseSlots,
  skipCorrectionSchema,
  skipHealthSchema,
  sortDoseChart,
  voidedRecordIds,
  type DoseCorrectionRef,
  type DoseRecordRef,
  type DoseSlotState,
  type DoseState,
} from '../packages/school-core/src/lib/finance-infirmary-schedule.ts'

/** İlaç çizelgesi, atlama ve düzeltme kuralları (DOM-FIN-152; ON-161; IST-102; K-511…K-513). */

const NOW = new Date('2026-10-06T09:00:00.000Z') // Europe/Istanbul 12:00
const consent = {
  status: 'approved' as const,
  startDate: '2026-10-05',
  endDate: '2026-10-08',
  times: ['09:00', '12:30'],
}
const open = () => undefined

function rejects(run: () => unknown, code: string, kind: DomainError['kind'] = 'rule') {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError, String(error))
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

const record = (
  kind: DoseRecordRef['kind'],
  id: string,
  extra: Partial<DoseRecordRef> = {},
): DoseRecordRef => ({
  kind,
  id,
  consentId: 'c-1',
  doseDay: '2026-10-06',
  scheduledTime: '12:30',
  replacesId: null,
  createdAt: '2026-10-06T09:00:00.000Z',
  ...extra,
})
const correction = (
  targetId: string,
  kind: DoseCorrectionRef['kind'],
  extra: Partial<DoseCorrectionRef> = {},
): DoseCorrectionRef => ({
  id: `k-${targetId}-${kind}`,
  targetKind: 'administration',
  targetId,
  kind,
  administeredAt: null,
  administeredByMembershipId: null,
  health: { reason: 'Yanlış öğrenciye yazıldı' },
  createdAt: '2026-10-06T10:00:00.000Z',
  ...extra,
})

describe('DOM-FIN-152: ilaç çizelgesi (K-511)', () => {
  test('DOM-FIN-152: roller; çizelge yönetici ve ön büro, düzeltme yalnız yönetici', () => {
    assert.deepEqual([...FINANCE_MEDICATION_CHART_ROLES], ['yonetici', 'onburo'])
    assert.deepEqual([...FINANCE_MEDICATION_CORRECTION_ROLES], ['yonetici'])
    assert.equal(DOSE_STATE_LABELS.administered, 'Verildi')
    assert.equal(DOSE_SKIP_REASON_LABELS.guardian_cancelled, 'Veli iptal etti')
  })

  test('DOM-FIN-152: Europe/Istanbul günü ve saati UTC anına çevrilir', () => {
    assert.equal(istanbulInstant('2026-10-06', '12:30'), '2026-10-06T09:30:00.000Z')
    assert.equal(istanbulInstant('2026-01-01', '00:00'), '2025-12-31T21:00:00.000Z')
    assert.equal(istanbulInstant('2026-12-31', '23:59'), '2026-12-31T20:59:00.000Z')
  })

  test('DOM-FIN-152: durum etkin kayıttan ve gecikme payından türetilir', () => {
    const due = '2026-10-06T08:00:00.000Z' // 11:00
    assert.equal(doseState({ kind: 'administration', id: 'a' }, due, NOW, 30), 'administered')
    assert.equal(doseState({ kind: 'skip', id: 's' }, due, NOW, 30), 'skipped')
    assert.equal(doseState(null, due, NOW, 30), 'overdue')
    assert.equal(doseState(null, due, NOW, 60), 'pending', 'pay sınırında gecikmiş sayılmaz')
    assert.equal(doseState(null, '2026-10-06T09:30:00.000Z', NOW, 5), 'pending')
  })

  test('DOM-FIN-152: geciken dozlar üstte, sonra bekleyen, sonra sonuçlanan; grup içinde saat', () => {
    const row = (state: DoseState, time: string, name: string) => ({
      state,
      scheduledTime: time,
      studentName: name,
      consentId: name,
    })
    const sorted = sortDoseChart([
      row('administered', '08:00', 'Ali'),
      row('pending', '15:00', 'Can'),
      row('overdue', '11:00', 'Ece'),
      row('skipped', '07:00', 'Deniz'),
      row('overdue', '09:00', 'Zeynep'),
      row('pending', '15:00', 'Bora'),
    ])
    assert.deepEqual(
      sorted.map((item) => `${item.state} ${item.scheduledTime} ${item.studentName}`),
      [
        'overdue 09:00 Zeynep',
        'overdue 11:00 Ece',
        'pending 15:00 Bora',
        'pending 15:00 Can',
        'skipped 07:00 Deniz',
        'administered 08:00 Ali',
      ],
    )
  })

  test('DOM-FIN-152: gecikme payı 5–180 dk; değişiklik yoksa 422', () => {
    assert.equal(DEFAULT_MEDICATION_SETTINGS.lateToleranceMinutes, 30)
    assert.equal(medicationSettingsSchema.safeParse({ lateToleranceMinutes: 4 }).success, false)
    assert.equal(medicationSettingsSchema.safeParse({ lateToleranceMinutes: 181 }).success, false)
    assert.equal(medicationSettingsSchema.safeParse({ lateToleranceMinutes: 7.5 }).success, false)
    assert.deepEqual(
      planMedicationSettings(DEFAULT_MEDICATION_SETTINGS, { lateToleranceMinutes: 45 }),
      { next: { lateToleranceMinutes: 45 }, changed: ['lateToleranceMinutes'] },
    )
    rejects(
      () => planMedicationSettings(DEFAULT_MEDICATION_SETTINGS, { lateToleranceMinutes: 30 }),
      'infirmary_settings_unchanged',
    )
  })

  test('DOM-FIN-152: veli doz geçmişi aralığı varsayılan 30 gün, en çok 92 gün', () => {
    assert.deepEqual(guardianDoseRange({}, NOW), { from: '2026-09-07', to: '2026-10-06' })
    assert.deepEqual(guardianDoseRange({ from: '2026-10-01', to: '2026-10-02' }, NOW), {
      from: '2026-10-01',
      to: '2026-10-02',
    })
    rejects(
      () => guardianDoseRange({ from: '2026-10-03', to: '2026-10-02' }, NOW),
      'infirmary_dose_range_invalid',
    )
    rejects(
      () => guardianDoseRange({ from: '2026-07-01', to: '2026-10-06' }, NOW),
      'infirmary_dose_range_too_long',
    )
    assert.deepEqual(
      guardianDoseRange({ from: '2026-07-07', to: '2026-10-06' }, NOW).from,
      '2026-07-07',
    )
  })
})

describe('DOM-FIN-152: doz saatinin tek sonucu ve zincir (K-512, K-513)', () => {
  test('DOM-FIN-152: etkin kayıt zincirin iptal edilmemiş son kaydıdır', () => {
    const key = doseSlotKey('c-1', '2026-10-06', '12:30')
    const first = resolveDoseSlots([record('administration', 'a-1')], new Set())
    assert.deepEqual(first.get(key), {
      active: { kind: 'administration', id: 'a-1' },
      tail: { administration: 'a-1', skip: null },
    })
    const voided = resolveDoseSlots([record('administration', 'a-1')], new Set(['a-1']))
    assert.deepEqual(voided.get(key), { active: null, tail: { administration: 'a-1', skip: null } })
    const chain = resolveDoseSlots(
      [
        record('administration', 'a-1'),
        record('skip', 's-1'),
        record('administration', 'a-2', { replacesId: 'a-1' }),
      ],
      new Set(['a-1', 's-1']),
    )
    assert.deepEqual(chain.get(key), {
      active: { kind: 'administration', id: 'a-2' },
      tail: { administration: 'a-2', skip: 's-1' },
    })
    assert.deepEqual(
      voidedRecordIds([correction('a-1', 'void'), correction('a-2', 'amend')]),
      new Set(['a-1']),
    )
  })

  test('DOM-FIN-152: uygulama varken atlama, atlama varken uygulama 409; boşsa zincir sonu döner', () => {
    const given: DoseSlotState = {
      active: { kind: 'administration', id: 'a-1' },
      tail: { administration: 'a-1', skip: null },
    }
    const skipped: DoseSlotState = {
      active: { kind: 'skip', id: 's-1' },
      tail: { administration: null, skip: 's-1' },
    }
    rejects(() => assertDoseSlotOpen(given, 'skip'), 'infirmary_dose_already_given', 'conflict')
    rejects(
      () => assertDoseSlotOpen(skipped, 'administration'),
      'infirmary_dose_already_skipped',
      'conflict',
    )
    assert.deepEqual(assertDoseSlotOpen(undefined, 'skip'), { replacesId: null })
    assert.deepEqual(
      assertDoseSlotOpen({ active: null, tail: { administration: 'a-1', skip: 's-1' } }, 'skip'),
      { replacesId: 's-1' },
    )
  })
})

describe('DOM-FIN-152: atlama (K-512)', () => {
  const input = (extra: Record<string, unknown> = {}) =>
    medicationDoseSkipSchema.parse({ scheduledTime: '12:30', reason: 'refused', ...extra })

  test('DOM-FIN-152: şema; "diğer" açıklama ister, bilinmeyen alan 400', () => {
    assert.deepEqual(input(), {
      scheduledTime: '12:30',
      doseDay: null,
      reason: 'refused',
      note: null,
    })
    assert.equal(input({ note: '  ' }).note, null)
    const other = medicationDoseSkipSchema.safeParse({ scheduledTime: '12:30', reason: 'other' })
    assert.equal(other.success, false)
    assert.deepEqual(other.error?.issues[0]?.path, ['note'])
    assert.equal(
      medicationDoseSkipSchema.safeParse({ scheduledTime: '12:30', reason: 'other', note: 'Kusma' })
        .success,
      true,
    )
    assert.equal(
      medicationDoseSkipSchema.safeParse({ scheduledTime: '12:30', reason: 'x' }).success,
      false,
    )
    assert.equal(
      medicationDoseSkipSchema.safeParse({
        scheduledTime: '12:30',
        reason: 'refused',
        studentId: 's',
      }).success,
      false,
    )
    assert.equal(skipHealthSchema.safeParse({ reason: 'refused', note: null }).success, true)
  })

  test('DOM-FIN-152: başarılı atlama bugünün doz günüyle; dün de yazılır', () => {
    assert.deepEqual(planDoseSkip(consent, input(), { now: NOW, slot: open }), {
      doseDay: '2026-10-06',
      replacesId: null,
      health: { reason: 'refused', note: null },
    })
    assert.equal(
      planDoseSkip(consent, input({ doseDay: '2026-10-05' }), { now: NOW, slot: open }).doseDay,
      '2026-10-05',
    )
  })

  test('DOM-FIN-152: onaysız, gelecek, eski, dönem dışı ve onay dışı saat 422; sonuçlu doz 409', () => {
    rejects(
      () => planDoseSkip({ ...consent, status: 'withdrawn' }, input(), { now: NOW, slot: open }),
      'infirmary_consent_not_approved',
    )
    rejects(
      () => planDoseSkip(consent, input({ doseDay: '2026-10-07' }), { now: NOW, slot: open }),
      'infirmary_skip_in_future',
    )
    rejects(
      () => planDoseSkip(consent, input({ doseDay: '2026-10-04' }), { now: NOW, slot: open }),
      'infirmary_skip_too_old',
    )
    rejects(
      () =>
        planDoseSkip({ ...consent, startDate: '2026-10-06' }, input({ doseDay: '2026-10-05' }), {
          now: NOW,
          slot: open,
        }),
      'infirmary_skip_outside_period',
    )
    rejects(
      () => planDoseSkip(consent, input({ scheduledTime: '15:00' }), { now: NOW, slot: open }),
      'infirmary_dose_time_not_approved',
    )
    rejects(
      () =>
        planDoseSkip(consent, input(), {
          now: NOW,
          slot: () => ({
            active: { kind: 'administration', id: 'a-1' },
            tail: { administration: 'a-1', skip: null },
          }),
        }),
      'infirmary_dose_already_given',
      'conflict',
    )
  })
})

describe('DOM-FIN-152: düzeltme ve iptal (K-513)', () => {
  const base = {
    administeredAt: '2026-10-06T08:55:00.000Z',
    administeredByMembershipId: 'm-desk',
    note: null,
  }
  const current = { ...base, voided: false, doseDay: '2026-10-06' }
  const amend = (extra: Record<string, unknown>) =>
    administrationCorrectionSchema.parse({
      kind: 'amend',
      reason: 'Saat yanlış girilmiş',
      ...extra,
    })
  const staff = { role: 'onburo', active: true }

  test('DOM-FIN-152: şema; iptalde alan yok, düzeltmede en az bir alan, gerekçe 5–500', () => {
    assert.equal(
      administrationCorrectionSchema.safeParse({ kind: 'void', reason: 'Yanlış öğrenci' }).success,
      true,
    )
    assert.equal(
      administrationCorrectionSchema.safeParse({
        kind: 'void',
        reason: 'Yanlış öğrenci',
        note: 'x',
      }).success,
      false,
    )
    assert.equal(
      administrationCorrectionSchema.safeParse({ kind: 'amend', reason: 'Yanlış öğrenci' }).success,
      false,
    )
    assert.equal(
      administrationCorrectionSchema.safeParse({ kind: 'void', reason: 'kısa' }).success,
      false,
    )
    assert.equal(
      skipCorrectionSchema.safeParse({
        kind: 'amend',
        reason: 'Gerekçe yanlış',
        administeredAt: NOW.toISOString(),
      }).success,
      false,
    )
    assert.equal(
      correctionHealthSchema.safeParse({ reason: 'Gerekçe', note: null, skipReason: 'other' })
        .success,
      true,
    )
  })

  test('DOM-FIN-152: etkin değer düzeltmelerin sırayla uygulanmasıdır; eski hâl korunur', () => {
    const value = effectiveAdministration(base, [
      correction('a-1', 'amend', {
        administeredAt: '2026-10-06T09:00:00.000Z',
        health: { reason: 'Saat', note: 'Tok karnına verildi' },
      }),
      correction('a-1', 'amend', {
        administeredByMembershipId: 'm-admin',
        health: { reason: 'Uygulayan' },
      }),
    ])
    assert.deepEqual(value, {
      administeredAt: '2026-10-06T09:00:00.000Z',
      administeredByMembershipId: 'm-admin',
      note: 'Tok karnına verildi',
      voided: false,
      corrected: true,
    })
    assert.deepEqual(effectiveAdministration(base, []), {
      ...base,
      voided: false,
      corrected: false,
    })
    assert.equal(effectiveAdministration(base, [correction('a-1', 'void')]).voided, true)
    const skip = effectiveSkip({ reason: 'refused', note: null }, [
      correction('s-1', 'amend', {
        targetKind: 'skip',
        health: { reason: 'Gerekçe', skipReason: 'student_absent' },
      }),
      correction('s-1', 'amend', {
        targetKind: 'skip',
        health: { reason: 'Not', note: 'Raporlu' },
      }),
    ])
    assert.deepEqual(skip, {
      reason: 'student_absent',
      note: 'Raporlu',
      voided: false,
      corrected: true,
    })
    assert.equal(
      effectiveSkip({ reason: 'refused', note: null }, [
        correction('s-1', 'void', { targetKind: 'skip' }),
      ]).voided,
      true,
    )
  })

  test('DOM-FIN-152: uygulama iptali yalnız gerekçe; düzeltme an, uygulayan ve not', () => {
    assert.deepEqual(
      planAdministrationCorrection(
        current,
        administrationCorrectionSchema.parse({ kind: 'void', reason: 'Yanlış öğrenci' }),
        { now: NOW },
      ),
      {
        administeredAt: null,
        administeredByMembershipId: null,
        health: { reason: 'Yanlış öğrenci' },
        changed: ['voided'],
      },
    )
    assert.deepEqual(
      planAdministrationCorrection(
        current,
        amend({
          administeredAt: '2026-10-06T08:40:00Z',
          administeredByMembershipId: 'm-admin',
          note: 'Yemekten sonra',
        }),
        { now: NOW, administeredBy: staff },
      ),
      {
        administeredAt: '2026-10-06T08:40:00.000Z',
        administeredByMembershipId: 'm-admin',
        health: { reason: 'Saat yanlış girilmiş', note: 'Yemekten sonra' },
        changed: ['administeredAt', 'administeredByMembershipId', 'note'],
      },
    )
    assert.deepEqual(
      planAdministrationCorrection({ ...current, note: 'Eski not' }, amend({ note: '' }), {
        now: NOW,
      }).health,
      { reason: 'Saat yanlış girilmiş', note: null },
    )
  })

  test('DOM-FIN-152: iptal edilmiş kayıt 409; gelecek an, başka gün, değişmeyen ve personel olmayan 422', () => {
    rejects(
      () =>
        planAdministrationCorrection({ ...current, voided: true }, amend({ note: 'x' }), {
          now: NOW,
        }),
      'infirmary_dose_record_voided',
      'conflict',
    )
    rejects(
      () =>
        planAdministrationCorrection(current, amend({ administeredAt: '2026-10-06T09:30:00Z' }), {
          now: NOW,
        }),
      'infirmary_administration_in_future',
    )
    rejects(
      () =>
        planAdministrationCorrection(current, amend({ administeredAt: '2026-10-05T08:00:00Z' }), {
          now: NOW,
        }),
      'infirmary_correction_day_mismatch',
    )
    rejects(
      () =>
        planAdministrationCorrection(
          current,
          amend({ administeredAt: base.administeredAt, administeredByMembershipId: 'm-desk' }),
          { now: NOW },
        ),
      'infirmary_correction_unchanged',
    )
    rejects(
      () =>
        planAdministrationCorrection(current, amend({ administeredByMembershipId: 'm-x' }), {
          now: NOW,
          administeredBy: null,
        }),
      'infirmary_administered_by_not_found',
    )
    rejects(
      () =>
        planAdministrationCorrection(current, amend({ administeredByMembershipId: 'm-x' }), {
          now: NOW,
          administeredBy: { role: 'veli', active: true },
        }),
      'infirmary_administered_by_not_staff',
    )
    rejects(
      () =>
        planAdministrationCorrection(current, amend({ administeredByMembershipId: 'm-x' }), {
          now: NOW,
          administeredBy: { role: 'onburo', active: false },
        }),
      'infirmary_administered_by_inactive',
    )
  })

  test('DOM-FIN-152: atlama düzeltmesi; "diğer"de açıklama, değişiklik ve iptal kuralları', () => {
    const skip = { reason: 'refused' as const, note: null, voided: false }
    const parse = (value: Record<string, unknown>) =>
      skipCorrectionSchema.parse({ reason: 'Gerekçe düzeltildi', ...value })
    assert.deepEqual(planSkipCorrection(skip, parse({ kind: 'void' })), {
      health: { reason: 'Gerekçe düzeltildi' },
      changed: ['voided'],
    })
    assert.deepEqual(
      planSkipCorrection(skip, parse({ kind: 'amend', skipReason: 'student_absent' })),
      {
        health: { reason: 'Gerekçe düzeltildi', skipReason: 'student_absent' },
        changed: ['skipReason'],
      },
    )
    assert.deepEqual(
      planSkipCorrection(
        skip,
        parse({ kind: 'amend', skipReason: 'other', note: 'Mide bulantısı' }),
      ),
      {
        health: { reason: 'Gerekçe düzeltildi', skipReason: 'other', note: 'Mide bulantısı' },
        changed: ['skipReason', 'note'],
      },
    )
    rejects(
      () => planSkipCorrection(skip, parse({ kind: 'amend', skipReason: 'other' })),
      'infirmary_skip_note_required',
    )
    rejects(
      () => planSkipCorrection(skip, parse({ kind: 'amend', skipReason: 'refused' })),
      'infirmary_correction_unchanged',
    )
    rejects(
      () => planSkipCorrection({ ...skip, voided: true }, parse({ kind: 'amend', note: 'x' })),
      'infirmary_dose_record_voided',
      'conflict',
    )
  })
})
