import test from 'node:test'
import assert from 'node:assert/strict'
import { FILE_PURPOSES } from '../packages/school-core/src/content/taxonomy.ts'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import {
  ABSENCE_APPROVAL_LABELS,
  ABSENCE_DOCUMENT_LIMIT,
  ABSENCE_EXCUSED_LABEL,
  ABSENCE_NOTICED_LABEL,
  ABSENCE_REJECTED_LABEL,
  absenceApprovalStatus,
  approveAbsence,
  attachAbsenceDocuments,
  attendanceExcuse,
  notifyAbsence,
  rejectAbsence,
  type AbsenceFile,
} from '../packages/school-core/src/lib/requests.ts'
import { visibleRecords } from '../packages/school-core/src/lib/scope.ts'
import { isDomainError } from './support/domain-error.ts'

// IST-072, DOM-ILT-053: özür belgesi ve idare onayı. 2026-10-06 salıdır; Deniz (s1) 7-A
// (ortaokul, belge süresi 3 iş günü). 7-A'nın sınıf rehber öğretmeni Selin Kaya (t1).
const now = '2026-10-06T10:00:00.000Z'
let sequence = 0
const id = (prefix: string) => `${prefix}-absence-approval-${++sequence}`

const parent: Participant = {
  role: 'veli',
  links: [
    { kind: 'child', recordId: 's1' },
    { kind: 'child', recordId: 's2' },
  ],
  userId: 'u-ayse',
}
const otherParent: Participant = {
  role: 'veli',
  links: [{ kind: 'child', recordId: 's3' }],
  userId: 'u-parent-s3',
}
const admin: Participant = { role: 'yonetici', links: [], userId: 'u-admin' }
const homeroom: Participant = {
  role: 'ogretmen',
  links: [{ kind: 'teacher', recordId: 't1' }],
  userId: 'u-t1',
}
const student: Participant = {
  role: 'ogrenci',
  links: [{ kind: 'student', recordId: 's1' }],
  userId: 'u-s1',
}
const frontOffice: Participant = { role: 'onburo', links: [], userId: 'u-front' }

const file = (fileId: string, overrides: Partial<AbsenceFile> = {}): AbsenceFile => ({
  id: fileId,
  purpose: 'absence_document',
  contentType: 'application/pdf',
  byteSize: 200_000,
  ...overrides,
})
const absence = (overrides: Record<string, unknown> = {}) => ({
  studentId: 's1',
  startDate: '2026-10-08',
  endDate: '2026-10-09',
  reasonCategory: 'health',
  ...overrides,
})
const zodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

function unchangedOnFailure(state: State, action: () => unknown, check: (e: unknown) => boolean) {
  const before = JSON.stringify(state.absences)
  assert.throws(action, check)
  assert.equal(JSON.stringify(state.absences), before)
}

function setup() {
  const state = createSeed(new Date(now))
  const notice = notifyAbsence(state, parent, absence(), id, now)
  return { state, notice }
}

test('DOM-ILT-053: özür belgesi amacı PDF, JPEG ve PNG kabul eder; bildirim başına en çok 3', () => {
  const rule = FILE_PURPOSES.absence_document
  assert.deepEqual([...rule.mimeTypes], ['application/pdf', 'image/jpeg', 'image/png'])
  assert.equal(rule.maxBytes, 10 * 1024 * 1024)
  assert.equal(ABSENCE_DOCUMENT_LIMIT, 3)
})

test('DOM-ILT-053, IST-072: veli bildirimi belgeyle yapar; bildirim onay bekler, kayda yalnız kimlik girer', () => {
  const state = createSeed(new Date(now))
  const notice = notifyAbsence(state, parent, absence({ fileIds: ['f1', 'f2'] }), id, now, {
    files: [file('f1'), file('f2', { contentType: 'image/png' })],
  })
  assert.deepEqual(notice.fileIds, ['f1', 'f2'])
  assert.equal(notice.approvalStatus, 'pending')
  assert.equal(absenceApprovalStatus(notice), 'pending')
  assert.equal(JSON.stringify(notice).includes('pdf'), false)
})

test('DOM-ILT-053: belge sayısı, varlığı, amacı, türü ve boyutu denetlenir; hiçbir kayıt açılmaz', () => {
  const state = createSeed(new Date(now))
  const four = ['f1', 'f2', 'f3', 'f4']
  const cases: [Record<string, unknown>, AbsenceFile[], string][] = [
    [{ fileIds: four }, four.map((f) => file(f)), 'absence_document_limit'],
    [{ fileIds: ['f-yok'] }, [], 'absence_document_unavailable'],
    [{ fileIds: ['f1'] }, [file('f1', { purpose: 'submission' })], 'absence_document_purpose'],
    [{ fileIds: ['f1'] }, [file('f1', { contentType: 'image/webp' })], 'file_type_not_allowed'],
    [{ fileIds: ['f1'] }, [file('f1', { byteSize: 11 * 1024 * 1024 })], 'file_too_large'],
  ]
  for (const [input, files, code] of cases)
    unchangedOnFailure(
      state,
      () => notifyAbsence(state, parent, absence(input), id, now, { files }),
      isDomainError(code),
    )
  assert.equal(state.absences.length, 0)
})

test('DOM-ILT-053: veli belgeyi sonradan, karar verilmeden ve belge süresi içinde ekler', () => {
  const { state, notice } = setup()
  attachAbsenceDocuments(state, parent, notice.id, { fileIds: ['f1'] }, now, {
    files: [file('f1')],
  })
  attachAbsenceDocuments(state, parent, notice.id, { fileIds: ['f2', 'f3'] }, now, {
    files: [file('f2'), file('f3')],
  })
  assert.deepEqual(state.absences[0]?.fileIds, ['f1', 'f2', 'f3'])
  // Dördüncü belge sınırı aşar; aynı belge ikinci kez eklenmez.
  unchangedOnFailure(
    state,
    () =>
      attachAbsenceDocuments(state, parent, notice.id, { fileIds: ['f4'] }, now, {
        files: [file('f4')],
      }),
    isDomainError('absence_document_limit'),
  )
  unchangedOnFailure(
    state,
    () =>
      attachAbsenceDocuments(state, parent, notice.id, { fileIds: ['f1'] }, now, {
        files: [file('f1')],
      }),
    isDomainError('absence_document_duplicate', 'conflict'),
  )
  unchangedOnFailure(
    state,
    () => attachAbsenceDocuments(state, parent, notice.id, { fileIds: [] }, now),
    zodError,
  )
})

test('DOM-ILT-053: belge süresi geçen, kararı verilmiş ve kapsam dışı bildirime belge eklenmez', () => {
  const { state, notice } = setup()
  const files = [file('f1')]
  // 9 Ekim cuma bitişi + 3 iş günü = 14 Ekim çarşamba; 15 Ekim geç.
  unchangedOnFailure(
    state,
    () =>
      attachAbsenceDocuments(
        state,
        parent,
        notice.id,
        { fileIds: ['f1'] },
        '2026-10-15T09:00:00.000Z',
        { files },
      ),
    isDomainError('absence_document_late'),
  )
  attachAbsenceDocuments(
    state,
    parent,
    notice.id,
    { fileIds: ['f1'] },
    '2026-10-14T09:00:00.000Z',
    {
      files,
    },
  )
  unchangedOnFailure(
    state,
    () =>
      attachAbsenceDocuments(state, otherParent, notice.id, { fileIds: ['f2'] }, now, {
        files: [file('f2')],
      }),
    isDomainError('absence_not_found', 'not_found'),
  )
  unchangedOnFailure(
    state,
    () =>
      attachAbsenceDocuments(state, parent, 'absence-yok', { fileIds: ['f2'] }, now, {
        files: [file('f2')],
      }),
    isDomainError('absence_not_found', 'not_found'),
  )
  for (const by of [admin, homeroom, student])
    unchangedOnFailure(
      state,
      () => attachAbsenceDocuments(state, by, notice.id, { fileIds: ['f2'] }, now),
      isDomainError('permission_denied', 'forbidden'),
    )
  approveAbsence(state, admin, notice.id, {}, now)
  unchangedOnFailure(
    state,
    () =>
      attachAbsenceDocuments(state, parent, notice.id, { fileIds: ['f2'] }, now, {
        files: [file('f2')],
      }),
    isDomainError('absence_already_decided', 'conflict'),
  )
})

test('DOM-ILT-053: yönetici onaylar; günler yoklamada özürlü sayılır, yoklama kaydı değişmez', () => {
  const { state, notice } = setup()
  const attendance = JSON.stringify(state.attendance)
  const excuse = () => attendanceExcuse(state.absences)('s1', '2026-10-08')
  assert.deepEqual(excuse(), {
    absenceId: notice.id,
    status: 'pending',
    excused: false,
    label: ABSENCE_NOTICED_LABEL,
  })
  const later = '2026-10-07T08:00:00.000Z'
  approveAbsence(state, admin, notice.id, {}, later)
  const saved = state.absences[0]
  assert.equal(saved?.approvalStatus, 'approved')
  assert.equal(saved?.status, ABSENCE_APPROVAL_LABELS.approved)
  assert.equal(saved?.decidedAt, later)
  assert.deepEqual(saved?.decidedBy, { role: 'yonetici', userId: 'u-admin' })
  assert.deepEqual(excuse(), {
    absenceId: notice.id,
    status: 'approved',
    excused: true,
    label: ABSENCE_EXCUSED_LABEL,
  })
  assert.equal(attendanceExcuse(state.absences)('s1', '2026-10-10'), null)
  assert.equal(JSON.stringify(state.attendance), attendance)
})

test('DOM-ILT-053: yönetici gerekçeyle reddeder; gerekçe kayda yazılmaz, günler özürsüz kalır', () => {
  const { state, notice } = setup()
  for (const input of [{}, { reason: ' ' }, { reason: 'x'.repeat(501) }])
    unchangedOnFailure(state, () => rejectAbsence(state, admin, notice.id, input, now), zodError)
  rejectAbsence(state, admin, notice.id, { reason: 'Belge okunamıyor.' }, now)
  const saved = state.absences[0]
  assert.equal(saved?.approvalStatus, 'rejected')
  assert.equal(saved?.status, ABSENCE_APPROVAL_LABELS.rejected)
  assert.equal(JSON.stringify(saved).includes('okunamıyor'), false)
  const excuse = attendanceExcuse(state.absences)('s1', '2026-10-09')
  assert.equal(excuse?.excused, false)
  assert.equal(excuse?.label, ABSENCE_REJECTED_LABEL)
})

test('DOM-ILT-053: karar bir kez verilir; mükerrer onay ve red 409', () => {
  const { state, notice } = setup()
  approveAbsence(state, admin, notice.id, {}, now)
  unchangedOnFailure(
    state,
    () => approveAbsence(state, admin, notice.id, {}, now),
    isDomainError('absence_already_decided', 'conflict'),
  )
  unchangedOnFailure(
    state,
    () => rejectAbsence(state, admin, notice.id, { reason: 'Geç geldi.' }, now),
    isDomainError('absence_already_decided', 'conflict'),
  )
})

test('DOM-ILT-053: kararı yalnız yönetici verir; rehber öğretmen, veli, öğrenci ve ön büro veremez', () => {
  const { state, notice } = setup()
  for (const by of [homeroom, parent, student, frontOffice]) {
    unchangedOnFailure(
      state,
      () => approveAbsence(state, by, notice.id, {}, now),
      isDomainError('permission_denied', 'forbidden'),
    )
    unchangedOnFailure(
      state,
      () => rejectAbsence(state, by, notice.id, { reason: 'Uygun değil.' }, now),
      isDomainError('permission_denied', 'forbidden'),
    )
  }
  unchangedOnFailure(
    state,
    () => approveAbsence(state, admin, 'absence-yok', {}, now),
    isDomainError('absence_not_found', 'not_found'),
  )
  unchangedOnFailure(
    state,
    () => approveAbsence(state, admin, notice.id, { note: 'x' }, now),
    zodError,
  )
  state.modules.academic = false
  unchangedOnFailure(
    state,
    () => approveAbsence(state, admin, notice.id, {}, now),
    isDomainError('module_disabled', 'forbidden'),
  )
})

test('DOM-ILT-053: durumu olmayan eski kayıt onay bekliyor okunur ve onaylanabilir', () => {
  const state = createSeed(new Date(now))
  state.absences.push({
    id: 'absence-legacy-approval',
    studentId: 's1',
    startDate: '2026-10-05',
    endDate: '2026-10-05',
    category: 'Sağlık',
    status: 'İletildi',
  })
  const legacy = state.absences[0]!
  assert.equal(absenceApprovalStatus(legacy), 'pending')
  assert.equal('approvalStatus' in legacy, false)
  approveAbsence(state, admin, legacy.id, {}, now)
  assert.equal(absenceApprovalStatus(legacy), 'approved')
})

test('DOM-ILT-053: kararı veren kişi veli ve öğrenciye dönmez; yönetici ve rehber görür', () => {
  const { state, notice } = setup()
  approveAbsence(state, admin, notice.id, {}, now)
  const record = (by: Participant) =>
    visibleRecords(state, by, 'absences').find((a) => a.id === notice.id)
  assert.equal(record(parent)?.approvalStatus, 'approved')
  assert.equal(record(parent) !== undefined && 'decidedBy' in record(parent)!, false)
  assert.equal(record(student) !== undefined && 'decidedBy' in record(student)!, false)
  assert.deepEqual(record(admin)?.decidedBy, { role: 'yonetici', userId: 'u-admin' })
  assert.deepEqual(record(homeroom)?.decidedBy, { role: 'yonetici', userId: 'u-admin' })
})
