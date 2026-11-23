import assert from 'node:assert/strict'
import test from 'node:test'

import type { ProfessionalDevelopmentProgram } from '@kampus/react-shared/use-finance-professional-development.ts'

import {
  capacityText,
  emptyProgramForm,
  parseDecimal,
  programBody,
  programDatesText,
  programFormField,
  programFormFrom,
  programFormSchema,
} from '../src/pages/finance/finance-professional-development-forms.ts'

// Mesleki gelişim katalog formu (DOM-FIN-125; ON-214).

const PROGRAM: ProfessionalDevelopmentProgram = {
  id: 'p1',
  name: 'Okuma becerisi öğretimi',
  kind: 'seminar',
  provider: 'Öğretmen Akademisi',
  durationHours: 1.5,
  ongoing: false,
  startDate: '2026-11-10',
  endDate: '2026-11-11',
  location: 'Salon',
  onlineUrl: null,
  audienceRoles: ['ogretmen'],
  audienceBranches: ['İngilizce', 'Matematik'],
  feeCents: 125_050,
  costCenterId: null,
  capacity: 20,
  status: 'draft',
  enrolledCount: 3,
  attendedCount: 1,
  createdAt: '2026-10-06T09:00:00.000Z',
  updatedAt: '2026-10-06T09:00:00.000Z',
  version: 1,
}

test('DOM-FIN-125: ondalık virgül, TL → kuruş, branş virgülle', () => {
  assert.equal(parseDecimal(''), null)
  assert.equal(parseDecimal('1,5'), 1.5)
  assert.equal(parseDecimal('1.250,50'), 1250.5)
  assert.ok(Number.isNaN(parseDecimal('abc')))
  const values = programFormFrom(PROGRAM)
  assert.equal(values.durationHours, '1,5')
  assert.equal(values.feeTl, '1250,5')
  assert.equal(values.audienceBranches, 'İngilizce, Matematik')
  const body = programBody(values)
  assert.equal(body.feeCents, 125_050)
  assert.equal(body.durationHours, 1.5)
  assert.deepEqual(body.audienceBranches, ['İngilizce', 'Matematik'])
  assert.equal(body.capacity, 20)
})

test('DOM-FIN-125: sürekli eğitimde tarih gövdeye gitmez', () => {
  const body = programBody({ ...programFormFrom(PROGRAM), ongoing: true })
  assert.equal(body.startDate, null)
  assert.equal(body.endDate, null)
})

test('DOM-FIN-125: form şeması core hatalarını alana düşürür', () => {
  const empty = programFormSchema.safeParse(emptyProgramForm())
  assert.equal(empty.success, false)
  const fields = empty.success ? [] : empty.error.issues.map((issue) => issue.path[0])
  assert.ok(fields.includes('name'))
  assert.ok(fields.includes('durationHours'))
  const noPlace = programFormSchema.safeParse({ ...programFormFrom(PROGRAM), location: '' })
  assert.deepEqual(noPlace.success ? [] : noPlace.error.issues.map((issue) => issue.path[0]), [
    'location',
  ])
  assert.equal(programFormSchema.safeParse(programFormFrom(PROGRAM)).success, true)
  assert.equal(programFormField('feeCents'), 'feeTl')
  assert.equal(programFormField('costCenterId'), 'feeTl')
  assert.equal(programFormField('bilinmeyen'), null)
})

test('DOM-FIN-125: tarih ve kontenjan metinleri', () => {
  const format = (day: string) => day
  assert.equal(programDatesText(PROGRAM, format), '2026-11-10 – 2026-11-11')
  assert.equal(programDatesText({ ...PROGRAM, endDate: '2026-11-10' }, format), '2026-11-10')
  assert.equal(programDatesText({ ...PROGRAM, ongoing: true, startDate: null }, format), 'Sürekli')
  assert.equal(capacityText(PROGRAM), '3 / 20')
  assert.equal(capacityText({ ...PROGRAM, capacity: null }), '3 kişi')
})
