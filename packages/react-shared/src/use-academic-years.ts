import { useQueryClient } from '@tanstack/react-query'

import {
  ACADEMIC_YEAR_MESSAGES,
  ACADEMIC_YEARS_KEY,
  ACADEMIC_YEARS_PAGE_SIZE,
  activateAcademicYearRequest,
  addAcademicTermRequest,
  closeAcademicYearRequest,
  createAcademicYearRequest,
  removeAcademicTermRequest,
  updateAcademicTermRequest,
  updateAcademicYearRequest,
  type AcademicTermBody,
  type AcademicTermTarget,
  type AcademicYearTarget,
  type CreateAcademicYearBody,
  type UpdateAcademicTermBody,
  type UpdateAcademicYearBody,
} from './academic-years.ts'
import { ME_QUERY_KEY } from './query-keys.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'

// Eğitim yılı kancaları (`/academic-years`, IST-011). `If-Match` yılın `rowVersion`'ıdır (`version` girdisi);
// `Idempotency-Key` kanca içinde yönetilir (`useApiCommand`).

/** Kurumun eğitim yılları (yeni yıl önce) ve dönemleri; tek sayfada. */
export function useAcademicYears() {
  return useApiQuery({
    key: [...ACADEMIC_YEARS_KEY, 'list'],
    request: (client, signal) =>
      client.GET('/api/v1/academic-years', {
        params: { query: { page: 1, pageSize: ACADEMIC_YEARS_PAGE_SIZE } },
        signal,
      }),
  })
}

/** Bugünün (Europe/Istanbul) eğitim yılı ve dönemi; yıl seçicilerin varsayılanı. */
export function useCurrentAcademicPeriod() {
  return useApiQuery({
    key: [...ACADEMIC_YEARS_KEY, 'current'],
    request: (client, signal) => client.GET('/api/v1/academic-years/current', { signal }),
  })
}

// `exclusive` değildir: kural hatasının alanı `fieldFor` ile koddan belirlenir ve mesaj Türkçe
// sözlükten (`ACADEMIC_YEAR_MESSAGES`) gelir; `exclusive` sunucu maddesini sözlüğün önüne alırdı.
const base = {
  invalidates: [ACADEMIC_YEARS_KEY],
  messages: ACADEMIC_YEAR_MESSAGES,
} as const

export function useCreateAcademicYear() {
  return useApiCommand({
    request: (client, body: CreateAcademicYearBody, headers) =>
      createAcademicYearRequest(client, body, headers),
    ...base,
  })
}

export function useUpdateAcademicYear() {
  return useApiCommand({
    request: (client, input: AcademicYearTarget & { body: UpdateAcademicYearBody }, headers) =>
      updateAcademicYearRequest(client, input, headers),
    version: (input) => input.version,
    ...base,
  })
}

export function useAddAcademicTerm() {
  return useApiCommand({
    request: (client, input: AcademicYearTarget & { body: AcademicTermBody }, headers) =>
      addAcademicTermRequest(client, input, headers),
    version: (input) => input.version,
    ...base,
  })
}

export function useUpdateAcademicTerm() {
  return useApiCommand({
    request: (client, input: AcademicTermTarget & { body: UpdateAcademicTermBody }, headers) =>
      updateAcademicTermRequest(client, input, headers),
    version: (input) => input.version,
    ...base,
  })
}

export function useRemoveAcademicTerm() {
  return useApiCommand({
    request: (client, input: AcademicTermTarget, headers) =>
      removeAcademicTermRequest(client, input, headers),
    version: (input) => input.version,
    ...base,
  })
}

/**
 * Oturumdaki kurum yılı (`/me` `academicYear`, üst çubuktaki "2026–2027 Eğitim Dönemi") etkin
 * yılı izler; etkinleştirme ve kapatma sonrası oturum tazelenir.
 */
function useRefreshSession() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
}

/** Yılı etkinleştirir; önceki etkin yıl aynı işlemde kapanır ve bu geri alınamaz. */
export function useActivateAcademicYear() {
  const refreshSession = useRefreshSession()
  return useApiCommand({
    request: (client, input: AcademicYearTarget, headers) =>
      activateAcademicYearRequest(client, input, headers),
    version: (input) => input.version,
    onSuccess: refreshSession,
    ...base,
  })
}

export function useCloseAcademicYear() {
  const refreshSession = useRefreshSession()
  return useApiCommand({
    request: (client, input: AcademicYearTarget, headers) =>
      closeAcademicYearRequest(client, input, headers),
    version: (input) => input.version,
    onSuccess: refreshSession,
    ...base,
  })
}
