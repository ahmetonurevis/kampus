import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type {
  StaffResourceListItem,
  StaffResourceVersion,
} from '@kampus/react-shared/resource-model.ts'
import { resourceFilesLimitMessage } from '@kampus/school-core/content/resource-files.ts'
import {
  coreInputFromForm,
  defaultDraft,
  draftFormSchema,
  draftFromHead,
  emptyGlossaryEntry,
  glossaryFocusAfterRemove,
  glossaryTermId,
  MATERIAL_FILE_REQUIRED,
  MATERIAL_FILE_RULE,
  nextOptionId,
  patchFromDraft,
  previewFromHead,
  rejectSchema,
  resourceRow,
  skillOptionsFor,
  SUBSKILL_OPTIONS,
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
  subskill: null,
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
    files: [],
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

describe('Okuma etkinliği alanları (IST-042, DOM-BEC-006)', () => {
  const withGlossary = (glossary: DraftFormValues['content']['glossary']) => ({
    ...validReading(),
    content: { type: 'reading_passage' as const, body: 'Metin.', glossary },
  })

  test('DOM-BEC-006: sözlükçenin boş örnek cümlesi null olur', () => {
    const parsed = draftFormSchema.parse(
      withGlossary([{ term: 'ferry', meaning: 'vapur', example: '' }]),
    )
    assert.deepEqual(parsed.content, {
      type: 'reading_passage',
      body: 'Metin.',
      glossary: [{ term: 'ferry', meaning: 'vapur', example: null }],
    })
  })

  test('DOM-BEC-006: boş sözlükçe satırı alanın altında Türkçe hata verir', () => {
    const result = draftFormSchema.safeParse(withGlossary([emptyGlossaryEntry()]))
    assert.equal(result.success, false)
    const paths = result.error?.issues.map((issue) => issue.path.join('.'))
    assert.ok(paths?.includes('content.glossary.0.term'))
    assert.ok(paths?.includes('content.glossary.0.meaning'))
  })

  test('DOM-BEC-006: aynı kelime büyük/küçük harf farkıyla da bir kez yer alır', () => {
    const result = draftFormSchema.safeParse(
      withGlossary([
        { term: 'Ferry', meaning: 'vapur', example: null },
        { term: 'ferry', meaning: 'feribot', example: null },
      ]),
    )
    assert.equal(result.success, false)
    assert.deepEqual(result.error?.issues[0]?.path, ['content', 'glossary'])
    assert.equal(result.error?.issues[0]?.message, 'Aynı kelime sözlükçede bir kez yer alır.')
  })

  test('DOM-BEC-006: alt beceri yalnız soruda seçilir; seçenekler core etiketleridir', () => {
    assert.deepEqual(
      SUBSKILL_OPTIONS.map((option) => option.label),
      ['Ana fikir', 'Ayrıntı', 'Çıkarım', 'Kelime bilgisi'],
    )
    const question = {
      ...defaultDraft('question'),
      title: 'Soru',
      content: {
        type: 'question' as const,
        question: {
          questionType: 'multiple_choice' as const,
          stem: 'Where?',
          options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text: `Seçenek ${id}` })),
          imageFileId: null,
        },
      },
      answerKey: {
        questionType: 'multiple_choice' as const,
        correctOptionId: 'a',
        explanation: 'Metnin son cümlesi.',
      },
      tags: { ...validReading().tags, primarySkill: null, subskill: 'inference' as const },
      license: { kind: 'institution_original' as const },
    }
    assert.equal(patchFromDraft(draftFormSchema.parse(question)).tags.subskill, 'inference')
    const reading = draftFormSchema.safeParse({
      ...validReading(),
      tags: { ...validReading().tags, subskill: 'detail' },
    })
    assert.equal(reading.success, false)
    assert.deepEqual(reading.error?.issues[0]?.path, ['tags', 'subskill'])
  })

  test('soru baş sürümünün alt becerisi forma gelir', () => {
    const base = questionHead()
    const values = draftFromHead({ ...base, tags: { ...base.tags, subskill: 'main_idea' } })
    assert.equal(values?.tags?.subskill, 'main_idea')
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

  test('sözlükçeli okuma parçasında başlık düzeltmesi sözlükçeyi silmez (DOM-BEC-006)', () => {
    const glossary = [
      { term: 'shadow', meaning: 'gölge', example: 'A long shadow.' },
      { term: 'light', meaning: 'ışık', example: null },
    ]
    const values = draftFromHead(
      head({ content: { type: 'reading_passage', body: 'Bir metin.', glossary } }),
    )
    assert.ok(values)
    const parsed = draftFormSchema.parse({ ...values, title: 'Yeni başlık' })
    const patch = patchFromDraft(parsed)
    assert.equal(patch.title, 'Yeni başlık')
    assert.deepEqual(patch.content, { type: 'reading_passage', body: 'Bir metin.', glossary })
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

type HeadFile = StaffResourceVersion['files'][number]
const headFile = (id: string, overrides: Partial<HeadFile> = {}): HeadFile => ({
  id,
  name: `${id}.pdf`,
  contentType: 'application/pdf',
  byteSize: 2048,
  purpose: 'material',
  durationMs: null,
  status: 'ready',
  ...overrides,
})

/** Geçerli materyal dosyası formu: verilen dosyalarla. */
function validMaterial(ids: readonly string[]): DraftFormValues {
  return {
    ...defaultDraft('file'),
    title: 'Kesirler çalışma kâğıdı',
    license: { kind: 'institution_original' },
    files: ids.map((id) => ({ id, name: `${id}.pdf` })),
  }
}

describe('Materyal dosyası formu (DOM-KYN-006)', () => {
  test('DOM-KYN-006: dosya listesi sıralı fileIds olur, ana dosya listenin ilkidir', () => {
    const { title, answerKey, tags, license, attributions } = validMaterial([])
    assert.deepEqual(coreInputFromForm(validMaterial(['f2', 'f1'])), {
      title,
      answerKey,
      tags,
      license,
      attributions,
      fileIds: ['f2', 'f1'],
      content: { type: 'file', fileId: 'f2' },
    })
    const parsed = draftFormSchema.parse(validMaterial(['f2', 'f1']))
    assert.deepEqual(parsed.fileIds, ['f2', 'f1'])
    assert.deepEqual(parsed.content, { type: 'file', fileId: 'f2' })
  })

  test('DOM-KYN-006: dosyasız materyal dosya alanında uyarı verir', () => {
    const result = draftFormSchema.safeParse(validMaterial([]))
    assert.equal(result.success, false)
    const issue = result.error?.issues.find((i) => i.path.join('.') === 'files')
    assert.equal(issue?.message, MATERIAL_FILE_REQUIRED)
  })

  test('DOM-KYN-006: sınırı aşan liste core iletisiyle dosya alanında reddedilir', () => {
    const ids = Array.from({ length: MATERIAL_FILE_RULE.maxFiles + 1 }, (_, i) => `f${i}`)
    const result = draftFormSchema.safeParse(validMaterial(ids))
    assert.equal(result.success, false)
    const issue = result.error?.issues.find((i) => i.path.join('.') === 'files')
    assert.equal(issue?.message, resourceFilesLimitMessage(MATERIAL_FILE_RULE.maxFiles))
    assert.equal(
      draftFormSchema.safeParse(validMaterial(ids.slice(0, MATERIAL_FILE_RULE.maxFiles))).success,
      true,
    )
  })

  test('DOM-KYN-006: gövde materyalde fileIds taşır, okuma parçasında liste gönderilmez', () => {
    const material = patchFromDraft(draftFormSchema.parse(validMaterial(['f1', 'f2'])))
    assert.deepEqual(material.fileIds, ['f1', 'f2'])
    assert.equal('fileIds' in patchFromDraft(draftFormSchema.parse(validReading())), false)
  })

  test('DOM-KYN-006: taslak ve yeni sürüm sürümün dosyalarıyla başlar; silinmiş dosya taşınmaz', () => {
    const values = draftFromHead(
      head({
        content: { type: 'file', fileId: 'f1' },
        files: [
          headFile('f1'),
          headFile('f2', { name: null }),
          headFile('f3', { status: 'deleted' }),
        ],
      }),
    )
    assert.equal(values?.content.type, 'file')
    assert.deepEqual(values?.files, [
      { id: 'f1', name: 'f1.pdf' },
      { id: 'f2', name: 'Dosya 2' },
    ])
    // Okuma parçasının (dosyasız) form listesi boştur.
    assert.deepEqual(draftFromHead(head())?.files, [])
  })

  test('materyal dosyası önizlemesi metin yerine dosya listesine bırakılır', () => {
    assert.equal(previewFromHead(head({ content: { type: 'file', fileId: 'f1' } })).kind, 'file')
  })

  test('DOM-BEC-006: sözlükçe satırı silinince odak önceki satıra, satır kalmazsa Kelime ekle düğmesine gider', () => {
    assert.deepEqual(glossaryFocusAfterRemove(2, 3), { kind: 'term', index: 1 })
    assert.deepEqual(glossaryFocusAfterRemove(1, 2), { kind: 'term', index: 0 })
    // İlk satır silinince yeni ilk satır (önceki satır yok).
    assert.deepEqual(glossaryFocusAfterRemove(0, 3), { kind: 'term', index: 0 })
    assert.deepEqual(glossaryFocusAfterRemove(0, 1), { kind: 'add' })
    assert.equal(glossaryTermId(1), 'icerik-sozluk-kelime-1')
  })
})
