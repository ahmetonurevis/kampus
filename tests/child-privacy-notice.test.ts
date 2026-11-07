import assert from 'node:assert/strict'
import test, { describe } from 'node:test'

import {
  CHILD_NOTICE_AGE_RANGE,
  CHILD_NOTICE_TOPICS,
  childNoticeBody,
  childNoticeDraft,
  childNoticeSections,
} from '../packages/school-core/src/lib/child-privacy-notice.ts'
import { publishPrivacyNoticeSchema } from '../packages/school-core/src/lib/privacy-notices.ts'

describe('çocuğa uygun aydınlatma şablonu (IST-018)', () => {
  test('10–14 yaş için ayrı şablon: altı başlık, hepsinin simgesi ve cümleleri var', () => {
    assert.deepEqual(CHILD_NOTICE_AGE_RANGE, { min: 10, max: 14 })
    const sections = childNoticeSections('Akademi Özel Okulları')
    assert.deepEqual(
      sections.map((section) => section.topic),
      [...CHILD_NOTICE_TOPICS],
    )
    for (const section of sections) {
      assert.ok(section.icon.length > 0)
      assert.ok(section.lines.length >= 3)
      for (const line of section.lines) assert.ok(line.length <= 70, `uzun cümle: ${line}`)
    }
  })

  test('kurum adı doldurulur, boş ad yedeğe düşer, yer tutucu kalmaz', () => {
    assert.match(childNoticeBody('Kampüs Dil Akademisi'), /Kampüs Dil Akademisi/)
    assert.match(childNoticeBody('  '), /Okulumuz/)
    assert.doesNotMatch(childNoticeBody('X'), /\{kurum\}/)
  })

  test('taslak öğrenci kitlesine yayımlanabilir girdidir', () => {
    const parsed = publishPrivacyNoticeSchema.parse(childNoticeDraft('Akademi Özel Okulları'))
    assert.equal(parsed.kind, 'notice')
    assert.equal(parsed.kind === 'notice' && parsed.audience, 'ogrenci')
  })
})
