import assert from 'node:assert/strict'
import test from 'node:test'

import {
  missingDocumentsText,
  policyAckBody,
  policyAckDefaults,
  policyAckFormField,
  policyAckFormSchema,
  policyDocumentBody,
  policyDocumentDefaults,
  policyDocumentFormField,
  policyDocumentFormSchema,
  rateText,
} from '../src/pages/finance/finance-policy-acknowledgement-forms.ts'

// Politika onayları sekmesinin saf mantığı (DOM-FIN-127; ON-190; K-436…K-438).

test('DOM-FIN-127: yeni sürüm formu önceki sürümün ad, tür ve kitlesini taşır', () => {
  assert.deepEqual(policyDocumentDefaults('2026-10-06', null), {
    title: '',
    policyType: 'staff_regulation',
    audience: 'all_staff',
    publishedOn: '2026-10-06',
  })
  const previous = {
    title: 'KVKK taahhüdü',
    policyType: 'kvkk_commitment',
    audience: 'teachers',
  } as const
  const values = policyDocumentDefaults('2026-10-06', previous)
  assert.equal(values.title, 'KVKK taahhüdü')
  assert.deepEqual(policyDocumentBody({ ...values, title: ' KVKK ' }, 'f-1', 'd-1'), {
    title: 'KVKK',
    policyType: 'kvkk_commitment',
    audience: 'teachers',
    publishedOn: '2026-10-06',
    fileId: 'f-1',
    replacesDocumentId: 'd-1',
  })
  assert.equal(policyDocumentFormSchema.safeParse({ ...values, title: 'x' }).success, false)
  assert.equal(policyDocumentFormField('publishedOn'), 'publishedOn')
  assert.equal(policyDocumentFormField('fileId'), null)
})

test('DOM-FIN-127: onay formu personel adına kanalı ve taramayı gönderir (K-437)', () => {
  const values = policyAckDefaults('2026-10-06')
  assert.equal(values.channel, 'wet_signature')
  assert.deepEqual(policyAckBody('d-1', 'm-1', values, null), {
    policyDocumentId: 'd-1',
    membershipId: 'm-1',
    acknowledgedOn: '2026-10-06',
    channel: 'wet_signature',
    scanFileId: null,
  })
  assert.equal(policyAckFormSchema.safeParse({ ...values, channel: 'self_service' }).success, false)
  assert.equal(policyAckFormField('channel'), 'channel')
  assert.equal(policyAckFormField('membershipId'), null)
})

test('DOM-FIN-127: oran ve eksik onay metinleri (K-438)', () => {
  assert.equal(rateText({ acknowledgedCount: 2, targetCount: 3, rate: 67 }), '2 / 3 (%67)')
  assert.equal(rateText({ acknowledgedCount: 0, targetCount: 0, rate: null }), 'Hedef personel yok')
  assert.equal(missingDocumentsText([]), null)
  assert.equal(
    missingDocumentsText([{ title: 'İş güvenliği', version: 2 }]),
    'İş güvenliği (Sürüm 2)',
  )
})
