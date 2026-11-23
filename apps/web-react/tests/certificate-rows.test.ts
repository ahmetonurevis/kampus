import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  CourseCertificate,
  GroupMebbisList,
} from '@kampus/react-shared/use-course-certificates.ts'
import { certificateLevelStatement } from '@kampus/school-core/cefr/certificates.ts'
import { filterRows } from '../src/lib/list-query.ts'
import {
  canManageCertificate,
  CERTIFICATE_CSV_COLUMNS,
  certificateActions,
  certificateFilters,
  certificateRows,
  eligibleActions,
  eligibleRows,
} from '../src/pages/language/certificate-rows.ts'

// Kurum başarı belgeleri ekranının satır modeli (OG-088; IST-081; DOM-DIL-080, 081, 082).

function staff(overrides: Partial<Record<string, unknown>> = {}): CourseCertificate {
  return {
    id: 'cert-1',
    number: 'KB-2026-000001',
    status: 'valid',
    verificationCode: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345',
    enrollmentId: 'enr-1',
    groupId: 'grp-1',
    learnerId: 'stu-1',
    courseId: 'course-b1',
    decisionId: 'dec-1',
    content: {
      schemaVersion: 1,
      title: 'Kurum başarı belgesi',
      institutionName: 'Kampüs Dil Akademisi',
      learnerName: 'Deniz Yılmaz',
      courseId: 'course-b1',
      courseName: 'B1 Genel İngilizce',
      level: 'B1',
      levelStatement: certificateLevelStatement('B1'),
      totalHours: 120,
      attendance: { attendedHours: 110, totalHours: 120, permille: 916 },
      finalScore: 78,
      skills: [],
      decisionId: 'dec-1',
      approvedAt: '2026-11-01T09:00:00.000Z',
    },
    replacesCertificateId: null,
    issuedByUserId: 'u-1',
    issuedAt: '2026-11-02T22:30:00.000Z',
    cancelledByUserId: null,
    cancelledAt: null,
    cancellationReason: null,
    rowVersion: 1,
    ...overrides,
  } as CourseCertificate
}

/** Öğrenci ve velinin aldığı dar belge (sürüm, kayıt ve iptal izi yok). */
function narrow(): CourseCertificate {
  const full = staff() as Extract<CourseCertificate, { rowVersion: number }>
  return {
    id: full.id,
    number: full.number,
    status: full.status,
    verificationCode: full.verificationCode,
    courseId: full.courseId,
    content: full.content,
    issuedAt: full.issuedAt,
  }
}

const cancelled = staff({
  status: 'cancelled',
  cancelledAt: '2026-11-03T08:00:00.000Z',
  cancellationReason: 'Ad yanlış yazıldı',
  cancelledByUserId: 'u-1',
})
const replacement = staff({
  id: 'cert-2',
  number: 'KB-2026-000002',
  replacesCertificateId: 'cert-1',
  issuedAt: '2026-11-03T09:00:00.000Z',
})

test('DOM-DIL-081: belge satırı içerik kopyasından ad, kur, seviye ve İstanbul tarihini gösterir', () => {
  const [row] = certificateRows([staff()])
  assert.ok(row)
  assert.equal(row.learner, 'Deniz Yılmaz')
  assert.equal(row.course, 'B1 Genel İngilizce')
  assert.equal(row.level, 'B1')
  assert.equal(row.levelKey, 'B1')
  assert.equal(row.status, 'Geçerli')
  assert.equal(row.tone, 'green')
  // UTC 2 Kasım 22:30, İstanbul'da 3 Kasım.
  assert.match(row.issued, /3 Kas 2026/)
  assert.equal(row.cancelled, '')
  assert.equal(row.replaceable, false)
  assert.ok(row.staff)
})

test('DOM-DIL-082: iptal edilen belge yerine belge düzenlenene kadar yeniden düzenlenebilir', () => {
  const alone = certificateRows([cancelled])[0]
  assert.equal(alone?.status, 'İptal edildi')
  assert.equal(alone?.tone, 'red')
  assert.equal(alone?.reason, 'Ad yanlış yazıldı')
  assert.match(alone?.cancelled ?? '', /3 Kas 2026/)
  assert.equal(alone?.replaceable, true)

  const [old, fresh] = certificateRows([cancelled, replacement])
  assert.equal(old?.replaceable, false)
  assert.equal(fresh?.replaces, 'KB-2026-000001')
})

test('DOM-DIL-082: öğrenci ve veli satırı iptal izi ve işlem taşımaz', () => {
  const [row] = certificateRows([narrow()])
  assert.equal(row?.staff, null)
  assert.equal(row?.reason, '')
  assert.equal(row?.replaceable, false)
  assert.deepEqual(row && certificateActions(row, 'yonetici', new Set()), {
    cancel: false,
    reissue: false,
  })
})

test('DOM-DIL-081: iptal ve yeniden düzenleme yalnız yönetici ve seviyenin koordinatöründe', () => {
  const levels = new Set(['B1'])
  assert.equal(canManageCertificate('yonetici', new Set(), 'B1'), true)
  assert.equal(canManageCertificate('ogretmen', levels, 'B1'), true)
  assert.equal(canManageCertificate('ogretmen', levels, 'A2'), false)
  assert.equal(canManageCertificate('onburo', levels, 'B1'), false)
  assert.equal(canManageCertificate(undefined, levels, 'B1'), false)

  const [valid] = certificateRows([staff()])
  const [pending] = certificateRows([cancelled])
  assert.ok(valid && pending)
  assert.deepEqual(certificateActions(valid, 'ogretmen', levels), { cancel: true, reissue: false })
  assert.deepEqual(certificateActions(pending, 'ogretmen', levels), {
    cancel: false,
    reissue: true,
  })
  assert.deepEqual(certificateActions(valid, 'ogretmen', new Set(['A2'])), {
    cancel: false,
    reissue: false,
  })
})

test('DOM-DIL-081: süzgeç durum ve kur etiketiyle satırları daraltır', () => {
  const other = staff({
    id: 'cert-3',
    number: 'KB-2026-000003',
    enrollmentId: 'enr-3',
    courseId: 'course-a2',
    content: {
      ...(staff() as Extract<CourseCertificate, { rowVersion: number }>).content,
      courseName: 'A2 Genel İngilizce',
      level: 'A2',
    },
  })
  const rows = certificateRows([cancelled, replacement, other])
  const fields = certificateFilters(rows)
  assert.deepEqual(
    fields.map((field) => field.key),
    ['status', 'course'],
  )
  assert.deepEqual(
    fields[1]?.options?.map((option) => option.label),
    ['A2 Genel İngilizce', 'B1 Genel İngilizce'],
  )
  const cancelledOnly = filterRows(rows, '', fields, { status: 'İptal edildi' }, [])
  assert.deepEqual(
    cancelledOnly.map((row) => row.id),
    ['cert-1'],
  )
  const a2 = filterRows(rows, '', fields, { course: 'A2 Genel İngilizce' }, [])
  assert.deepEqual(
    a2.map((row) => row.id),
    ['cert-3'],
  )
  const searched = filterRows(rows, '000002', fields, {}, ['number', 'learner'])
  assert.deepEqual(
    searched.map((row) => row.id),
    ['cert-2'],
  )
})

test('DOM-DIL-081: CSV sütunları belge no, kursiyer, durum ve yerine düzenlendiği belgeyi içerir', () => {
  const keys = CERTIFICATE_CSV_COLUMNS.map((column) => column.key)
  assert.deepEqual(keys, [
    'number',
    'learner',
    'course',
    'level',
    'status',
    'issued',
    'cancelled',
    'replaces',
  ])
  const [row] = certificateRows([staff()])
  for (const key of keys) assert.ok(row && key in row, key)
})

const cancelledBits = {
  status: 'cancelled',
  cancelledAt: '2026-11-03T08:00:00.000Z',
  cancellationReason: 'Kur yanlış',
  cancelledByUserId: 'u-1',
}

const mebbis = (learners: GroupMebbisList['learners']): GroupMebbisList => ({
  groupId: 'grp-1',
  courseId: 'course-b1',
  canRecord: true,
  learners,
})

test('DOM-DIL-080: hak kazanan satırı belge ve MEBBİS izini gösterir', () => {
  const list = mebbis([
    { enrollmentId: 'enr-1', studentId: 'stu-1', decisionId: 'dec-1', record: null },
    {
      enrollmentId: 'enr-2',
      studentId: 'stu-2',
      decisionId: 'dec-2',
      record: {
        id: 'mb-1',
        decisionId: 'dec-2',
        certificateNumber: 'MEB-778',
        issuedDate: '2026-11-02',
        recordedByUserId: 'u-1',
        recordedAt: '2026-11-03T08:00:00.000Z',
      },
    },
    { enrollmentId: 'enr-3', studentId: 'stu-3', decisionId: 'dec-3', record: null },
  ])
  const certificates = [staff(), staff({ id: 'cert-9', enrollmentId: 'enr-3', ...cancelledBits })]
  const names = new Map([
    ['stu-1', 'Deniz Yılmaz'],
    ['stu-2', 'Ece Yılmaz'],
  ])
  const [first, second, third] = eligibleRows(list, certificates, names)
  assert.equal(first?.learner, 'Deniz Yılmaz')
  assert.equal(first?.certificate, 'KB-2026-000001')
  assert.equal(first?.certificateState, 'valid')
  assert.equal(first?.mebbis, 'İşaretlenmedi')
  assert.equal(first?.mebbisRecorded, false)

  assert.equal(second?.learner, 'Ece Yılmaz')
  assert.equal(second?.certificate, 'Düzenlenmedi')
  assert.equal(second?.certificateState, 'none')
  assert.match(second?.mebbis ?? '', /^MEB-778 · 2 Kas 2026$/)
  assert.equal(second?.mebbisRecorded, true)

  // Ad okunamazsa belge kopyasındaki ad; iptal edilmiş belge yeniden düzenlenecek belgedir.
  assert.equal(third?.learner, 'Deniz Yılmaz')
  assert.equal(third?.certificateState, 'replace')
  assert.equal(third?.replacesCertificateId, 'cert-9')
  assert.match(third?.certificate ?? '', /iptal edildi$/)
  // İptal edilen belgenin numarası ekran metninden değil ayrı alandan gelir.
  assert.equal(third?.replacesNumber, 'KB-2026-000001')
  assert.equal(first?.replacesNumber, null)
  assert.equal(second?.replacesNumber, null)
})

test('DOM-DIL-080: hak kazanan satırında işlemler yalnız işaretleyebilen personelde', () => {
  assert.deepEqual(eligibleActions({ certificateState: 'none', mebbisRecorded: false }, true), {
    issue: true,
    reissue: false,
    mebbis: true,
  })
  assert.deepEqual(eligibleActions({ certificateState: 'replace', mebbisRecorded: true }, true), {
    issue: false,
    reissue: true,
    mebbis: false,
  })
  assert.deepEqual(eligibleActions({ certificateState: 'valid', mebbisRecorded: false }, true), {
    issue: false,
    reissue: false,
    mebbis: true,
  })
  assert.deepEqual(eligibleActions({ certificateState: 'none', mebbisRecorded: false }, false), {
    issue: false,
    reissue: false,
    mebbis: false,
  })
})
