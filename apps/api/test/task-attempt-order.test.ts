import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import {
  seededRandom,
  shuffleItemOrder,
  type ResourceVersionInput,
} from '@kampus/school-core/content/resource.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  FIXED_NOW,
  signInAs,
  TEST_ORIGIN,
} from './support/app.ts'
import { seedResource } from './support/resources-sample.ts'

/**
 * Quiz soru sırası (OG-249; DOM-BEC-010, DOM-BEC-045): `shuffleItems` açıkken sorular deneme
 * kimliğinden tohumlu sırayla gelir; sayfa yenilenince sıra aynıdır, denemeler arasında değişebilir.
 * Puanlama ve sonuç madde kimliğiyle çalışır. Kursiyer ve veli denemenin sırasını görür, personel
 * inceleme ve sonuçta yazarın sırasını. Ayrı dosyadadır: `task-attempts.test.ts` istek hız
 * sınırına yakındır (uygulama başına 300/dk).
 */

type Json = ReturnType<typeof JSON.parse>

const OPTION_IDS = ['a', 'b', 'c', 'd'] as const
const DUE = '2026-10-20T20:59:00.000Z'

const question = (stem: string, correctOptionId: string): Partial<ResourceVersionInput> => ({
  title: `Soru: ${stem}`,
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem,
      options: OPTION_IDS.map((id) => ({ id, text: `Seçenek ${id}` })),
    },
  },
  answerKey: { questionType: 'multiple_choice', correctOptionId, explanation: 'Açıklama.' },
  license: { kind: 'institution_original' },
  tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'reading', cefrLevel: 'A2' },
})

const choice = (optionId: string) => ({ questionType: 'multiple_choice', optionId })

describe('quiz soru sırası (shuffleItems)', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App
  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db, { clock: () => FIXED_NOW })
  })
  after(async () => {
    await app.close()
    await close()
  })

  /** 9-A'nın öğretmeni, öğrencisi Deniz ve velisi. */
  async function tenant() {
    const institution = await createInstitution(app)
    await insertMissingRecords(
      db,
      institution.id,
      [
        {
          collection: 'teachers',
          id: 't-eng',
          data: { id: 't-eng', name: 'Selin Kaya', subjectId: 'ingilizce', branchId: 'b-1' },
        },
        {
          collection: 'classes',
          id: '9-A',
          data: { id: '9-A', grade: 9, level: '9', branchId: 'b-1', teacherId: 't-eng' },
        },
        {
          collection: 'students',
          id: 's-1',
          data: { id: 's-1', name: 'Deniz Yılmaz', classId: '9-A', isActive: true },
        },
        {
          collection: 'assignments',
          id: 'as-1',
          data: { id: 'as-1', classId: '9-A', teacherId: 't-eng', subjectId: 'ingilizce' },
        },
      ],
      FIXED_NOW,
    )
    const member = (role: 'ogretmen' | 'ogrenci' | 'veli', kind: string, recordId: string) =>
      createMember(app, institution.id, role, [{ kind, recordId } as never])
    const teacher = await member('ogretmen', 'teacher', 't-eng')
    const cookies = {
      teacher: await signInAs(app, teacher),
      student: await signInAs(app, await member('ogrenci', 'student', 's-1')),
      parent: await signInAs(app, await member('veli', 'child', 's-1')),
    }
    const seed = async (input: Partial<ResourceVersionInput>) =>
      (
        await seedResource(db, institution.id, {
          ownerUserId: teacher.id,
          versions: [{ status: 'published', input }],
        })
      ).versions[0]!.id
    return { cookies, seed }
  }
  type Tenant = Awaited<ReturnType<typeof tenant>>

  /** `count` sorulu quiz; `i`. sorunun doğru seçeneği `OPTION_IDS[i % 4]`, her soru 1 puan. */
  async function seedQuiz(t: Tenant, count: number, shuffleItems: boolean) {
    const ids: string[] = []
    for (let i = 0; i < count; i += 1)
      ids.push(await t.seed(question(`Soru ${i + 1}?`, OPTION_IDS[i % 4]!)))
    const quizId = await t.seed({
      title: `Quiz karışık=${shuffleItems}`,
      content: {
        type: 'quiz',
        items: ids.map((questionVersionId) => ({ questionVersionId, points: 1 })),
        shuffleItems,
      },
      license: { kind: 'institution_original' },
      tags: { subjectId: 'ingilizce', gradeLevels: [9], primarySkill: 'reading', cefrLevel: 'A2' },
    })
    return { ids, quizId }
  }

  function call(
    method: 'GET' | 'POST',
    url: string,
    cookie: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) {
    return app.inject({
      method,
      url: `/api/v1${url}`,
      headers: {
        origin: TEST_ORIGIN,
        cookie,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    })
  }
  async function ok(response: Awaited<ReturnType<typeof call>>, status = 200) {
    assert.equal(response.statusCode, status, response.body)
    return response.json().data as Json
  }
  const key = () => ({ 'idempotency-key': randomUUID() })

  async function assignPractice(t: Tenant, resourceVersionId: string) {
    const data = await ok(
      await call(
        'POST',
        '/task-assignments',
        t.cookies.teacher,
        {
          resourceVersionId,
          settings: { deadline: { dueAt: DUE }, attempts: { kind: 'practice' } },
          targets: [{ kind: 'class', id: '9-A' }],
        },
        key(),
      ),
      201,
    )
    return data.id as string
  }
  const start = async (assignmentId: string, cookie: string) =>
    ok(await call('POST', `/task-assignments/${assignmentId}/attempts`, cookie, {}, key()), 201)
  const read = async (attemptId: string, cookie: string) =>
    ok(await call('GET', `/task-attempts/${attemptId}`, cookie))
  const submit = async (attempt: Json, cookie: string, answers: unknown) =>
    ok(
      await call(
        'POST',
        `/task-attempts/${attempt.id}/submit`,
        cookie,
        { answers },
        { ...key(), 'if-match': `"${attempt.rowVersion}"` },
      ),
    )

  const questionOrder = (detail: Json): string[] =>
    detail.questions.map((q: Json) => q.questionVersionId)
  const idsOf = (rows: Json[]): string[] => rows.map((row) => row.questionVersionId)

  test('OG-249, DOM-BEC-010: shuffleItems açıkken sıra deneme kimliğinden tohumludur; aynı denemede okumalar arasında sabit, personel yazarın sırasında', async () => {
    const t = await tenant()
    const { ids, quizId } = await seedQuiz(t, 12, true)
    const assignmentId = await assignPractice(t, quizId)
    // Beklenen sıra core karıştırıcıyla deneme kimliğinden kurulur: tohum sözleşmesi budur.
    const expected = (attemptId: string) =>
      idsOf(
        shuffleItemOrder(
          ids.map((questionVersionId) => ({ questionVersionId })),
          true,
          seededRandom(`${attemptId}:items`),
        ),
      )

    const first = await start(assignmentId, t.cookies.student)
    const firstOrder = questionOrder(first)
    assert.deepEqual(firstOrder, expected(first.id))
    assert.deepEqual([...firstOrder].sort(), [...ids].sort())

    // Sayfa yenilenince (iki okuma) aynı sıra; veli aynı sırayı görür; öğretmen yazarın sırasını.
    for (let reads = 0; reads < 2; reads += 1)
      assert.deepEqual(questionOrder(await read(first.id, t.cookies.student)), firstOrder)
    assert.deepEqual(questionOrder(await read(first.id, t.cookies.parent)), firstOrder)
    assert.deepEqual(questionOrder(await read(first.id, t.cookies.teacher)), ids)

    // İkinci deneme kendi tohumuyla sıralanır; iki denemeden en az biri yazarın sırasından farklıdır
    // (12 maddede özdeş dizilim olasılığı 1/12!).
    await submit(first, t.cookies.student, {})
    const second = await start(assignmentId, t.cookies.student)
    assert.deepEqual(questionOrder(second), expected(second.id))
    assert.ok(firstOrder.join() !== ids.join() || questionOrder(second).join() !== ids.join())
  })

  test('OG-249, DOM-BEC-010: shuffleItems kapalıyken ve tek soruda sorular yazarın sırasında gelir', async () => {
    const t = await tenant()
    const { ids, quizId } = await seedQuiz(t, 12, false)
    const started = await start(await assignPractice(t, quizId), t.cookies.student)
    assert.deepEqual(questionOrder(started), ids)
    assert.deepEqual(questionOrder(await read(started.id, t.cookies.student)), ids)

    const single = await t.seed(question('Tek soru?', 'b'))
    const alone = await start(await assignPractice(t, single), t.cookies.student)
    assert.deepEqual(questionOrder(alone), [single])
  })

  test('OG-249, DOM-BEC-010, DOM-BEC-045: karıştırılmış sırada cevaplar madde kimliğiyle puanlanır; kursiyerin sonuç ve anahtar listesi soru sırasıyla, personelinki yazarın sırasıyla gelir', async () => {
    const t = await tenant()
    const { ids, quizId } = await seedQuiz(t, 12, true)
    const started = await start(await assignPractice(t, quizId), t.cookies.student)
    const shown = questionOrder(started)
    assert.notDeepEqual(shown, ids, 'bu tohumla sıra yazarınkinden farklı olmalı')

    // Karışık sırada cevaplanır; yazarın 4. sorusu bilerek yanlış, gerisi doğru.
    const wrong = ids[3]!
    const answers = Object.fromEntries(
      shown.map((id) => {
        const index = ids.indexOf(id)
        return [id, choice(OPTION_IDS[(index + (id === wrong ? 1 : 0)) % 4]!)]
      }),
    )
    const submitted = await submit(started, t.cookies.student, answers)
    assert.deepEqual(
      [submitted.result.earned, submitted.result.possible, submitted.result.percent],
      [11, 12, 92],
    )

    const learnerView = await read(started.id, t.cookies.student)
    const staffView = await read(started.id, t.cookies.teacher)
    for (const view of [learnerView, staffView]) {
      assert.equal(view.result.earned, 11)
      assert.equal(
        view.result.items.find((item: Json) => item.questionVersionId === wrong).earned,
        0,
      )
      assert.equal(view.result.items.filter((item: Json) => item.earned === 1).length, 11)
      assert.notEqual(view.result.answerKey, null)
    }
    assert.deepEqual(idsOf(learnerView.result.items), shown)
    assert.deepEqual(idsOf(learnerView.result.answerKey), shown)
    assert.deepEqual(idsOf(staffView.result.items), ids)
    assert.deepEqual(idsOf(staffView.result.answerKey), ids)
    assert.deepEqual(questionOrder(staffView), ids)
  })
})
