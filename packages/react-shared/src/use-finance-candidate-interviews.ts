import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'
import { JOB_POSTINGS_KEY } from './use-finance-job-postings.ts'
import { LESSON_OBSERVATIONS_KEY } from './use-finance-lesson-observations.ts'

// Aday mülakatı kancaları (`/finance/interview-templates`, `/finance/job-applications/:id/interviews`,
// `/finance/candidate-interviews`; DOM-FIN-138, ON-178). Form ve mülakat açma ile değerlendirme
// gönderimi `Idempotency-Key`, düzeltme, yeni sürüm, arşiv, yapıldı ve iptal `If-Match` ister.
// Mülakat yazmaları başvuru anahtarını da tazeler (ayrıntıdaki özet ve teklif kapısı); örnek ders
// gözlem formu sürümünü kilitlediği için gözlem anahtarı da tazelenir. Komutlar `exclusive`.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never
type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never
type Ok<TOperation extends keyof operations> = operations[TOperation]['responses'] extends {
  200: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type InterviewTemplateBody = JsonBody<'createInterviewTemplate'>
export type UpdateInterviewTemplateBody = JsonBody<'updateInterviewTemplate'>
export type CreateCandidateInterviewBody = JsonBody<'createCandidateInterview'>
export type CandidateEvaluationBody = JsonBody<'submitCandidateEvaluation'>
export type InterviewTemplate = Ok<'listInterviewTemplates'>['data'][number]
export type InterviewTemplateQuery = Query<'listInterviewTemplates'>
export type ApplicationInterviews = Ok<'listApplicationInterviews'>['data']
export type CandidateInterview = ApplicationInterviews['interviews'][number]

export const CANDIDATE_INTERVIEWS_KEY = ['finance', 'candidate-interviews'] as const
const MESSAGES = {
  version_conflict: 'Kayıt başka biri tarafından değiştirildi. Liste güncellendi.',
}
const INTERVIEW_KEYS = [CANDIDATE_INTERVIEWS_KEY, JOB_POSTINGS_KEY, LESSON_OBSERVATIONS_KEY]

export function useInterviewTemplates(query: InterviewTemplateQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...CANDIDATE_INTERVIEWS_KEY, 'templates', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/interview-templates', { params: { query }, signal }),
    },
    { enabled },
  )
}

/** Başvurunun mülakatları, değerlendirmeleri ve özeti (yalnız yönetici). */
export function useApplicationInterviews(applicationId: string, enabled = true) {
  return useApiQuery({
    key: [...CANDIDATE_INTERVIEWS_KEY, 'application', applicationId],
    enabled: enabled && applicationId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/job-applications/{applicationId}/interviews', {
        params: { path: { applicationId } },
        signal,
      }),
  })
}

export function useCreateInterviewTemplate() {
  return useApiCommand({
    request: (client, body: InterviewTemplateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/interview-templates', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [CANDIDATE_INTERVIEWS_KEY],
    exclusive: true,
  })
}

/** Kullanılmamış son sürümün düzeltmesi (K-470); kullanılmış sürüm 409 `interview_template_used`. */
export function useUpdateInterviewTemplate() {
  return useApiCommand({
    request: (
      client,
      input: { templateId: string; version: number; body: UpdateInterviewTemplateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/interview-templates/{templateId}', {
        params: {
          path: { templateId: input.templateId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [CANDIDATE_INTERVIEWS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useCreateInterviewTemplateVersion() {
  return useApiCommand({
    request: (
      client,
      input: { templateId: string; version: number; body: InterviewTemplateBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/interview-templates/{templateId}/versions', {
        params: {
          path: { templateId: input.templateId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: input.body,
      }),
    invalidates: [CANDIDATE_INTERVIEWS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveInterviewTemplate() {
  return useApiCommand({
    request: (client, input: { templateId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/interview-templates/{templateId}/archive', {
        params: {
          path: { templateId: input.templateId },
          header: {
            'idempotency-key': headers['idempotency-key'],
            'if-match': requireIfMatch(headers),
          },
        },
        body: {},
      }),
    invalidates: [CANDIDATE_INTERVIEWS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Mülakat planı (K-469): başvuru "mülakat" aşamasında olmalı. */
export function useCreateCandidateInterview() {
  return useApiCommand({
    request: (
      client,
      input: { applicationId: string; body: CreateCandidateInterviewBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/job-applications/{applicationId}/interviews', {
        params: {
          path: { applicationId: input.applicationId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: INTERVIEW_KEYS,
    exclusive: true,
  })
}

/** "Yapıldı" ya da iptal (K-469). */
export function useChangeCandidateInterviewStatus() {
  return useApiCommand({
    request: (
      client,
      input: { interviewId: string; version: number; action: 'complete' | 'cancel' },
      headers: CommandHeaders,
    ) => {
      const params = {
        path: { interviewId: input.interviewId },
        header: {
          'idempotency-key': headers['idempotency-key'],
          'if-match': requireIfMatch(headers),
        },
      }
      return input.action === 'complete'
        ? client.POST('/api/v1/finance/candidate-interviews/{interviewId}/complete', {
            params,
            body: {},
          })
        : client.POST('/api/v1/finance/candidate-interviews/{interviewId}/cancel', {
            params,
            body: {},
          })
    },
    invalidates: INTERVIEW_KEYS,
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

/** Değerlendiricinin formu (K-470): bir kez gönderilir, sonra değişmez. */
export function useSubmitCandidateEvaluation() {
  return useApiCommand({
    request: (
      client,
      input: { interviewId: string; body: CandidateEvaluationBody },
      headers: CommandHeaders,
    ) =>
      client.POST('/api/v1/finance/candidate-interviews/{interviewId}/evaluation', {
        params: {
          path: { interviewId: input.interviewId },
          header: { 'idempotency-key': headers['idempotency-key'] },
        },
        body: input.body,
      }),
    invalidates: INTERVIEW_KEYS,
    messages: {
      candidate_evaluation_submitted: 'Değerlendirmenizi zaten gönderdiniz; liste güncellendi.',
    },
    exclusive: true,
  })
}
