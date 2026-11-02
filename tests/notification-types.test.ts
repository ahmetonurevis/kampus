import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defineNotificationType,
  duplicateNotificationTypes,
} from '../packages/school-core/src/lib/notification-type.ts'
import {
  notificationAudiences,
  notificationEnabled,
  notificationSubject,
} from '../packages/school-core/src/lib/notifications.ts'
import {
  isNotificationType,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_NAMES,
  notificationTypeSpec,
  ONUR_NOTIFICATION_TYPES,
} from '../packages/school-core/src/modules/notification-types.ts'
import { MODULE_KEYS } from '../packages/school-core/src/modules/collection-modules.ts'
import { PLATFORM_NOTIFICATION_TYPES } from '../packages/school-core/src/platform/notification-types.ts'

/**
 * Bildirim türü kaydı (IST-065, OG-018; docs/domain/iletisim-ve-veli.md DOM-ILT-020, -022, -023):
 * alan başına tür dosyası, birleşim, veri şeması, modül ve kitle kararı.
 */

// Kök testler zod'u doğrudan içe aktarmaz; şemalar kayıtlı türden türetilir.
const base = PLATFORM_NOTIFICATION_TYPES.feedback_released

test('IST-065: tür kodu iki kaynakta (platform ve Onur bloğu) birden bulunmaz; birleşik kayıt ikisinin toplamıdır', () => {
  assert.deepEqual(
    duplicateNotificationTypes(PLATFORM_NOTIFICATION_TYPES, ONUR_NOTIFICATION_TYPES),
    [],
  )
  assert.deepEqual(NOTIFICATION_TYPE_NAMES, [
    ...Object.keys(PLATFORM_NOTIFICATION_TYPES),
    ...Object.keys(ONUR_NOTIFICATION_TYPES),
  ])
  // Çakışma denetimi gerçekten yakalar: aynı kod iki kaynakta.
  assert.deepEqual(
    duplicateNotificationTypes(
      { feedback_released: 1, a: 1 },
      { b: 1, feedback_released: 2 },
      { a: 3 },
    ),
    ['a', 'feedback_released'],
  )
})

test('IST-065, DOM-ILT-023: her tür katı veri şeması, bilinen modül, kitle ve ayrıntısız başlık taşır', () => {
  for (const [code, spec] of Object.entries(NOTIFICATION_TYPES)) {
    assert.match(code, /^[a-z]+(_[a-z]+)*$/, code)
    assert.equal(spec.data.def.catchall?._zod.def.type, 'never', `${code} şeması katı değil`)
    assert.ok(spec.module === null || MODULE_KEYS.includes(spec.module), code)
    assert.ok(spec.audiences.minor.length + spec.audiences.adult.length > 0, code)
    // Yetişkin kursiyerin bildirimi veliye gitmez (DOM-ILT-052 ilkesi).
    assert.ok(!(spec.audiences.adult as readonly string[]).includes('parent'), code)
    for (const title of Object.values(spec.titles)) assert.doesNotMatch(title, /\d/, code)
  }
  assert.equal(isNotificationType('toString'), false)
  assert.equal(notificationTypeSpec('toString'), undefined)
  assert.equal(notificationTypeSpec('feedback_released'), NOTIFICATION_TYPES.feedback_released)
})

test('IST-065: tür tanımı katı olmayan şemayı ve bilinmeyen başlık yer tutucusunu reddeder', () => {
  assert.equal(defineNotificationType(base), base)
  assert.throws(
    () => defineNotificationType({ ...base, data: base.data.loose() } as never),
    /strict/,
  )
  assert.throws(
    () =>
      defineNotificationType({
        ...base,
        titles: { student: 'Puanın {puan}.', parent: '{öğrenci} için geri bildirim geldi.' },
      }),
    /placeholder/,
  )
})

test('IST-065, DOM-ILT-023: veri tür şemasıyla doğrulanır; fazla alan, eksik alan ve bilinmeyen tür reddedilir', () => {
  assert.deepEqual(notificationSubject('feedback_released', { submissionId: 'sub-1' }), {
    kind: 'feedback_released',
    subject: { type: 'task_submission', id: 'sub-1' },
  })
  assert.deepEqual(notificationSubject('enrollment_completed', { studentId: 's1' }).subject, {
    type: 'students',
    id: 's1',
  })
  for (const data of [
    { submissionId: 'sub-1', note: 'Puan: 85' },
    {},
    { submissionId: '' },
    { submissionId: 42 },
    null,
  ])
    assert.throws(() => notificationSubject('feedback_released', data), /invalid notification data/)
  assert.throws(() => notificationSubject('toString', {}), /unknown notification kind/)
  assert.throws(() => notificationSubject('bilinmeyen', {}), /unknown notification kind/)
})

test('DOM-YTK-040: bildirim merkezi ya da türün modülü kapalıysa tür üretilmez', () => {
  const on = { communication: true, learning: true, crm: true }
  assert.equal(notificationEnabled('feedback_released', on), true)
  assert.equal(notificationEnabled('feedback_released', { ...on, communication: false }), false)
  assert.equal(notificationEnabled('feedback_released', { ...on, learning: false }), false)
  assert.equal(notificationEnabled('feedback_released', { communication: true }), false)
  assert.equal(notificationEnabled('enrollment_completed', { ...on, learning: false }), true)
  assert.equal(notificationEnabled('enrollment_completed', { ...on, crm: false }), false)
})

test('DOM-BEC-045, DOM-KAY-011: kitle 18 yaş altında ve yetişkinde türün kuralıdır', () => {
  assert.deepEqual(notificationAudiences('feedback_released', true), ['student', 'parent'])
  assert.deepEqual(notificationAudiences('feedback_released', false), ['student'])
  assert.deepEqual(notificationAudiences('enrollment_completed', true), ['parent'])
  assert.deepEqual(notificationAudiences('enrollment_completed', false), ['student'])
})
