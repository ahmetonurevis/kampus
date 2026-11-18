import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FINANCE_STAFF_CERTIFICATE_ROLES,
  planStaffCertificate,
  planStaffCertificateCancel,
  STAFF_CERTIFICATE_DEFAULT_ADDRESSEE,
  staffCertificateCancelSchema,
  staffCertificateInputSchema,
  staffCertificateLabel,
  staffCertificateParagraphs,
  staffCertificateServiceText,
  staffCertificateWageText,
  type StaffCertificateChecks,
  type StaffCertificateInput,
} from '../packages/school-core/src/lib/finance-staff-certificates.ts'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import { isDomainError } from './support/domain-error.ts'

// Personel çalışma ve hizmet belgesi (DOM-FIN-106; ON-175). Kararlar K-340…K-343.

const TODAY = '2026-10-06'
const TCKN = '10000000146'
const EMPLOYMENT: StaffCertificateInput = {
  kind: 'employment',
  membershipId: 'm-selin',
  position: 'İngilizce öğretmeni',
  hireDate: '2021-09-01',
}
const SERVICE: StaffCertificateInput = {
  kind: 'service',
  membershipId: 'm-ahmet',
  position: 'Ön büro görevlisi',
  hireDate: '2023-02-15',
  exitDate: '2026-06-30',
}
const checks = (overrides: Partial<StaffCertificateChecks> = {}): StaffCertificateChecks => ({
  staff: { name: 'Selin Kaya', role: 'ogretmen', active: true },
  wage: { rateType: 'monthly_gross', amountCents: 4_500_000 },
  today: TODAY,
  ...overrides,
})
const LEFT = { name: 'Ahmet Ayrılan', role: 'onburo', active: false }
const parse = (input: unknown) => staffCertificateInputSchema.parse(input)
const plan = (input: StaffCertificateInput, overrides: Partial<StaffCertificateChecks> = {}) =>
  planStaffCertificate(parse(input), checks(overrides))

test('DOM-FIN-106: belgeyi yalnız yönetici üretir (K-342)', () => {
  assert.deepEqual(FINANCE_STAFF_CERTIFICATE_ROLES, ['yonetici'])
})

test('DOM-FIN-106: belge numarası yıl ve sıradır (K-341)', () => {
  assert.equal(staffCertificateLabel({ certificateYear: 2026, certificateNumber: 7 }), 'PB-2026-7')
})

test('DOM-FIN-106: çalışma belgesi içeriği dondurulur; muhatap boşsa "İlgili makama", ücret istenmedikçe yok (K-340, K-341)', () => {
  const content = plan({ ...EMPLOYMENT, addressee: '  ', identityNumber: '' })
  assert.deepEqual(content, {
    kind: 'employment',
    staffName: 'Selin Kaya',
    position: 'İngilizce öğretmeni',
    identityNumber: null,
    hireDate: '2021-09-01',
    exitDate: null,
    addressee: STAFF_CERTIFICATE_DEFAULT_ADDRESSEE,
    wageRateType: null,
    wageAmountCents: null,
  })
})

test('DOM-FIN-106: ücret yalnız istenirse ve o gün ana ücret varsa yazılır (K-342)', () => {
  const content = plan({ ...EMPLOYMENT, includeWage: true, identityNumber: TCKN })
  assert.equal(content.wageRateType, 'monthly_gross')
  assert.equal(content.wageAmountCents, 4_500_000)
  assert.equal(content.identityNumber, TCKN)
  assert.equal(staffCertificateWageText(content), 'Aylık brüt 45.000,00 ₺')
  assert.throws(
    () => plan({ ...EMPLOYMENT, includeWage: true }, { wage: null }),
    isDomainError('staff_certificate_wage_missing'),
  )
  // Ücret istenmezse tanımın olmaması belgeyi engellemez.
  assert.equal(plan(EMPLOYMENT, { wage: null }).wageAmountCents, null)
})

test('DOM-FIN-106: hizmet belgesi ayrılan personele; giriş–çıkış ve hizmet süresi (K-340)', () => {
  const content = plan(
    { ...SERVICE, addressee: 'X Bankası Kadıköy Şubesi Müdürlüğüne' },
    {
      staff: LEFT,
    },
  )
  assert.equal(content.kind, 'service')
  assert.equal(content.exitDate, '2026-06-30')
  assert.equal(content.addressee, 'X Bankası Kadıköy Şubesi Müdürlüğüne')
  assert.equal(content.wageAmountCents, null)
  assert.equal(staffCertificateServiceText(content), '3 yıl 4 ay 16 gün')
  assert.equal(staffCertificateServiceText({ hireDate: '2026-01-01', exitDate: null }), null)
})

test('DOM-FIN-106: tür personelin durumuna uyar; olmayan ve personel olmayan üyelik reddedilir', () => {
  assert.throws(
    () => plan(EMPLOYMENT, { staff: LEFT }),
    isDomainError('staff_certificate_staff_inactive'),
  )
  assert.throws(() => plan(SERVICE), isDomainError('staff_certificate_staff_active'))
  assert.throws(
    () => plan(EMPLOYMENT, { staff: null }),
    isDomainError('staff_certificate_staff_not_found'),
  )
  assert.throws(
    () => plan(EMPLOYMENT, { staff: { name: 'Ayşe Yılmaz', role: 'veli', active: true } }),
    isDomainError('staff_certificate_not_staff'),
  )
})

test('DOM-FIN-106: giriş ve çıkış günü bugünden sonra olamaz; bugün olabilir', () => {
  assert.throws(
    () => plan({ ...EMPLOYMENT, hireDate: '2026-10-07' }),
    isDomainError('staff_certificate_hire_date_future'),
  )
  assert.equal(plan({ ...EMPLOYMENT, hireDate: TODAY }).hireDate, TODAY)
  assert.throws(
    () => plan({ ...SERVICE, exitDate: '2026-10-07' }, { staff: LEFT }),
    isDomainError('staff_certificate_exit_date_future'),
  )
  assert.equal(plan({ ...SERVICE, exitDate: TODAY }, { staff: LEFT }).exitDate, TODAY)
})

test('DOM-FIN-106: geçersiz gövde şemada reddedilir', () => {
  for (const bad of [
    { ...EMPLOYMENT, position: 'x' },
    { ...EMPLOYMENT, position: 'x'.repeat(121) },
    { ...EMPLOYMENT, hireDate: '2026-02-30' },
    { ...EMPLOYMENT, identityNumber: '12345678901' },
    { ...EMPLOYMENT, addressee: 'x'.repeat(201) },
    { ...EMPLOYMENT, exitDate: '2026-01-01' },
    { ...SERVICE, includeWage: true },
    { ...SERVICE, exitDate: '2023-02-14' },
    { ...EMPLOYMENT, kind: 'reference' },
    { ...EMPLOYMENT, institutionId: 'b' },
  ])
    assert.equal(staffCertificateInputSchema.safeParse(bad).success, false, JSON.stringify(bad))
  const issue = staffCertificateInputSchema.safeParse({ ...SERVICE, exitDate: '2023-02-14' })
  assert.deepEqual(issue.error?.issues[0]?.path, ['exitDate'])
  // Giriş ve çıkış aynı gün olabilir.
  assert.equal(
    staffCertificateInputSchema.safeParse({ ...SERVICE, exitDate: SERVICE.hireDate }).success,
    true,
  )
})

test('DOM-FIN-106: iptal gerekçe ister; iptal edilmiş belge yeniden iptal edilmez (K-341)', () => {
  assert.deepEqual(
    planStaffCertificateCancel({ cancelledAt: null }, { reason: ' Yanlış görev ' }),
    {
      reason: 'Yanlış görev',
    },
  )
  assert.equal(staffCertificateCancelSchema.safeParse({ reason: 'kısa' }).success, false)
  assert.throws(() => planStaffCertificateCancel({ cancelledAt: null }, { reason: 'kısa' }))
  assert.throws(
    () =>
      planStaffCertificateCancel(
        { cancelledAt: '2026-10-06T10:00:00.000Z' },
        {
          reason: 'Yanlış görev',
        },
      ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === 'staff_certificate_cancelled' &&
      error.kind === 'conflict',
  )
})

test('DOM-FIN-106: belge metni çalışma ve hizmet belgesinde farklıdır; md. 28 ibaresi hizmettedir', () => {
  const institutionName = 'Akademi Özel Okulları'
  const employment = staffCertificateParagraphs({
    ...plan({ ...EMPLOYMENT, includeWage: true, identityNumber: TCKN }),
    institutionName,
  })
  assert.deepEqual(employment, [
    `Selin Kaya (T.C. kimlik no ${TCKN}), 1 Eyl 2021 tarihinden bu yana Akademi Özel Okulları bünyesinde İngilizce öğretmeni olarak çalışmaktadır.`,
    'Düzenleme günü itibarıyla ücreti: Aylık brüt 45.000,00 ₺.',
    'İşbu belge ilgilinin talebi üzerine düzenlenmiştir.',
  ])
  const service = staffCertificateParagraphs({
    ...plan(SERVICE, { staff: LEFT }),
    institutionName,
  })
  assert.equal(
    service[0],
    'Ahmet Ayrılan, 15 Şub 2023 – 30 Haz 2026 tarihleri arasında Akademi Özel Okulları bünyesinde Ön büro görevlisi olarak çalışmıştır.',
  )
  assert.equal(service[1], 'Hizmet süresi: 3 yıl 4 ay 16 gün.')
  assert.match(service[2] ?? '', /4857 sayılı İş Kanunu md\. 28/)
  assert.equal(employment.join(' ').includes('md. 28'), false)
})
