import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { institutionKey } from '../src/query-keys.ts'
import {
  fetchSkillProgress,
  SKILL_PROGRESS_KEY,
  type SkillProgress,
} from '../src/skill-progress.ts'

// OG-080 (IST-057; DOM-BEC-035): beceri ilerleme panosu isteği, anahtarı ve kapsam dışı hatası.

function fakeClient(reply: () => Response) {
  const sent: { method: string; path: string }[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      sent.push({ method: request.method, path: new URL(request.url).pathname })
      return reply()
    },
  })
  return { client, sent }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const ASSIGNMENT_ID = '00000000-0000-4000-8000-0000a0000001'
const ATTEMPT_ID = '00000000-0000-4000-8000-0000a0000002'

const progress: SkillProgress = {
  studentId: 's1',
  computedAt: '2026-11-03T09:00:00.000Z',
  skills: [
    {
      skill: 'reading',
      label: 'Okuma',
      points: [
        {
          assignmentId: ASSIGNMENT_ID,
          attemptId: ATTEMPT_ID,
          submissionId: null,
          title: 'Okuma quizi',
          performedAt: '2026-11-01T09:00:00.000Z',
          percent: 75,
        },
      ],
      latest: 75,
      trend: null,
    },
    { skill: 'listening', label: 'Dinleme', points: [], latest: null, trend: null },
    { skill: 'writing', label: 'Yazma', points: [], latest: null, trend: null },
    { skill: 'speaking', label: 'Konuşma', points: [], latest: null, trend: null },
  ],
}

describe('beceri ilerleme panosu istemcisi', () => {
  test('DOM-BEC-035: pano öğrenci yolundan okunur ve dört beceri döner', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: progress }))
    const body = await fetchSkillProgress(client, 's1')
    assert.deepEqual(sent, [{ method: 'GET', path: '/api/v1/students/s1/skill-progress' }])
    assert.deepEqual(
      body.data.skills.map((curve) => curve.skill),
      ['reading', 'listening', 'writing', 'speaking'],
    )
    assert.equal(body.data.skills[0]?.points[0]?.attemptId, ATTEMPT_ID)
  })

  test('DOM-BEC-035: kapsam dışı öğrenci 404 ApiError olarak döner', async () => {
    const { client } = fakeClient(() =>
      json(404, { code: 'not_found', message: 'Kayıt bulunamadı.', requestId: 'r-1' }),
    )
    await assert.rejects(fetchSkillProgress(client, 'yok'), (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 404)
      assert.equal(error.code, 'not_found')
      return true
    })
  })

  test('DOM-BEC-035: sorgu anahtarı kurumu ve öğrenciyi içerir', () => {
    assert.deepEqual(institutionKey('inst-a', ...SKILL_PROGRESS_KEY, 's1'), [
      'inst',
      'inst-a',
      'skill-progress',
      's1',
    ])
  })
})
