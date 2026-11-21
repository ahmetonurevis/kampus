import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import { skillReportRequest } from '../src/use-skill-report.ts'

// OG-100 (IST-118; DOM-BEC-037): rapor isteği doğru uca ve `groupBy` sorgusuyla gider.

function fakeClient(body: unknown) {
  const urls: string[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      const url = new URL(request.url)
      urls.push(`${request.method} ${url.pathname}${url.search}`)
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, urls }
}

const report = {
  data: {
    groupBy: 'level',
    computedAt: '2026-11-04T09:00:00.000Z',
    groups: [],
    totals: { studentCount: 0, skills: [], levels: [], noLevelCount: 0 },
  },
}

test('DOM-BEC-037: rapor isteği groupBy sorgusunu taşır ve gövdeyi döndürür', async () => {
  const fake = fakeClient(report)
  const result = await runRequest(() => skillReportRequest(fake.client, 'level'))
  assert.deepEqual(fake.urls, ['GET /api/v1/reports/skills?groupBy=level'])
  assert.equal(result.data.groupBy, 'level')

  const classes = fakeClient({ data: { ...report.data, groupBy: 'class' } })
  await runRequest(() => skillReportRequest(classes.client, 'class'))
  assert.deepEqual(classes.urls, ['GET /api/v1/reports/skills?groupBy=class'])
})
