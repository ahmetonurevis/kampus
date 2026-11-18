import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addDayCount,
  daysBetween,
  defaultWorkPermitValidUntil,
  isUnapprovedTeaching,
  needsAttention,
  planWorkPermit,
  planWorkPermitApply,
  planWorkPermitApprove,
  planWorkPermitReject,
  planWorkPermitUpdate,
  teacherPermitSummary,
  workPermitApproveSchema,
  workPermitCancelSchema,
  workPermitInputSchema,
  workPermitRejectSchema,
  workPermitState,
  workPermitUpdateSchema,
  type WorkPermitChecks,
  type WorkPermitCurrent,
  type WorkPermitDates,
} from '../packages/school-core/src/lib/finance-work-permits.ts'

import { isDomainError } from './support/domain-error.ts'

// Öğretmen çalışma onayı takibi (DOM-FIN-114; ON-174). Kararlar K-375…K-377.

const TODAY = '2026-10-06'
const TEACHER: WorkPermitChecks = { teacher: { role: 'ogretmen', active: true }, permits: [] }
const input = (overrides: Record<string, unknown> = {}) =>
  workPermitInputSchema.parse({
    membershipId: 'm-selin',
    permitType: 'initial',
    branch: ' İngilizce ',
    ...overrides,
  })
const current = (overrides: Partial<WorkPermitCurrent> = {}): WorkPermitCurrent => ({
  status: 'applied',
  permitType: 'initial',
  branch: 'İngilizce',
  applicationDate: '2026-09-10',
  approvalDate: null,
  note: null,
  documentFileId: null,
  ...overrides,
})
const approved = (validUntil: string | null, approvalDate = '2025-09-15'): WorkPermitDates => ({
  status: 'approved',
  approvalDate,
  validUntil,
})
const NO_YEARS: readonly { startDate: string; endDate: string }[] = []

test('DOM-FIN-114: giriş şeması branşı kırpar, başvuru günü ve not varsayılan boştur', () => {
  const data = input()
  assert.equal(data.branch, 'İngilizce')
  assert.equal(data.applicationDate, null)
  assert.equal(data.note, null)
  assert.equal(input({ note: '  ' }).note, null)
  assert.equal(workPermitInputSchema.safeParse({ ...data, branch: 'A' }).success, false)
  assert.equal(workPermitInputSchema.safeParse({ ...data, permitType: 'other' }).success, false)
  assert.equal(workPermitInputSchema.safeParse({ ...data, institutionId: 'x' }).success, false)
  assert.equal(
    workPermitInputSchema.safeParse({ ...data, applicationDate: '2026-02-30' }).success,
    false,
  )
})

test('DOM-FIN-114: düzeltme en az bir alan ister; onay, ret ve iptal şemaları sınırları denetler', () => {
  assert.equal(workPermitUpdateSchema.safeParse({}).success, false)
  assert.equal(workPermitUpdateSchema.safeParse({ documentFileId: null }).success, true)
  assert.equal(workPermitUpdateSchema.safeParse({ documentFileId: 'abc' }).success, false)
  const approve = workPermitApproveSchema.parse({
    approvalDate: '2026-10-01',
    approvalNumber: ' 12345678-903.02-E.1 ',
  })
  assert.equal(approve.approvalNumber, '12345678-903.02-E.1')
  assert.equal(approve.validUntil, undefined)
  assert.equal(approve.documentFileId, null)
  assert.equal(
    workPermitApproveSchema.safeParse({ approvalDate: '2026-10-01', approvalNumber: '' }).success,
    false,
  )
  assert.equal(
    workPermitApproveSchema.safeParse({
      approvalDate: '2026-10-01',
      approvalNumber: 'x'.repeat(61),
    }).success,
    false,
  )
  assert.equal(
    workPermitRejectSchema.safeParse({ decisionDate: '2026-10-01', reason: 'Kısa' }).success,
    false,
  )
  assert.equal(workPermitCancelSchema.safeParse({ reason: 'x'.repeat(501) }).success, false)
  assert.equal(workPermitCancelSchema.safeParse({ reason: 'Yanlış öğretmen' }).success, true)
})

test('DOM-FIN-114: K-376 varsayılan bitiş onay gününün eğitim yılı sonu; yaz onayı yeni yılın sonu', () => {
  assert.equal(defaultWorkPermitValidUntil('2026-10-01', NO_YEARS), '2027-08-31')
  assert.equal(defaultWorkPermitValidUntil('2027-03-15', NO_YEARS), '2027-08-31')
  // Yıl bitişine 60 günden az: 2 Temmuz → 31 Ağustos 60 gün, 3 Temmuz 59 gün.
  assert.equal(defaultWorkPermitValidUntil('2027-07-02', NO_YEARS), '2027-08-31')
  assert.equal(defaultWorkPermitValidUntil('2027-07-03', NO_YEARS), '2028-08-31')
  // Kurumun yıl kaydı varsayılan aralığa üstün gelir (sonraki yıl için de).
  const years = [
    { startDate: '2026-09-14', endDate: '2027-06-30' },
    { startDate: '2027-09-13', endDate: '2028-06-30' },
  ]
  assert.equal(defaultWorkPermitValidUntil('2026-10-01', years), '2027-06-30')
  assert.equal(defaultWorkPermitValidUntil('2027-06-01', years), '2028-06-30')
  // Kayıtlı yıllar arasındaki yaz boşluğu sonraki kayıtlı yıla aittir.
  assert.equal(defaultWorkPermitValidUntil('2027-07-01', years), '2028-06-30')
  assert.equal(defaultWorkPermitValidUntil('2027-08-01', years), '2028-06-30')
  // Kaydı olmayan sonraki yıl varsayılan aralıktır.
  assert.equal(defaultWorkPermitValidUntil('2028-06-15', years), '2029-08-31')
})

test('DOM-FIN-114: gün yardımcıları', () => {
  assert.equal(daysBetween('2026-10-06', '2026-11-05'), 30)
  assert.equal(daysBetween('2026-10-06', '2026-10-05'), -1)
  assert.equal(addDayCount('2026-12-31', 1), '2027-01-01')
  assert.equal(addDayCount('2026-03-01', -1), '2026-02-28')
})

test('DOM-FIN-114: K-376 süresi doldu saklanmaz, onaylı kayıtta bitişe göre hesaplanır', () => {
  assert.equal(workPermitState(approved('2026-10-05'), TODAY), 'expired')
  assert.equal(workPermitState(approved('2026-10-06'), TODAY), 'approved')
  assert.equal(workPermitState(approved(null), TODAY), 'approved')
  assert.equal(
    workPermitState({ status: 'applied', approvalDate: null, validUntil: null }, TODAY),
    'applied',
  )
  assert.equal(
    workPermitState({ status: 'rejected', approvalDate: null, validUntil: '2020-01-01' }, TODAY),
    'rejected',
  )
})

test('DOM-FIN-114: K-376 öğretmen özeti: onay yok, geçerli, dolmak üzere, süresi doldu', () => {
  assert.deepEqual(teacherPermitSummary([], TODAY), {
    status: 'missing',
    current: null,
    openApplication: null,
    daysLeft: null,
  })
  const rejected: WorkPermitDates = { status: 'rejected', approvalDate: null, validUntil: null }
  assert.equal(teacherPermitSummary([rejected], TODAY).status, 'missing')
  assert.equal(teacherPermitSummary([approved('2026-12-31')], TODAY).status, 'valid')
  const expiring = teacherPermitSummary([approved('2026-11-05')], TODAY)
  assert.equal(expiring.status, 'expiring')
  assert.equal(expiring.daysLeft, 30)
  assert.equal(teacherPermitSummary([approved('2026-11-06')], TODAY).status, 'valid')
  assert.equal(teacherPermitSummary([approved(TODAY)], TODAY).status, 'expiring')
  const expired = teacherPermitSummary([approved('2026-08-31')], TODAY)
  assert.equal(expired.status, 'expired')
  assert.equal(expired.daysLeft, -36)
  const open: WorkPermitDates = { status: 'applied', approvalDate: null, validUntil: null }
  const renewing = teacherPermitSummary([approved('2026-08-31'), open], TODAY)
  assert.equal(renewing.status, 'expired')
  assert.equal(renewing.openApplication, open)
})

test('DOM-FIN-114: K-376 geçerli onay bitişi en geç olandır; süresiz en geç, eşitlikte son onay', () => {
  const old = approved('2026-08-31', '2025-09-01')
  const later = approved('2027-08-31', '2026-09-01')
  const open = approved(null, '2024-09-01')
  assert.equal(teacherPermitSummary([later, old], TODAY).current, later)
  assert.equal(teacherPermitSummary([old, later, open], TODAY).current, open)
  assert.equal(teacherPermitSummary([open], TODAY).daysLeft, null)
  const same = approved('2027-08-31', '2026-09-20')
  assert.equal(teacherPermitSummary([later, same], TODAY).current, same)
  assert.equal(teacherPermitSummary([same, later], TODAY).current, same)
})

test('DOM-FIN-114: K-376 uyarı: programda görevli ve onayı yok ya da süresi dolmuş', () => {
  assert.equal(isUnapprovedTeaching('missing', true), true)
  assert.equal(isUnapprovedTeaching('expired', true), true)
  assert.equal(isUnapprovedTeaching('expiring', true), false)
  assert.equal(isUnapprovedTeaching('missing', false), false)
  assert.equal(needsAttention('valid'), false)
  assert.equal(needsAttention('expiring'), true)
  assert.equal(needsAttention('missing'), true)
})

test('DOM-FIN-114: K-375 yeni kayıt: başvuru günü varsa başvuruldu, yoksa hazırlanıyor', () => {
  assert.equal(planWorkPermit(input(), TEACHER, TODAY), 'preparing')
  assert.equal(planWorkPermit(input({ applicationDate: TODAY }), TEACHER, TODAY), 'applied')
  assert.throws(
    () => planWorkPermit(input({ applicationDate: '2026-10-07' }), TEACHER, TODAY),
    isDomainError('work_permit_date_in_future'),
  )
})

test('DOM-FIN-114: K-375 yalnız kurumun etkin öğretmenine; açık başvuru varken yenisi açılmaz', () => {
  assert.throws(
    () => planWorkPermit(input(), { teacher: null, permits: [] }, TODAY),
    isDomainError('work_permit_teacher_not_found'),
  )
  for (const role of ['yonetici', 'onburo', 'veli', 'ogrenci'])
    assert.throws(
      () => planWorkPermit(input(), { teacher: { role, active: true }, permits: [] }, TODAY),
      isDomainError('work_permit_not_teacher'),
    )
  assert.throws(
    () =>
      planWorkPermit(input(), { teacher: { role: 'ogretmen', active: false }, permits: [] }, TODAY),
    isDomainError('work_permit_teacher_inactive'),
  )
  for (const status of ['preparing', 'applied'] as const)
    assert.throws(
      () => planWorkPermit(input(), { ...TEACHER, permits: [{ status }] }, TODAY),
      isDomainError('work_permit_open_exists'),
    )
  assert.equal(
    planWorkPermit(input(), { ...TEACHER, permits: [{ status: 'rejected' }] }, TODAY),
    'preparing',
  )
})

test('DOM-FIN-114: K-375 yenileme ve branş değişikliği önceki onayı ister', () => {
  for (const permitType of ['renewal', 'branch_change']) {
    assert.throws(
      () =>
        planWorkPermit(
          input({ permitType }),
          { ...TEACHER, permits: [{ status: 'rejected' }] },
          TODAY,
        ),
      isDomainError('work_permit_no_prior_approval'),
    )
    assert.equal(
      planWorkPermit(
        input({ permitType }),
        { ...TEACHER, permits: [{ status: 'approved' }] },
        TODAY,
      ),
      'preparing',
    )
  }
})

test('DOM-FIN-114: K-375 düzeltme: açık kayıtta alanlar, sonuçlanmışta yalnız not ve belge', () => {
  assert.deepEqual(
    planWorkPermitUpdate(current(), { branch: 'Almanca', note: 'Ek' }, TODAY).sort(),
    ['branch', 'note'],
  )
  assert.deepEqual(planWorkPermitUpdate(current(), { applicationDate: '2026-09-12' }, TODAY), [
    'applicationDate',
  ])
  for (const status of ['approved', 'rejected'] as const) {
    assert.throws(
      () => planWorkPermitUpdate(current({ status }), { branch: 'Almanca' }, TODAY),
      isDomainError('work_permit_decided'),
    )
    assert.deepEqual(
      planWorkPermitUpdate(current({ status }), { documentFileId: 'f-1', note: null }, TODAY),
      ['documentFileId'],
    )
  }
  // Aynı değer değişiklik sayılmaz.
  assert.throws(
    () => planWorkPermitUpdate(current(), { branch: 'İngilizce' }, TODAY),
    isDomainError('work_permit_unchanged'),
  )
  assert.throws(
    () =>
      planWorkPermitUpdate(
        current({ status: 'preparing', applicationDate: null }),
        { applicationDate: '2026-09-12' },
        TODAY,
      ),
    isDomainError('work_permit_not_applied'),
  )
  assert.throws(
    () => planWorkPermitUpdate(current(), { applicationDate: '2026-10-07' }, TODAY),
    isDomainError('work_permit_date_in_future'),
  )
})

test('DOM-FIN-114: K-375 başvuru işareti yalnız hazırlanan kayıtta, gelecek gün olmaz', () => {
  const preparing = current({ status: 'preparing', applicationDate: null })
  planWorkPermitApply(preparing, { applicationDate: TODAY }, TODAY)
  assert.throws(
    () => planWorkPermitApply(current(), { applicationDate: TODAY }, TODAY),
    isDomainError('work_permit_not_preparing'),
  )
  assert.throws(
    () => planWorkPermitApply(preparing, { applicationDate: '2026-10-07' }, TODAY),
    isDomainError('work_permit_date_in_future'),
  )
})

test('DOM-FIN-114: K-376 onay: varsayılan bitiş, süresiz ve verilen bitiş; tarih sırası denetlenir', () => {
  const fallback = (day: string) => defaultWorkPermitValidUntil(day, NO_YEARS)
  const approve = (overrides: Record<string, unknown> = {}) =>
    workPermitApproveSchema.parse({
      approvalDate: '2026-10-01',
      approvalNumber: 'E-1',
      ...overrides,
    })
  assert.deepEqual(planWorkPermitApprove(current(), approve(), TODAY, fallback), {
    validUntil: '2027-08-31',
  })
  assert.deepEqual(
    planWorkPermitApprove(current(), approve({ validUntil: null }), TODAY, fallback),
    { validUntil: null },
  )
  assert.deepEqual(
    planWorkPermitApprove(current(), approve({ validUntil: '2026-10-01' }), TODAY, fallback),
    { validUntil: '2026-10-01' },
  )
  assert.throws(
    () => planWorkPermitApprove(current(), approve({ validUntil: '2026-09-30' }), TODAY, fallback),
    isDomainError('work_permit_valid_until_before_approval'),
  )
  assert.throws(
    () =>
      planWorkPermitApprove(current(), approve({ approvalDate: '2026-09-09' }), TODAY, fallback),
    isDomainError('work_permit_decision_before_application'),
  )
  assert.throws(
    () =>
      planWorkPermitApprove(current(), approve({ approvalDate: '2026-10-07' }), TODAY, fallback),
    isDomainError('work_permit_date_in_future'),
  )
  for (const status of ['preparing', 'approved', 'rejected'] as const)
    assert.throws(
      () => planWorkPermitApprove(current({ status }), approve(), TODAY, fallback),
      isDomainError('work_permit_not_applied'),
    )
})

test('DOM-FIN-114: K-375 ret yalnız başvurulmuş kayıtta; ret günü başvurudan önce olamaz', () => {
  const reject = { decisionDate: '2026-09-20', reason: 'Diploma denkliği eksik' }
  planWorkPermitReject(current(), reject, TODAY)
  assert.throws(
    () => planWorkPermitReject(current(), { ...reject, decisionDate: '2026-09-01' }, TODAY),
    isDomainError('work_permit_decision_before_application'),
  )
  assert.throws(
    () => planWorkPermitReject(current({ status: 'approved' }), reject, TODAY),
    isDomainError('work_permit_not_applied'),
  )
  // Başvuru günü bilinmeyen eski kayıtta yalnız gelecek gün denetlenir.
  planWorkPermitReject(current({ applicationDate: null }), reject, TODAY)
})
