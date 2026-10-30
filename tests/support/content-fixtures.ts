import {
  planNewResource,
  type ContentActor,
  type ResourceRecord,
  type ResourceVersion,
  type ResourceVersionInput,
  type ResourceVersionMeta,
} from '../../packages/school-core/src/content/resource.ts'

/** İçerik havuzu testlerinin sabit saati ve aktörleri; kimlikler `test-` önekli. */
export const now = '2026-10-06T10:00:00.000Z'

export const author: ContentActor = {
  role: 'ogretmen',
  userId: 'test-u-author',
  subjectIds: ['math'],
}
export const colleague: ContentActor = {
  role: 'ogretmen',
  userId: 'test-u-colleague',
  subjectIds: ['math'],
}
export const outsider: ContentActor = {
  role: 'ogretmen',
  userId: 'test-u-outsider',
  subjectIds: ['history'],
}
export const head: ContentActor = {
  role: 'ogretmen',
  userId: 'test-u-head',
  subjectIds: ['math'],
  reviewer: { subjectIds: ['math'], cefrLevels: [] },
}
export const coordinator: ContentActor = {
  role: 'ogretmen',
  userId: 'test-u-coordinator',
  subjectIds: ['english'],
  reviewer: { subjectIds: [], cefrLevels: ['B1'] },
}
export const admin: ContentActor = { role: 'yonetici', userId: 'test-u-admin' }
export const frontDesk: ContentActor = { role: 'onburo', userId: 'test-u-frontdesk' }
export const student: ContentActor = { role: 'ogrenci', userId: 'test-u-student' }

/** `school` kurumunda yayımlanabilir kurum özgün metin. */
export function schoolText(overrides: Partial<ResourceVersionInput> = {}): ResourceVersionInput {
  return {
    title: 'Kesirlerle toplama',
    content: { type: 'text', body: 'Paydaları eşitleyerek toplarız.' },
    tags: {
      subjectId: 'math',
      gradeLevels: [7],
      outcomes: [{ outcomeId: 'test-o-m7', outcomeSource: 'platform' }],
      durationMinutes: 20,
      difficulty: 'medium',
    },
    license: { kind: 'institution_original' },
    ...overrides,
  }
}

/** `language_school` kurumunda yayımlanabilir okuma parçası. */
export function languagePassage(
  overrides: Partial<ResourceVersionInput> = {},
): ResourceVersionInput {
  return {
    title: 'A day in Istanbul',
    content: { type: 'reading_passage', body: 'Istanbul is a large city. It has two sides.' },
    tags: { cefrLevel: 'B1', primarySkill: 'reading' },
    license: { kind: 'institution_original' },
    ...overrides,
  }
}

/** Yayımlanabilir çoktan seçmeli İngilizce soru (iki kurum türünde de). */
export function multipleChoice(
  overrides: Partial<ResourceVersionInput> = {},
): ResourceVersionInput {
  return {
    title: 'Past simple',
    content: {
      type: 'question',
      question: {
        questionType: 'multiple_choice',
        stem: 'Yesterday I ___ to school.',
        options: [
          { id: 'a', text: 'go' },
          { id: 'b', text: 'went' },
          { id: 'c', text: 'gone' },
          { id: 'd', text: 'going' },
        ],
      },
    },
    answerKey: {
      questionType: 'multiple_choice',
      correctOptionId: 'b',
      explanation: 'Geçmiş zaman: went.',
    },
    tags: {
      subjectId: 'english',
      gradeLevels: [7],
      cefrLevel: 'A2',
      primarySkill: 'language_use',
      outcomes: [{ outcomeId: 'test-o-e7', outcomeSource: 'platform' }],
    },
    license: { kind: 'institution_original' },
    ...overrides,
  }
}

type Built = { resource: ResourceRecord; version: ResourceVersion }

/** Kaynak + sürüm; sahip/yazar `author`, yalnız istenen alanlar değişir. */
export function build(
  input: ResourceVersionInput,
  options: {
    owner?: ContentActor
    id?: string
    resource?: Partial<ResourceRecord>
    version?: Partial<ResourceVersionMeta>
  } = {},
): Built {
  const id = options.id ?? 'test-r1'
  const created = planNewResource({
    actor: options.owner ?? author,
    input,
    ids: { resourceId: id, versionId: `${id}-v1` },
    now,
  })
  const version = { ...created.version, ...options.version }
  return {
    resource: {
      ...created.resource,
      currentVersionId: version.status === 'published' ? version.id : null,
      ...options.resource,
    },
    version,
  }
}
