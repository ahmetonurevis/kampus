import { expect } from '@playwright/test'

import type { ApiClient } from './api.ts'
import { istanbulDay } from './commands.ts'

/** Deneme sınavı duman testlerinin kurum koleksiyonları (deneme + sonuçları). */
export const EXAM_COLLECTIONS = ['mockExams', 'mockResults'] as const

interface Row<T> {
  id: string
  version: number
  record: T
}
export interface ExamResultRecord {
  examId: string
  studentId: string
  subjectId: string
  correct: number
  wrong: number
  blank: number
}

/** 7. sınıf matematik denemesini API'den açar (bugünün tarihli) ve kimliğini verir. */
export async function createExam(client: ApiClient, title: string): Promise<string> {
  const result = await client.post('/api/v1/workflows/exam', {
    title,
    type: 'Okul denemesi',
    grade: 7,
    wrongPenalty: 4,
    date: istanbulDay(),
    subjectIds: ['math'],
  })
  expect(result.status).toBeLessThan(300)
  const id = (result.body as { data: { entity: { id: string } | null } }).data.entity?.id
  expect(id).toBeTruthy()
  return id ?? ''
}

export async function resultsOf(
  client: ApiClient,
  examId: string,
): Promise<Row<ExamResultRecord>[]> {
  const result = await client.get('/api/v1/collections/mockResults?pageSize=100')
  expect(result.status).toBe(200)
  return (result.body as { data: Row<ExamResultRecord>[] }).data.filter(
    (row) => row.record.examId === examId,
  )
}
