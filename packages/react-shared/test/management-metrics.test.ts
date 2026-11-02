import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createKampusClient } from '@kampus/api-client/client.ts'

import { runRequest } from '../src/api-result.ts'
import {
  classMetricsRequest,
  metricsById,
  teacherMetricsRequest,
} from '../src/use-management-metrics.ts'

function fakeClient(body: unknown) {
  const paths: string[] = []
  const client = createKampusClient({
    baseUrl: 'https://api.kampus.test',
    credentials: 'include',
    requestId: () => undefined,
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      paths.push(`${request.method} ${new URL(request.url).pathname}`)
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  return { client, paths }
}

test('ölçü istekleri doğru uca gider ve satırlar kimlikle eşlenir (IST-010)', async () => {
  const classes = fakeClient({
    data: [{ classId: 'c1', students: 3, gradedStudents: 2, averageScore: 78 }],
  })
  const result = await runRequest(() => classMetricsRequest(classes.client))
  assert.deepEqual(classes.paths, ['GET /api/v1/class-metrics'])
  assert.equal(metricsById(result.data, 'classId').get('c1')?.averageScore, 78)

  const teachers = fakeClient({
    data: [{ teacherId: 't1', questions: 4, breaches: 2, slaRate: 50, performance: 73 }],
  })
  const rows = await runRequest(() => teacherMetricsRequest(teachers.client))
  assert.deepEqual(teachers.paths, ['GET /api/v1/teacher-metrics'])
  assert.equal(metricsById(rows.data, 'teacherId').get('t1')?.performance, 73)
  assert.equal(metricsById<{ teacherId: string }, 'teacherId'>(undefined, 'teacherId').size, 0)
})
