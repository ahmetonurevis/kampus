import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  reasonSchema,
  removalNotice,
  REMOVE_SUCCESS,
  SHARE_SCOPE_NOTES,
  SHARE_SCOPE_OPTIONS,
  shareBody,
  shareDefaults,
  shareErrorField,
  shareFormSchema,
} from '../src/pages/content/content-actions-model.ts'

describe('İçerik paylaşım formu (DOM-KYN-040)', () => {
  test('DOM-KYN-040: başlangıç kaynağın kayıtlı paylaşımıdır; listeler kopyalanır', () => {
    const resource = {
      shareScope: 'classes' as const,
      sharedClassIds: ['c1'],
      sharedStudentIds: [],
    }
    const values = shareDefaults(resource)
    assert.deepEqual(values, { scope: 'classes', classIds: ['c1'], studentIds: [] })
    values.classIds.push('c2')
    assert.deepEqual(resource.sharedClassIds, ['c1'])
  })

  test('DOM-KYN-040: gövdeye yalnız seçilen kapsamın listesi girer', () => {
    assert.deepEqual(shareBody({ scope: 'students', classIds: ['c1'], studentIds: ['s1'] }), {
      scope: 'students',
      studentIds: ['s1'],
      classIds: [],
    })
    assert.deepEqual(shareBody({ scope: 'institution', classIds: ['c1'], studentIds: ['s1'] }), {
      scope: 'institution',
      studentIds: [],
      classIds: [],
    })
  })

  test('DOM-KYN-040: sınıf kapsamında sınıf seçilmezse alan hatası çıkar', () => {
    const result = shareFormSchema.safeParse({ scope: 'classes', classIds: [], studentIds: ['s1'] })
    assert.equal(result.success, false)
    assert.deepEqual(
      result.error?.issues.map((issue) => [issue.path.join('.'), issue.message]),
      [['classIds', 'En az bir sınıf seçin.']],
    )
  })

  test('DOM-KYN-040: kapsam seçenekleri core sırasıyla gelir, her birinin açıklaması vardır', () => {
    assert.deepEqual(
      SHARE_SCOPE_OPTIONS.map((option) => option.value),
      ['private', 'students', 'classes', 'department', 'institution'],
    )
    for (const option of SHARE_SCOPE_OPTIONS) assert.ok(SHARE_SCOPE_NOTES[option.value])
  })

  test('DOM-KYN-021, 031: hedef hatası listeye, lisans ve onay engeli kapsam alanına bağlanır', () => {
    assert.equal(shareErrorField({ code: 'share_target_out_of_scope' }, 'classes'), 'classIds')
    assert.equal(shareErrorField({ code: 'share_target_not_found' }, 'students'), 'studentIds')
    assert.equal(shareErrorField({ code: 'license_restricts_share' }, 'classes'), 'scope')
    assert.equal(shareErrorField({ code: 'share_scope_review_required' }, 'institution'), 'scope')
    assert.equal(shareErrorField({ code: 'resource_action_forbidden' }, 'classes'), undefined)
  })
})

describe('Telif bildirimi ve kaldırma gerekçesi (DOM-KYN-025, 051)', () => {
  test('DOM-KYN-025: kısa gerekçe reddedilir, yeterli gerekçe kırpılarak kabul edilir', () => {
    assert.equal(reasonSchema.safeParse({ reason: 'yok' }).success, false)
    const parsed = reasonSchema.safeParse({ reason: '  Yayınevi sayfası izinsiz yüklenmiş.  ' })
    assert.equal(parsed.success, true)
    assert.equal(parsed.data?.reason, 'Yayınevi sayfası izinsiz yüklenmiş.')
  })

  test('DOM-KYN-051: kaldırma bildirimi etkilenen kopya ve quiz sayısını söyler', () => {
    assert.equal(
      removalNotice({ affectedCopyIds: [], affectedContainerVersionIds: [] }),
      REMOVE_SUCCESS,
    )
    assert.equal(
      removalNotice({ affectedCopyIds: ['c1', 'c2'], affectedContainerVersionIds: ['q1'] }),
      'İçerik kaldırıldı. 2 kopyayı ayrıca inceleyin; 1 quiz veya alıştırma sürümü bu içeriği kullanıyor.',
    )
  })
})
