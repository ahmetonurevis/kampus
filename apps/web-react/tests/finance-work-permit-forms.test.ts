import assert from 'node:assert/strict'
import test from 'node:test'

import type {
  WorkPermit,
  WorkPermitTeacher,
} from '@kampus/react-shared/use-finance-work-permits.ts'

import {
  approveBody,
  approveDefaults,
  approveFormField,
  approveFormSchema,
  currentPermitText,
  openApplicationText,
  permitBody,
  permitDatesText,
  permitDefaults,
  permitFormSchema,
  permitTitle,
  teacherStatusText,
  validityText,
} from '../src/pages/finance/finance-work-permit-forms.ts'

// Çalışma onayı formu ve gösterimi (DOM-FIN-114; ON-174).

const permit = (overrides: Partial<WorkPermit> = {}): WorkPermit => ({
  id: 'p1',
  teacher: { membershipId: 'm1', name: 'Selin Kaya' },
  permitType: 'initial',
  branch: 'İngilizce',
  status: 'approved',
  state: 'approved',
  applicationDate: '2026-09-15',
  approvalDate: '2026-10-01',
  approvalNumber: 'E-1234',
  validUntil: '2027-08-31',
  rejectionDate: null,
  documentFileId: null,
  note: null,
  createdAt: '2026-09-15T09:00:00.000Z',
  version: 3,
  ...overrides,
})
const teacher = (overrides: Partial<WorkPermitTeacher> = {}): WorkPermitTeacher => ({
  membershipId: 'm1',
  name: 'Selin Kaya',
  status: 'missing',
  daysLeft: null,
  current: null,
  openApplication: null,
  teaching: false,
  warning: false,
  ...overrides,
})

test('DOM-FIN-114: yeni kayıt gövdesi boş başvuru gününü ve notu null yapar, branşı kırpar', () => {
  const values = permitFormSchema.parse({ ...permitDefaults('İngilizce'), note: '  ' })
  assert.deepEqual(permitBody('m1', values), {
    membershipId: 'm1',
    permitType: 'initial',
    branch: 'İngilizce',
    applicationDate: null,
    note: null,
  })
  assert.equal(
    permitBody('m1', { ...values, applicationDate: '2026-09-15', note: ' Ek ' }).applicationDate,
    '2026-09-15',
  )
  assert.equal(permitFormSchema.safeParse({ ...values, branch: 'A' }).success, false)
  assert.equal(
    permitFormSchema.safeParse({ ...values, applicationDate: '15.09.2026' }).success,
    false,
  )
})

test('DOM-FIN-114: K-376 onay gövdesi: varsayılan bitiş gönderilmez, süresiz null, gün olduğu gibi', () => {
  const values = { ...approveDefaults('2026-10-06'), approvalNumber: ' E-1 ' }
  assert.deepEqual(approveBody(values, null), {
    approvalDate: '2026-10-06',
    approvalNumber: 'E-1',
    documentFileId: null,
  })
  assert.deepEqual(approveBody({ ...values, validityMode: 'unlimited' }, 'f1'), {
    approvalDate: '2026-10-06',
    approvalNumber: 'E-1',
    validUntil: null,
    documentFileId: 'f1',
  })
  assert.equal(
    approveBody({ ...values, validityMode: 'date', validUntil: '2027-06-30' }, null).validUntil,
    '2027-06-30',
  )
  assert.equal(approveFormSchema.safeParse(values).success, true)
  assert.equal(approveFormSchema.safeParse({ ...values, approvalNumber: '' }).success, false)
  assert.equal(
    approveFormSchema.safeParse({ ...values, validityMode: 'date', validUntil: '' }).success,
    false,
  )
  assert.equal(
    approveFormSchema.safeParse({ ...values, validityMode: 'date', validUntil: '2026-10-05' })
      .success,
    false,
  )
  assert.equal(approveFormField('validUntil'), 'validUntil')
  assert.equal(approveFormField('documentFileId'), null)
})

test('DOM-FIN-114: kayıt gösterimi: başlık, tarih özeti ve geçerlilik', () => {
  assert.equal(
    permitTitle(permit({ permitType: 'branch_change' })),
    'Branş değişikliği · İngilizce',
  )
  assert.equal(validityText(null), 'süresiz')
  assert.equal(
    permitDatesText(permit()),
    'Başvuru 15 Eyl 2026 · onay 1 Eki 2026 (sayı E-1234), 31 Ağu 2027 tarihine kadar',
  )
  assert.equal(
    permitDatesText(
      permit({
        status: 'rejected',
        approvalDate: null,
        approvalNumber: null,
        validUntil: null,
        rejectionDate: '2026-09-30',
      }),
    ),
    'Başvuru 15 Eyl 2026 · ret 30 Eyl 2026',
  )
  assert.equal(
    permitDatesText(permit({ applicationDate: null, approvalDate: null, validUntil: null })),
    'Başvuru yapılmadı',
  )
})

test('DOM-FIN-114: K-376 takip satırı: durum ve kalan gün, geçerli onay, süren başvuru', () => {
  assert.equal(teacherStatusText(teacher()), 'Onay yok')
  assert.equal(
    teacherStatusText(teacher({ status: 'expiring', daysLeft: 12 })),
    'Süresi dolmak üzere (12 gün)',
  )
  assert.equal(
    teacherStatusText(teacher({ status: 'expired', daysLeft: -3 })),
    'Süresi doldu (3 gün önce)',
  )
  assert.equal(teacherStatusText(teacher({ status: 'valid', daysLeft: 200 })), 'Geçerli')
  assert.equal(currentPermitText(teacher()), '—')
  assert.equal(
    currentPermitText(
      teacher({
        current: {
          id: 'p1',
          permitType: 'renewal',
          branch: 'Matematik',
          approvalDate: '2026-10-01',
          validUntil: null,
        },
      }),
    ),
    'Yenileme · Matematik, süresiz',
  )
  assert.equal(openApplicationText(teacher()), '—')
  assert.equal(
    openApplicationText(
      teacher({
        openApplication: {
          id: 'p2',
          permitType: 'initial',
          status: 'applied',
          applicationDate: '2026-09-15',
        },
      }),
    ),
    'Başvuruldu (15 Eyl 2026)',
  )
  assert.equal(
    openApplicationText(
      teacher({
        openApplication: {
          id: 'p2',
          permitType: 'initial',
          status: 'preparing',
          applicationDate: null,
        },
      }),
    ),
    'Hazırlanıyor',
  )
})
