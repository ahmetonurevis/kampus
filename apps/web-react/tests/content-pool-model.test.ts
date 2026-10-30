import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type {
  StaffResourceListItem,
  StaffResourceVersion,
} from '@kampus/react-shared/resource-model.ts'
import {
  defaultDraft,
  draftFormSchema,
  draftFromHead,
  nextOptionId,
  patchFromDraft,
  previewFromHead,
  rejectSchema,
  resourceRow,
  skillOptionsFor,
  tagSummary,
  type DraftFormValues,
} from '../src/pages/content/content-pool-model.ts'

const TAGS: StaffResourceVersion['tags'] = {
  subjectId: 'english',
  gradeLevels: [7],
  cefrLevel: 'B1',
  primarySkill: 'reading',
  skills: ['reading'],
  activityMode: null,
  interactionChannel: null,
  mediation: null,
  durationMinutes: null,
  difficulty: null,
  outcomes: [{ outcomeId: 'ENG.7.1', outcomeSource: 'institution' }],
}

const subjects = new Map([['english', 'İngilizce']])

function head(overrides: Partial<StaffResourceVersion> = {}): StaffResourceVersion {
  return {
    id: 'v1',
    versionNumber: 1,
    status: 'draft',
    title: 'Işık ve gölge',
    authorUserId: 'u1',
    tags: TAGS,
    licenseKind: 'institution_original',
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    removedAt: null,
    content: { type: 'reading_passage', body: 'Bir metin.' },
    answerKey: null,
    license: { kind: 'institution_original' },
    attributions: [],
    submittedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    removalReason: null,
    rowVersion: 3,
    ...overrides,
  } as StaffResourceVersion
}

const questionHead = () =>
  head({
    content: {
      type: 'question',
      question: {
        questionType: 'multiple_choice',
        stem: 'Which is a fruit?',
        options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `Seçenek ${id}` })),
        imageFileId: null,
      },
    },
    answerKey: {
      questionType: 'multiple_choice',
      correctOptionId: 'c',
      explanation: 'C meyvedir.',
    },
  })

/** Geçerli okuma parçası formu; testler tek alanı bozar. */
function validReading(): DraftFormValues {
  return {
    ...defaultDraft('reading_passage'),
    title: 'Okuma',
    content: { type: 'reading_passage', body: 'Metin.' },
    tags: { ...defaultDraft('reading_passage').tags, subjectId: 'english', gradeLevels: [7] },
    license: { kind: 'institution_original' },
  }
}

describe('İçerik havuzu satırı (IST-031)', () => {
  test('satır başlık, tür, etiket özeti, durum ve lisansı Türkçe etiketle verir', () => {
    const item = {
      view: 'staff',
      id: 'r1',
      contentType: 'reading_passage',
      updatedAt: '2026-10-30T08:00:00.000Z',
      version: head({ status: 'in_review' }),
    } as unknown as StaffResourceListItem
    const row = resourceRow(item, subjects)
    assert.equal(row.title, 'Işık ve gölge')
    assert.equal(row.type, 'Okuma parçası')
    assert.equal(row.status, 'İncelemede')
    assert.equal(row.license, 'Kurum özgün')
    assert.equal(row.tags, 'İngilizce · 7. sınıf · B1 · Okuma')
  })

  test('etiketi olmayan içerik tire gösterir', () => {
    assert.equal(
      tagSummary(
        { ...TAGS, subjectId: null, gradeLevels: [], cefrLevel: null, primarySkill: null },
        subjects,
      ),
      '—',
    )
  })
})

describe('Taslak formu şeması (DOM-KYN-020, 002)', () => {
  test('DOM-KYN-020: lisans seçilmeden form geçmez', () => {
    const result = draftFormSchema.safeParse({ ...validReading(), license: null })
    assert.equal(result.success, false)
    assert.deepEqual(result.error?.issues[0]?.path, ['license'])
  })

  test('geçerli okuma parçası geçer', () => {
    assert.equal(draftFormSchema.safeParse(validReading()).success, true)
  })

  test('desteklenmeyen içerik türü reddedilir', () => {
    const result = draftFormSchema.safeParse({
      ...validReading(),
      content: { type: 'text', body: 'x' },
    })
    assert.equal(result.success, false)
    assert.deepEqual(result.error?.issues.find((i) => i.message.includes('henüz'))?.path, [
      'content',
      'type',
    ])
  })

  test('DOM-KYN-002: çoktan seçmeli soru en az dört seçenek ve cevap anahtarı ister', () => {
    const base = {
      ...defaultDraft('question'),
      title: 'Soru',
      license: { kind: 'institution_original' },
    }
    const three = structuredClone(base)
    three.content.question!.options = three.content.question!.options.slice(0, 3)
    assert.equal(draftFormSchema.safeParse(three).success, false)
    assert.equal(draftFormSchema.safeParse({ ...base, answerKey: null }).success, false)
  })

  test('çoktan seçmeli dışı soru türü reddedilir', () => {
    const result = draftFormSchema.safeParse({
      title: 'Soru',
      content: {
        type: 'question',
        question: { questionType: 'true_false', stem: 'Doğru mu?', allowNotGiven: false },
      },
      answerKey: { questionType: 'true_false', answer: 'true', explanation: 'Çünkü.' },
      license: { kind: 'institution_original' },
    })
    assert.equal(result.success, false)
  })

  test('DOM-KYN-024: açık lisans kaynak gösterimi ister değil ama tür ve lisans doğrulanır', () => {
    const result = draftFormSchema.safeParse({
      ...validReading(),
      license: { kind: 'public_domain', basisNote: '' },
    })
    assert.equal(result.success, false)
  })
})

describe('Taslaktan form değeri ve PATCH gövdesi', () => {
  test('okuma parçası baş sürümü forma çevrilir', () => {
    const values = draftFromHead(head())
    assert.equal(values?.content.type, 'reading_passage')
    assert.equal(values?.content.body, 'Bir metin.')
    assert.deepEqual(values?.license, { kind: 'institution_original' })
  })

  test('soru baş sürümünde seçenekler ve doğru cevap korunur', () => {
    const values = draftFromHead(questionHead())
    assert.equal(values?.content.question?.options.length, 4)
    assert.equal(values?.answerKey?.correctOptionId, 'c')
  })

  test('lisansı olmayan eksik taslak düzenlenebilir (form doğrulaması sonra yakalar)', () => {
    const values = draftFromHead(head({ license: null, licenseKind: null }))
    assert.equal(values?.license, null)
  })

  test('desteklenmeyen tür ve kaldırılmış sürüm için null', () => {
    assert.equal(draftFromHead(head({ content: { type: 'link', url: 'https://a.example' } })), null)
    assert.equal(draftFromHead(head({ content: null, status: 'removed' })), null)
  })

  test('PATCH gövdesi taslağın bütün alanlarını taşır', () => {
    const parsed = draftFormSchema.parse(validReading())
    assert.deepEqual(Object.keys(patchFromDraft(parsed)).sort(), [
      'answerKey',
      'attributions',
      'content',
      'license',
      'tags',
      'title',
    ])
  })
})

describe('Önizleme, seçenek kimlikleri ve ret gerekçesi', () => {
  test('önizleme okuma metnini ve soruda doğru cevabı işaretler', () => {
    assert.deepEqual(previewFromHead(head()), { kind: 'reading', body: 'Bir metin.' })
    const preview = previewFromHead(questionHead())
    assert.equal(
      preview.kind === 'question' && preview.options.filter((o) => o.correct)[0]?.id,
      'c',
    )
    assert.equal(previewFromHead(head({ content: null, status: 'removed' })).kind, 'removed')
  })

  test('yeni seçenek kullanılmayan ilk kimliği alır; sekiz seçenekte kimlik kalmaz', () => {
    assert.equal(nextOptionId(['a', 'b', 'd']), 'c')
    assert.equal(nextOptionId(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), null)
  })

  test('dil kullanımı okuma parçasında birincil beceri olamaz, soruda olabilir; aracılık yok', () => {
    const reading = skillOptionsFor('reading_passage').map((o) => o.value)
    assert.ok(!reading.includes('language_use'))
    assert.ok(skillOptionsFor('question').some((o) => o.value === 'language_use'))
    assert.ok(!skillOptionsFor('question').some((o) => o.value === 'mediation'))
  })

  test('DOM-KYN-025: ret gerekçesi en az beş karakter ister', () => {
    assert.equal(rejectSchema.safeParse({ reason: 'kısa' }).success, false)
    assert.equal(rejectSchema.safeParse({ reason: 'Kaynak eksik.' }).success, true)
  })
})
