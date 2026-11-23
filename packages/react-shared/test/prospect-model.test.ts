import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSeed } from '@kampus/school-core/data/seed.ts'

import {
  CONTACT_LABELS,
  isOpenStage,
  lostReasonLabel,
  meetingEvents,
  prospectContactOwner,
  slotLabel,
  stageBody,
  stageTargets,
  type ProspectRecord,
} from '../src/prospect-model.ts'

const NOW = Date.parse('2026-10-15T09:00:00.000Z')
const base = createSeed().prospects[0] as ProspectRecord
const prospect = (patch: Partial<ProspectRecord>): ProspectRecord => ({ ...base, ...patch })
const ACTOR = { role: 'onburo', userId: 'u-onburo' } as const
const context = {
  now: NOW,
  branches: new Map([[base.branchId, 'Merkez Kampüs']]),
  classes: new Map([['c1', 'A2 Akşam']]),
}

test('DOM-KAY-030: aşama hedefleri planlama ve kesin kayıt dışıdır; kayıtlı adayın hedefi yoktur', () => {
  assert.deepEqual(stageTargets('Yeni aday'), ['İletişime geçildi', 'Teklif verildi', 'Vazgeçti'])
  assert.deepEqual(stageTargets('Kayıt oldu'), [])
  assert.deepEqual(stageTargets('Vazgeçti'), ['İletişime geçildi'])
})

test('DOM-KAY-032: yalnız açık aşama açıktır', () => {
  assert.equal(isOpenStage('Teklif verildi'), true)
  assert.equal(isOpenStage('Kayıt oldu'), false)
  assert.equal(isOpenStage('Vazgeçti'), false)
  assert.equal(isOpenStage(undefined), false)
})

test('DOM-KAY-003: iletişim 18 yaş altında velinindir; yaş bayrağı olmayan eski aday 18 yaş altıdır', () => {
  assert.equal(prospectContactOwner({}), 'guardian')
  assert.equal(prospectContactOwner({ minor: true }), 'guardian')
  assert.equal(prospectContactOwner({ minor: false }), 'self')
  assert.equal(CONTACT_LABELS.guardian.phone, 'Veli telefonu')
  assert.equal(CONTACT_LABELS.self.email, 'E-posta')
})

test('DOM-KAY-005: vazgeçme nedeni etiketlenir, tanınmayan eski neden olduğu gibi kalır', () => {
  assert.equal(lostReasonLabel('price'), 'Fiyat')
  assert.equal(lostReasonLabel('eski neden'), 'eski neden')
})

test('DOM-KAY-005: aşama gövdesi; vazgeçmede neden zorunlu, kardeş yalnız yeniden açmada gider', () => {
  assert.deepEqual(stageBody({ stage: '' }, { reopening: false }), {
    ok: false,
    field: 'stage',
    message: 'Aşamayı seçin.',
  })
  assert.deepEqual(stageBody({ stage: 'Vazgeçti' }, { reopening: false }), {
    ok: false,
    field: 'lostReason',
    message: 'Vazgeçme nedenini seçin.',
  })
  assert.deepEqual(
    stageBody(
      { stage: 'Vazgeçti', lostReason: 'price', lostToInstitution: '  Başka Okul ' },
      { reopening: false },
    ),
    { ok: true, body: { stage: 'Vazgeçti', lostReason: 'price', lostToInstitution: 'Başka Okul' } },
  )
  assert.deepEqual(
    stageBody(
      { stage: 'Vazgeçti', lostReason: 'price', lostToInstitution: ' ' },
      { reopening: false },
    ),
    { ok: true, body: { stage: 'Vazgeçti', lostReason: 'price' } },
  )
  assert.deepEqual(
    stageBody({ stage: 'İletişime geçildi', siblingOfId: 'p2' }, { reopening: true }),
    { ok: true, body: { stage: 'İletişime geçildi', siblingOfId: 'p2' } },
  )
  assert.deepEqual(
    stageBody({ stage: 'Teklif verildi', siblingOfId: 'p2' }, { reopening: false }),
    { ok: true, body: { stage: 'Teklif verildi' } },
  )
})

test('slotLabel süreyi başlangıca ekleyip İstanbul saatiyle aralık yazar', () => {
  assert.equal(slotLabel('2026-10-20T10:00:00.000Z', 45), '13:00 – 13:45')
})

test('DOM-KAY-033, DOM-KAY-034: görüşme ve deneme dersi olayları; kapalı aday düşer, yaklaşan önce', () => {
  const events = meetingEvents(
    [
      prospect({
        id: 'a',
        name: 'Geçmiş',
        stage: 'Görüşme planlandı',
        trialAt: '2026-10-10T10:00:00.000Z',
      }),
      prospect({
        id: 'b',
        name: 'Uzak',
        stage: 'Görüşme planlandı',
        trialAt: '2026-10-25T10:00:00.000Z',
        meeting: {
          date: '2026-10-25T10:00:00.000Z',
          duration: 45,
          room: 'Oda 2',
          teacherId: null,
          scheduledAt: '2026-10-01T09:00:00.000Z',
          by: ACTOR,
        },
      }),
      prospect({
        id: 'c',
        name: 'Deneme',
        stage: 'Teklif verildi',
        trialAt: undefined,
        trialLesson: {
          classId: 'c1',
          date: '2026-10-20T10:00:00.000Z',
          duration: 60,
          lessonId: 'l-1',
          guardianConsentAt: null,
          scheduledAt: '2026-10-01T09:00:00.000Z',
          by: ACTOR,
        },
      }),
      prospect({
        id: 'd',
        name: 'Kayıtlı',
        stage: 'Kayıt oldu',
        trialAt: '2026-10-21T10:00:00.000Z',
      }),
    ],
    'language_school',
    context,
  )
  assert.deepEqual(
    events.map((event) => [event.id, event.upcoming]),
    [
      ['c:trial', true],
      ['b:meeting', true],
      ['a:meeting', false],
    ],
  )
  const [trial, meeting, past] = events
  assert.equal(trial?.kindLabel, 'Deneme dersi')
  assert.equal(trial?.place, 'A2 Akşam')
  assert.equal(trial?.timeRange, '13:00 – 14:00')
  assert.equal(meeting?.place, 'Oda 2')
  assert.equal(meeting?.branch, 'Merkez Kampüs')
  assert.equal(meeting?.stageLabel, 'Seviye tespiti / deneme dersi planlandı')
  assert.equal(past?.place, '—')
  assert.equal(past?.day, '2026-10-10')
})
