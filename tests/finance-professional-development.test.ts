import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertEnrollmentAllowed,
  assertEnrollmentUpdate,
  assertProgramEditable,
  assertStatusTransition,
  audienceLabel,
  FINANCE_PROFESSIONAL_DEVELOPMENT_READ_ROLES,
  FINANCE_PROFESSIONAL_DEVELOPMENT_WRITE_ROLES,
  hoursLabel,
  hoursToMinutes,
  minutesToHours,
  professionalDevelopmentEnrollmentInputSchema,
  professionalDevelopmentEnrollmentUpdateSchema,
  professionalDevelopmentProgramInputSchema,
  type ProfessionalDevelopmentStatus,
} from '../packages/school-core/src/lib/finance-professional-development.ts'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'

/** Mesleki gelişim kataloğu kuralları (DOM-FIN-125; ON-214; K-430…K-432). */

const BASE = {
  name: 'Okuma becerisi öğretimi',
  kind: 'seminar',
  provider: 'Öğretmen Akademisi',
  durationHours: 6,
  startDate: '2026-11-10',
  endDate: '2026-11-11',
  location: 'Konferans salonu',
}

const codeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof DomainError)
    return error.code
  }
  return null
}

const issues = (input: unknown) => {
  const result = professionalDevelopmentProgramInputSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

test('DOM-FIN-125: K-430 yönetici yazar; ön büro yalnız okur', () => {
  assert.deepEqual([...FINANCE_PROFESSIONAL_DEVELOPMENT_WRITE_ROLES], ['yonetici'])
  assert.deepEqual([...FINANCE_PROFESSIONAL_DEVELOPMENT_READ_ROLES], ['yonetici', 'onburo'])
})

test('DOM-FIN-125: katalog girdisi varsayılanları ve etiket tekilleştirme', () => {
  const parsed = professionalDevelopmentProgramInputSchema.parse({
    ...BASE,
    audienceRoles: ['ogretmen', 'ogretmen'],
    audienceBranches: ['İngilizce', ' İngilizce '],
  })
  assert.equal(parsed.ongoing, false)
  assert.equal(parsed.onlineUrl, null)
  assert.equal(parsed.feeCents, null)
  assert.equal(parsed.capacity, null)
  assert.deepEqual(parsed.audienceRoles, ['ogretmen'])
  assert.deepEqual(parsed.audienceBranches, ['İngilizce'])
})

test('DOM-FIN-125: tarih aralığı, sürekli eğitim, yer ve bağlantı kuralları', () => {
  assert.deepEqual(issues(BASE), [])
  assert.deepEqual(issues({ ...BASE, startDate: null, endDate: null }), [
    'Başlangıç gününü seçin.',
    'Bitiş gününü seçin.',
  ])
  assert.deepEqual(issues({ ...BASE, endDate: '2026-11-09' }), [
    'Bitiş günü başlangıçtan önce olamaz.',
  ])
  assert.deepEqual(issues({ ...BASE, ongoing: true }), ['Sürekli eğitimde tarih aralığı girilmez.'])
  assert.deepEqual(issues({ ...BASE, ongoing: true, startDate: null, endDate: null }), [])
  assert.deepEqual(issues({ ...BASE, location: '' }), ['Yeri ya da çevrim içi bağlantıyı yazın.'])
  assert.deepEqual(issues({ ...BASE, kind: 'online' }), [
    'Çevrim içi eğitimde bağlantı zorunludur.',
  ])
  assert.deepEqual(issues({ ...BASE, onlineUrl: 'http://ornek.test' }), [
    'Bağlantı https:// ile başlamalı.',
  ])
  assert.deepEqual(
    issues({ ...BASE, kind: 'online', location: null, onlineUrl: 'https://ornek.test/kurs' }),
    [],
  )
})

test('DOM-FIN-125: süre yarım saat adımlı; ücret kuruş; maliyet merkezi yalnız ücretle', () => {
  assert.deepEqual(issues({ ...BASE, durationHours: 1.5 }), [])
  assert.deepEqual(issues({ ...BASE, durationHours: 1.25 }), [
    'Süre yarım saat adımlarıyla girilir.',
  ])
  assert.deepEqual(issues({ ...BASE, durationHours: 0 }), ['Süre sıfırdan büyük olmalı.'])
  assert.deepEqual(issues({ ...BASE, feeCents: 10.5 }), ['Ücret kuruş olarak girilir.'])
  assert.deepEqual(issues({ ...BASE, feeCents: -1 }), ['Ücret eksi olamaz.'])
  assert.deepEqual(issues({ ...BASE, costCenterId: '0f0e4f36-3a59-4c39-8a0a-7d6a5c2b1e11' }), [
    'Maliyet merkezi yalnız ücretli eğitimde seçilir.',
  ])
  assert.deepEqual(issues({ ...BASE, capacity: 0 }), ['Kontenjan en az 1 olmalı.'])
  assert.equal(hoursToMinutes(12.5), 750)
  assert.equal(minutesToHours(750), 12.5)
  assert.equal(hoursLabel(1.5), '1,5 saat')
})

test('DOM-FIN-125: K-431 durum geçişleri; arşiv son durum ve düzeltilmez', () => {
  const allowed: [ProfessionalDevelopmentStatus, ProfessionalDevelopmentStatus][] = [
    ['draft', 'published'],
    ['draft', 'archived'],
    ['published', 'archived'],
  ]
  for (const [from, to] of allowed)
    assert.equal(
      codeOf(() => assertStatusTransition(from, to)),
      null,
    )
  for (const [from, to] of [
    ['published', 'draft'],
    ['archived', 'published'],
    ['archived', 'draft'],
    ['draft', 'draft'],
  ] as const)
    assert.equal(
      codeOf(() => assertStatusTransition(from, to)),
      'professional_development_status_transition',
    )
  assert.equal(
    codeOf(() => assertProgramEditable('published')),
    null,
  )
  assert.equal(
    codeOf(() => assertProgramEditable('archived')),
    'professional_development_archived',
  )
})

test('DOM-FIN-125: K-432 atama yalnız yayındaki eğitime, etkin personele, kontenjan içinde, bir kez', () => {
  const ok = {
    programStatus: 'published' as const,
    staff: { role: 'ogretmen', active: true },
    alreadyEnrolled: false,
    capacity: 2,
    enrolledCount: 1,
  }
  assert.equal(
    codeOf(() => assertEnrollmentAllowed(ok)),
    null,
  )
  assert.equal(
    codeOf(() => assertEnrollmentAllowed({ ...ok, capacity: null, enrolledCount: 99 })),
    null,
  )
  const cases = [
    [{ programStatus: 'draft' as const }, 'professional_development_not_published'],
    [{ programStatus: 'archived' as const }, 'professional_development_not_published'],
    [{ staff: null }, 'professional_development_staff_not_found'],
    [{ staff: { role: 'veli', active: true } }, 'professional_development_not_staff'],
    [{ staff: { role: 'onburo', active: false } }, 'professional_development_staff_inactive'],
    [{ alreadyEnrolled: true }, 'professional_development_already_enrolled'],
    [{ enrolledCount: 2 }, 'professional_development_capacity_full'],
  ] as const
  for (const [change, code] of cases)
    assert.equal(
      codeOf(() => assertEnrollmentAllowed({ ...ok, ...change })),
      code,
    )
})

test('DOM-FIN-125: K-432 katılım saati yalnız katıldı durumunda ve süreyi aşmadan', () => {
  const parse = (input: unknown) => professionalDevelopmentEnrollmentUpdateSchema.safeParse(input)
  assert.equal(parse({ status: 'attended', attendedHours: 2 }).success, true)
  assert.equal(parse({ status: 'attended' }).success, false)
  assert.equal(parse({ status: 'assigned', attendedHours: 2 }).success, false)
  assert.equal(parse({ status: 'not_completed' }).success, true)
  assert.equal(
    professionalDevelopmentEnrollmentInputSchema.parse({ membershipId: 'm1' }).origin,
    'assignment',
  )
  const base = { programStatus: 'published' as const, programMinutes: 360 }
  assert.equal(
    codeOf(() => assertEnrollmentUpdate({ ...base, attendedMinutes: 360 })),
    null,
  )
  assert.equal(
    codeOf(() => assertEnrollmentUpdate({ ...base, attendedMinutes: null })),
    null,
  )
  assert.equal(
    codeOf(() => assertEnrollmentUpdate({ ...base, attendedMinutes: 390 })),
    'professional_development_hours_exceed',
  )
  assert.equal(
    codeOf(() =>
      assertEnrollmentUpdate({ ...base, programStatus: 'archived', attendedMinutes: null }),
    ),
    'professional_development_archived',
  )
})

test('DOM-FIN-125: hedef kitle etiketi', () => {
  assert.equal(audienceLabel({ audienceRoles: [], audienceBranches: [] }), 'Tüm personel')
  assert.equal(
    audienceLabel({ audienceRoles: ['ogretmen', 'onburo'], audienceBranches: ['Matematik'] }),
    'Öğretmen, Ön büro, Matematik',
  )
})
