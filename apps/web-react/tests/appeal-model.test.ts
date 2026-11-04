import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { TaskAppeal } from '@kampus/react-shared/use-task-grading.ts'
import {
  APPEAL_OUTCOME_OPTIONS,
  appealBody,
  appealDecisionBody,
  appealDecisionFieldFor,
  appealDecisionFormSchema,
  appealFieldFor,
  appealFormSchema,
  latestAppeal,
  learnerAppealState,
  showsAppealStaleNotice,
  type AppealDecisionFormValues,
} from '../src/pages/tasks/appeal-model.ts'
import { dateTimeLabel } from '../src/pages/tasks/task-model.ts'

const DEADLINE = '2026-11-10T20:59:59.999Z'
const BEFORE = new Date('2026-11-05T09:00:00.000Z')
const AFTER = new Date('2026-11-11T09:00:00.000Z')

const appeal = (extra: Partial<TaskAppeal> = {}): TaskAppeal => ({
  id: 'ap1',
  reason: 'Kriter 2 bandı düşük değerlendirildi.',
  filedAt: '2026-11-06T09:00:00.000Z',
  outcome: null,
  decidedAt: null,
  decisionReason: null,
  ...extra,
})

describe('OG-211 / DOM-BEC-025: kursiyer ve veli itiraz durumu', () => {
  test('süre açık ve itiraz yok: son sürümde "open", metinde son gün yazılır', () => {
    const state = learnerAppealState({ appeal: null, appealDeadline: DEADLINE }, true, BEFORE)
    assert.equal(state.kind, 'open')
    assert.ok(state.kind === 'open' && state.text.includes(dateTimeLabel(DEADLINE)))
  })

  test('sunucu süre vermediyse (duyuru yok, alıştırma) itirazdan hiç söz edilmez', () => {
    assert.deepEqual(learnerAppealState({ appeal: null, appealDeadline: null }, true, BEFORE), {
      kind: 'none',
    })
  })

  test('eski sürümde süre açık görünse de düğme çıkmaz (yalnız son sürüm)', () => {
    assert.deepEqual(
      learnerAppealState({ appeal: null, appealDeadline: DEADLINE }, false, BEFORE),
      { kind: 'none' },
    )
  })

  test('süre dolmuşsa düğme yerine durum metni (expired)', () => {
    const state = learnerAppealState({ appeal: null, appealDeadline: DEADLINE }, true, AFTER)
    assert.equal(state.kind, 'expired')
    assert.ok(state.kind === 'expired' && state.text.startsWith('İtiraz süresi doldu'))
  })

  test('açık itiraz: "filed" ve gerekçe; süre dolsa da itiraz durumu korunur', () => {
    const state = learnerAppealState({ appeal: appeal(), appealDeadline: null }, true, AFTER)
    assert.equal(state.kind, 'filed')
    assert.ok(state.kind === 'filed' && state.reason === 'Kriter 2 bandı düşük değerlendirildi.')
  })

  test('karara bağlanmış itiraz: kabul yeşil, ret gri; karar gerekçesi taşınır', () => {
    const upheld = learnerAppealState(
      {
        appeal: appeal({
          outcome: 'upheld',
          decidedAt: '2026-11-08T09:00:00.000Z',
          decisionReason: 'Bant 3 olmalı.',
        }),
        appealDeadline: null,
      },
      true,
      BEFORE,
    )
    assert.ok(upheld.kind === 'decided')
    assert.equal(upheld.tone, 'green')
    assert.equal(upheld.label, 'Kabul edildi')
    assert.equal(upheld.reason, 'Bant 3 olmalı.')
    const rejected = learnerAppealState(
      { appeal: appeal({ outcome: 'rejected', decisionReason: null }), appealDeadline: null },
      false,
      BEFORE,
    )
    assert.ok(rejected.kind === 'decided')
    assert.equal(rejected.tone, 'gray')
    assert.equal(rejected.label, 'Reddedildi')
    assert.equal(rejected.reason, null)
  })
})

describe('OG-211 / DOM-BEC-025: itiraz formu ve gövdesi', () => {
  test('gerekçe 10 karakterden kısa ya da boşsa çekirdek Türkçe mesajla reddeder', () => {
    const empty = appealFormSchema.safeParse({ reason: '' })
    assert.equal(empty.success, false)
    assert.equal(empty.error?.issues[0]?.message, 'İtiraz gerekçesini yazın.')
    assert.equal(appealFormSchema.safeParse({ reason: 'kısa' }).success, false)
    assert.equal(
      appealFormSchema.safeParse({ reason: 'Yeterince uzun bir gerekçe.' }).success,
      true,
    )
  })

  test('gövde sürüm numarasını ekler ve gerekçeyi kırpar', () => {
    assert.deepEqual(appealBody({ reason: '  Gerekçem burada yazılı.  ' }, 2), {
      versionNumber: 2,
      reason: 'Gerekçem burada yazılı.',
    })
  })

  test('sunucu hata yolu: yalnız reason alana, kalanı root.server', () => {
    assert.equal(appealFieldFor('reason'), 'reason')
    assert.equal(appealFieldFor('versionNumber'), 'root.server')
  })
})

const values = (extra: Partial<AppealDecisionFormValues> = {}): AppealDecisionFormValues => ({
  outcome: null,
  reason: '',
  criteria: [
    { criterionId: 'task', band: 4, comment: '' },
    { criterionId: 'grammar', band: 1, comment: 'Zaman hataları var.' },
  ],
  overallComment: 'Yeniden değerlendirildi.',
  ...extra,
})

describe('OG-211 / DOM-BEC-025: öğretmenin karar formu', () => {
  test('karar seçilmeden kaydedilmez: "Kararı seçin."', () => {
    const result = appealDecisionFormSchema.safeParse(values({ reason: 'Gerekçe yazıldı.' }))
    assert.equal(result.success, false)
    assert.ok(result.error?.issues.some((issue) => issue.message === 'Kararı seçin.'))
  })

  test('ret yalnız gerekçe ister; puan alanları boş olsa da geçer', () => {
    const ok = appealDecisionFormSchema.safeParse(
      values({ outcome: 'rejected', reason: 'Puan doğru.', criteria: [], overallComment: '' }),
    )
    assert.equal(ok.success, true)
    const noReason = appealDecisionFormSchema.safeParse(values({ outcome: 'rejected', reason: '' }))
    assert.equal(noReason.success, false)
  })

  test('kabul yeni rubrik puanını da sınar: bantsız kriter ve hedef altı yorumsuz bant reddedilir', () => {
    const noBand = appealDecisionFormSchema.safeParse(
      values({
        outcome: 'upheld',
        reason: 'Bant yükseltildi.',
        criteria: [{ criterionId: 'task', band: null, comment: '' }],
      }),
    )
    assert.equal(noBand.success, false)
    const lowBandNoComment = appealDecisionFormSchema.safeParse(
      values({
        outcome: 'upheld',
        reason: 'Bant yükseltildi.',
        criteria: [{ criterionId: 'task', band: 1, comment: '' }],
      }),
    )
    assert.equal(lowBandNoComment.success, false)
    const ok = appealDecisionFormSchema.safeParse(
      values({ outcome: 'upheld', reason: 'Bant yükseltildi.' }),
    )
    assert.equal(ok.success, true)
  })

  test('ret gövdesi yalnız karar ve gerekçe taşır', () => {
    assert.deepEqual(
      appealDecisionBody(values({ outcome: 'rejected', reason: '  Puan doğru.  ' })),
      { outcome: 'rejected', reason: 'Puan doğru.' },
    )
  })

  test('kabul gövdesi yeni puanı taşır; sunucu katı olduğundan sürüm numarası ve toplam gönderilmez', () => {
    const body = appealDecisionBody(values({ outcome: 'upheld', reason: 'Bant yükseltildi.' }))
    assert.equal(body.outcome, 'upheld')
    assert.ok(body.outcome === 'upheld')
    assert.equal('versionNumber' in body.score, false)
    assert.deepEqual(body.score.criteria, [
      { criterionId: 'task', band: 4, comment: null },
      { criterionId: 'grammar', band: 1, comment: 'Zaman hataları var.' },
    ])
    assert.equal('total' in body.score, false)
  })

  test('seçenekler çekirdek karar etiketlerindendir', () => {
    assert.deepEqual(
      APPEAL_OUTCOME_OPTIONS.map((option) => option.label),
      ['Kabul edildi', 'Reddedildi'],
    )
  })

  test('sunucu hata yolu: kabuldeki score öneki atılır, tanınmayan yol root.server olur', () => {
    assert.equal(appealDecisionFieldFor('reason'), 'reason')
    assert.equal(appealDecisionFieldFor('score.criteria.1.band'), 'criteria.1.band')
    assert.equal(appealDecisionFieldFor('score.overallComment'), 'overallComment')
    assert.equal(appealDecisionFieldFor('outcome'), 'outcome')
    assert.equal(appealDecisionFieldFor('score.versionNumber'), 'root.server')
  })

  test('eskime hataları (sürüm çakışması, karar verilmiş, sürüm yok) uyarı olur; bağımsızlık hatası toast kalır', () => {
    for (const code of ['version_conflict', 'appeal_decided', 'submission_version_not_found'])
      assert.equal(showsAppealStaleNotice({ code }), true, code)
    assert.equal(showsAppealStaleNotice({ code: 'rater_not_independent' }), false)
    assert.equal(showsAppealStaleNotice({ code: 'forbidden' }), false)
  })
})

describe('OG-211 / DOM-BEC-025: öğretmen penceresinde son sürümün itirazı', () => {
  test('yalnız son sürümün itirazı döner; numarası ile birlikte', () => {
    const versions = [
      { number: 1, appeal: appeal({ id: 'eski' }) },
      { number: 2, appeal: appeal({ id: 'yeni' }) },
    ] as never
    const found = latestAppeal({ versions })
    assert.equal(found?.appeal.id, 'yeni')
    assert.equal(found?.versionNumber, 2)
  })

  test('son sürümde itiraz yoksa ya da sürüm yoksa null', () => {
    assert.equal(
      latestAppeal({
        versions: [
          { number: 1, appeal: appeal() },
          { number: 2, appeal: null },
        ] as never,
      }),
      null,
    )
    assert.equal(latestAppeal({ versions: [] }), null)
  })
})
