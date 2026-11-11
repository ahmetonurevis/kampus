import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import {
  CEFR_INVALIDATES,
  CEFR_KEY,
  CEFR_MESSAGES,
  completePlacementRequest,
  decidePlacementRequest,
  fetchAllPlacements,
  fetchCefrProfile,
  fetchPlacementForm,
  fetchPlacementPage,
  isStaffProfile,
  openPlacementRequest,
  PLACEMENT_CHANGED_MESSAGE,
  placementStale,
  scorePlacementRequest,
  type CefrProfile,
} from '../src/cefr.ts'
import { commandFeedback, commandHeaders } from '../src/commands.ts'

// OG-054 (IST-058, IST-060; DOM-DIL-010…012): tespit istekleri, gövde sürümü, profil görünümleri
// ve Türkçe hata metinleri.

interface Sent {
  method: string
  path: string
  search: URLSearchParams
  headers: Headers
  body: unknown
}

function fakeClient(reply: (sent: Sent) => Response) {
  const sent: Sent[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const text = await request.text()
      const url = new URL(request.url)
      const item = {
        method: request.method,
        path: url.pathname,
        search: url.searchParams,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      }
      sent.push(item)
      return reply(item)
    },
  })
  return { client, sent }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const SESSION_ID = '00000000-0000-4000-8000-0000e0000001'
const STUDENT_ID = '00000000-0000-4000-8000-0000b0000001'
const FORM_ID = '00000000-0000-4000-8000-0000f0000001'
const FORM_VERSION_ID = '00000000-0000-4000-8000-0000f0000002'
const RUBRIC_VERSION_ID = '00000000-0000-4000-8000-0000d0000001'

const session = (version = 2) => ({
  id: SESSION_ID,
  learnerKind: 'student',
  learnerId: STUDENT_ID,
  formId: FORM_ID,
  formVersionId: FORM_VERSION_ID,
  mode: 'in_person',
  startedAt: '2026-11-01T09:00:00.000Z',
  completedAt: null,
  version,
})

// Kanıt sayılmayan sonuçlar (`excluded`) yalnız personel yanıtındadır (OG-247, DOM-BEC-045).
const estimate: CefrProfile['estimate'] = {
  context: 'general',
  computedAt: '2026-11-02T09:00:00.000Z',
  overall: { status: 'insufficient', missingSkills: ['speaking'] },
  skills: [],
  label: 'Tahmini seviye',
  evidence: [],
}

const timelineBase = {
  id: '00000000-0000-4000-8000-0000a0000001',
  kind: 'placement',
  skill: null,
  level: 'B1',
  decidedAt: '2026-11-01T10:00:00.000Z',
  placementSessionId: SESSION_ID,
  previousLevel: null,
  change: 'first',
} as const

const learnerProfile: CefrProfile = {
  view: 'learner',
  studentId: STUDENT_ID,
  title: 'Deniz Yılmaz',
  estimate,
  current: [],
  placements: [],
  timeline: [timelineBase],
}

const staffProfile: CefrProfile = {
  ...learnerProfile,
  view: 'staff',
  estimate: { ...estimate, excluded: [] },
  timeline: [
    {
      ...timelineBase,
      rationale: 'Tespit sonucu',
      decidedByUserId: 'user-1',
      decidedByName: 'Selin Kaya',
      evidence: {
        context: 'placement',
        suggestedLevel: 'B1',
        followsSuggestion: true,
        successful: 0,
        items: [],
      },
    },
  ],
}

describe('CEFR profili', () => {
  test('IST-060: profil öğrenci yolundan okunur; görünüm staff ve learner ayrılır', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: learnerProfile }))
    const body = await fetchCefrProfile(client, STUDENT_ID)
    assert.equal(sent[0]?.method, 'GET')
    assert.equal(sent[0]?.path, `/api/v1/students/${STUDENT_ID}/cefr-profile`)
    assert.equal(isStaffProfile(body.data), false)
    assert.equal('rationale' in (body.data.timeline[0] ?? {}), false)
    assert.equal(isStaffProfile(staffProfile), true)
  })

  test('IST-058: tespit listesi kişiyle süzülür ve bütün sayfaları çeker', async () => {
    const { client, sent } = fakeClient(() =>
      json(200, { data: [session()], meta: { page: 1, pageSize: 100, total: 1 } }),
    )
    const rows = await fetchAllPlacements(client, {
      learnerKind: 'student',
      learnerId: STUDENT_ID,
    })
    assert.equal(rows.length, 1)
    assert.equal(sent[0]?.path, '/api/v1/placement-sessions')
    assert.equal(sent[0]?.search.get('learnerKind'), 'student')
    assert.equal(sent[0]?.search.get('learnerId'), STUDENT_ID)
    assert.equal(sent[0]?.search.get('page'), '1')
  })
})

describe('tespit ekranı okumaları', () => {
  test('OG-078 IST-058: tek sayfa kişi ve sayfayla gider; meta satırlarla döner', async () => {
    const { client, sent } = fakeClient(() =>
      json(200, { data: [{ id: 'o1' }], meta: { page: 2, pageSize: 8, total: 9 } }),
    )
    const page = await fetchPlacementPage(client, {
      learnerKind: 'prospect',
      learnerId: 'p1',
      page: 2,
      pageSize: 8,
    })
    assert.deepEqual(page, { rows: [{ id: 'o1' }], page: 2, pageSize: 8, total: 9 })
    assert.equal(sent[0]?.path, '/api/v1/placement-sessions')
    assert.equal(sent[0]?.search.get('learnerKind'), 'prospect')
    assert.equal(sent[0]?.search.get('page'), '2')
  })

  test('OG-078 IST-058: form oturum yolundan okunur', async () => {
    const { client, sent } = fakeClient(() =>
      json(200, { data: { sessionId: 'o1', formVersionId: 'f1', sections: [] } }),
    )
    const body = await fetchPlacementForm(client, '00000000-0000-4000-8000-000000000001')
    assert.equal(body.data.sessionId, 'o1')
    assert.equal(
      sent[0]?.path,
      '/api/v1/placement-sessions/00000000-0000-4000-8000-000000000001/form',
    )
    assert.equal(sent[0]?.method, 'GET')
  })
})

describe('tespit istekleri', () => {
  test('DOM-DIL-010: açma anahtarla gider, If-Match göndermez', async () => {
    const { client, sent } = fakeClient(() => json(201, { data: session(1) }))
    await runRequest(() =>
      openPlacementRequest(
        client,
        {
          learnerKind: 'student',
          learnerId: STUDENT_ID,
          formId: FORM_ID,
          formVersionId: FORM_VERSION_ID,
          mode: 'in_person',
        },
        commandHeaders('key-12345'),
      ),
    )
    assert.equal(sent[0]?.path, '/api/v1/placement-sessions')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
  })

  test('DOM-DIL-010, DOM-DIL-012: puanlama, bitirme ve karar sürümü gövdede taşır, If-Match yok', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: session(3) }))
    const headers = commandHeaders('key-12345', 2)
    await runRequest(() =>
      scorePlacementRequest(
        client,
        {
          sessionId: SESSION_ID,
          body: {
            version: 2,
            section: 'writing',
            rubricVersionId: RUBRIC_VERSION_ID,
            targetLevel: 'B1',
            criteria: [],
          },
        },
        headers,
      ),
    )
    await runRequest(() =>
      completePlacementRequest(client, { sessionId: SESSION_ID, version: 2 }, headers),
    )
    await runRequest(() =>
      decidePlacementRequest(
        client,
        { sessionId: SESSION_ID, body: { level: 'B1', rationale: 'Tespit sonucu', version: 3 } },
        headers,
      ),
    )
    assert.deepEqual(
      sent.map((item) => item.path),
      [
        `/api/v1/placement-sessions/${SESSION_ID}/score`,
        `/api/v1/placement-sessions/${SESSION_ID}/complete`,
        `/api/v1/placement-sessions/${SESSION_ID}/decide`,
      ],
    )
    for (const item of sent) {
      assert.equal(item.headers.get('if-match'), null)
      assert.equal(item.headers.get('idempotency-key'), 'key-12345')
    }
    assert.deepEqual(sent[1]?.body, { version: 2 })
    assert.equal((sent[2]?.body as { version: number }).version, 3)
  })
})

describe('tespit hataları', () => {
  test('rubrik becerisi, açık kur sonu kararı ve sürüm çakışması Türkçe metin alır', () => {
    for (const code of [
      'placement_rubric_skill_mismatch',
      'progression_pending',
      'rubric_version_unpublished',
      'placement_production_missing',
      'placement_expired',
      'placement_preliminary',
    ] as const) {
      const error = new ApiError({ status: 422, code, message: 'server' })
      assert.equal(commandFeedback(error, CEFR_MESSAGES).message, CEFR_MESSAGES[code])
    }
    const conflict = new ApiError({ status: 409, code: 'version_conflict', message: 'x' })
    assert.equal(commandFeedback(conflict, CEFR_MESSAGES).message, PLACEMENT_CHANGED_MESSAGE)
    assert.equal(commandFeedback(conflict, CEFR_MESSAGES).refresh, true)
  })

  test('eski oturum: 404 ve sürüm çakışması tazeler, iş kuralı tazelemez', () => {
    assert.equal(
      placementStale(new ApiError({ status: 404, code: 'not_found', message: 'x' })),
      true,
    )
    assert.equal(
      placementStale(new ApiError({ status: 409, code: 'version_conflict', message: 'x' })),
      true,
    )
    assert.equal(
      placementStale(new ApiError({ status: 409, code: 'placement_completed', message: 'x' })),
      false,
    )
    assert.deepEqual(CEFR_INVALIDATES, [CEFR_KEY])
  })
})
