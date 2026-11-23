import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'
import { ApiError } from '@kampus/api-client/errors.ts'

import { runRequest } from '../src/api-result.ts'
import { commandFeedback, commandHeaders } from '../src/commands.ts'
import {
  cancelGroupRequest,
  createGroupRequest,
  fetchAllGroups,
  GROUP_CHANGED_MESSAGE,
  GROUP_DETAILED_CODES,
  GROUP_INVALIDATES,
  GROUP_MESSAGES,
  groupErrorField,
  groupStale,
  mergeGroupRequest,
  openGroupRequest,
  updateGroupRequest,
} from '../src/language-groups.ts'

// IST-077 (DOM-DIL-003, -008, -040…043): grup istekleri, sürüm başlıkları, hata metinleri ve alanları.

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

const GROUP_ID = '00000000-0000-4000-8000-0000a0000001'
const SOURCE_ID = '00000000-0000-4000-8000-0000a0000002'
const COURSE_ID = '00000000-0000-4000-8000-0000c0000001'
const group = (id = GROUP_ID) => ({
  id,
  courseId: COURSE_ID,
  courseName: 'Genel İngilizce A1',
  level: 'A1',
  name: 'A1 Akşam',
  ageBand: 'adult',
  delivery: 'in_person',
  room: 'Derslik 3',
  schedule: [{ weekday: 2, startTime: '18:00' }],
  sessionMinutes: 45,
  startDate: '2026-12-01',
  endDate: '2027-03-01',
  status: 'planned',
  rowVersion: 2,
})

describe('grup istekleri', () => {
  test('oluşturma anahtarla gider, bitiş tarihi gövdede yoktur (DOM-DIL-008)', async () => {
    const { client, sent } = fakeClient(() => json(201, { data: group() }))
    const body = {
      courseId: COURSE_ID,
      name: 'A1 Akşam',
      ageBand: 'adult' as const,
      delivery: 'in_person' as const,
      room: 'Derslik 3',
      schedule: [{ weekday: 2, startTime: '18:00' }],
      startDate: '2026-12-01',
      capacity: 12,
    }
    await runRequest(() => createGroupRequest(client, body, commandHeaders('key-12345')))
    assert.equal(sent[0]?.path, '/api/v1/groups')
    assert.equal(sent[0]?.headers.get('idempotency-key'), 'key-12345')
    assert.equal(sent[0]?.headers.get('if-match'), null)
    assert.equal((sent[0]?.body as Record<string, unknown>).endDate, undefined)
  })

  test('değiştirme, açma, iptal ve birleştirme If-Match taşır; birleştirme kaynak sürümünü gövdede gönderir (DOM-DIL-042)', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: group() }))
    const headers = commandHeaders('key-12345', 2)
    const target = { groupId: GROUP_ID, version: 2 }
    await runRequest(() =>
      updateGroupRequest(client, { ...target, body: { capacity: 10 } }, headers),
    )
    await runRequest(() => openGroupRequest(client, target, headers))
    await runRequest(() =>
      cancelGroupRequest(client, { ...target, body: { reason: 'Yeterli başvuru yok' } }, headers),
    )
    await runRequest(() =>
      mergeGroupRequest(
        client,
        {
          ...target,
          body: { sourceGroupId: SOURCE_ID, sourceVersion: 5, learnersConsented: true },
        },
        headers,
      ),
    )
    assert.deepEqual(
      sent.map((item) => `${item.method} ${item.path}`),
      [
        `PATCH /api/v1/groups/${GROUP_ID}`,
        `POST /api/v1/groups/${GROUP_ID}/open`,
        `POST /api/v1/groups/${GROUP_ID}/cancel`,
        `POST /api/v1/groups/${GROUP_ID}/merge`,
      ],
    )
    assert.ok(sent.every((item) => item.headers.get('if-match') === '"2"'))
    assert.ok(sent.every((item) => item.headers.get('idempotency-key') === 'key-12345'))
    assert.deepEqual(sent[1]?.body, {})
    assert.deepEqual(sent[3]?.body, {
      sourceGroupId: SOURCE_ID,
      sourceVersion: 5,
      learnersConsented: true,
    })
  })

  test('sürümsüz yazma istek atmaz', async () => {
    const { client, sent } = fakeClient(() => json(200, { data: group() }))
    await assert.rejects(
      () =>
        runRequest(() =>
          openGroupRequest(client, { groupId: GROUP_ID, version: 2 }, commandHeaders('k')),
        ),
      (error: unknown) => error instanceof ApiError && error.code === 'if_match_missing',
    )
    assert.equal(sent.length, 0)
  })

  test('bütün gruplar süzgeçle ve sayfa sayfa okunur', async () => {
    let calls = 0
    const { client, sent } = fakeClient(() => {
      calls += 1
      const rows = Array.from({ length: calls === 1 ? 100 : 1 }, (_, index) =>
        group(`g-${calls}-${index}`),
      )
      return json(200, { data: rows, meta: { page: calls, pageSize: 100, total: 101 } })
    })
    const rows = await fetchAllGroups(client, { courseId: COURSE_ID, status: 'open' })
    assert.equal(rows.length, 101)
    assert.deepEqual(
      sent.map((item) => item.search.get('page')),
      ['1', '2'],
    )
    assert.ok(sent.every((item) => item.search.get('courseId') === COURSE_ID))
    assert.ok(sent.every((item) => item.search.get('status') === 'open'))
  })

  test('grup yazması kur listesini de tazeler (arşiv ve kapasite kuralları)', () => {
    assert.deepEqual(
      GROUP_INVALIDATES.map((key) => [...key]),
      [['language-groups'], ['courses']],
    )
  })
})

describe('grup hata metinleri ve alanları', () => {
  const error = (status: number, code: string, path?: (string | number)[], message = 'x') =>
    new ApiError({
      status,
      code,
      message,
      ...(path ? { issues: [{ path, code, message }] } : {}),
    })

  const cases: [string, number, string][] = [
    ['group_below_minimum', 422, 'asgari açılış'],
    ['group_start_passed', 422, 'Başlangıç tarihi geçmiş'],
    ['group_merge_consent_required', 422, 'kursiyerlerin onayını'],
    ['learner_birth_date_required', 422, 'doğum tarihi'],
    ['group_name_exists', 409, 'Bu adla'],
    ['group_closed', 409, 'iptal edilen grup'],
    ['group_schedule_locked', 422, 'haftalık program'],
    ['course_coordinator_required', 403, 'akademik koordinatörü'],
    ['version_conflict', 409, GROUP_CHANGED_MESSAGE],
  ]
  for (const [code, status, expected] of cases)
    test(`${code} Türkçe mesaja eşlenir`, () => {
      const feedback = commandFeedback(error(status, code), GROUP_MESSAGES)
      assert.ok(feedback.message?.includes(expected), feedback.message ?? 'mesaj yok')
    })

  test('çakışma ve takvim kodlarında sunucunun ayrıntılı Türkçe mesajı kalır (IST-077)', () => {
    for (const code of GROUP_DETAILED_CODES) {
      assert.equal((GROUP_MESSAGES as Record<string, string>)[code], undefined, code)
      const message = `Öğretmenin Salı 18:00 saatinde "B1 Akşam" grubunda dersi var. (${code})`
      assert.equal(
        commandFeedback(error(422, code, undefined, message), GROUP_MESSAGES).message,
        message,
      )
    }
  })

  test('grup formunda hata alanı', () => {
    assert.equal(
      groupErrorField(error(422, 'group_teacher_conflict', ['teacherMembershipId'])),
      'teacherMembershipId',
    )
    assert.equal(groupErrorField(error(422, 'group_room_conflict', ['room'])), 'room')
    assert.equal(
      groupErrorField(error(422, 'group_schedule_overlap', ['schedule', '1'])),
      'schedule.1',
    )
    assert.equal(
      groupErrorField(error(422, 'group_outside_legal_hours', ['schedule', '0'])),
      'schedule.0',
    )
    assert.equal(groupErrorField(error(422, 'group_minor_late', ['schedule', '2'])), 'schedule.2')
    assert.equal(groupErrorField(error(422, 'group_schedule_mismatch', ['schedule'])), 'schedule')
    assert.equal(groupErrorField(error(422, 'group_schedule_overlap')), 'schedule')
    assert.equal(groupErrorField(error(422, 'group_schedule_locked', ['startDate'])), 'startDate')
    assert.equal(groupErrorField(error(409, 'group_name_exists', ['name'])), 'name')
    assert.equal(groupErrorField(error(422, 'group_start_passed', ['startDate'])), 'startDate')
    assert.equal(groupErrorField(error(422, 'group_below_minimum', ['members'])), undefined)
    assert.equal(groupErrorField(error(409, 'group_closed')), undefined)
    assert.equal(
      groupErrorField(error(403, 'course_coordinator_required', ['courseId'])),
      undefined,
    )
  })

  test('birleştirme formunda kursiyer kuralları kaynak seçimine, onay kutusuna bağlanır (DOM-DIL-042)', () => {
    assert.equal(
      groupErrorField(error(422, 'group_merge_consent_required'), 'merge'),
      'learnersConsented',
    )
    assert.equal(groupErrorField(error(422, 'learner_schedule_conflict'), 'merge'), 'sourceGroupId')
    assert.equal(groupErrorField(error(422, 'group_minor_late'), 'merge'), 'sourceGroupId')
    assert.equal(
      groupErrorField(error(422, 'learner_birth_date_required'), 'merge'),
      'sourceGroupId',
    )
  })

  test('404 ve sürüm çakışması tazeler; kural hatası tazelemez', () => {
    assert.equal(groupStale(error(404, 'not_found')), true)
    assert.equal(groupStale(error(409, 'version_conflict')), true)
    assert.equal(groupStale(error(409, 'group_closed')), false)
  })
})
