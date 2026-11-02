import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders, type CommandMessages } from './commands.ts'

/**
 * Eğitim yılı ve dönem uçlarının (`/academic-years`, IST-011; DOM-YTK-063…067) saf yardımcıları:
 * istek kurucular, Türkçe hata metinleri ve sorgu anahtarı. Kancalar `use-academic-years.ts`'tedir;
 * burası React olmadan sahte istemciyle sınanır. Yıl ve dönemleri tek `rowVersion` taşır: her
 * yazma `If-Match` olarak ekrandaki yılın sürümünü gönderir (tutmazsa 409 `version_conflict`).
 */

export type AcademicYear = components['schemas']['AcademicYear']
export type AcademicTerm = components['schemas']['AcademicTerm']
export type CurrentAcademicPeriod = components['schemas']['CurrentAcademicPeriod']

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never

export type CreateAcademicYearBody = JsonBody<'createAcademicYear'>
export type UpdateAcademicYearBody = JsonBody<'updateAcademicYear'>
export type AcademicTermBody = JsonBody<'addAcademicTerm'>
export type UpdateAcademicTermBody = JsonBody<'updateAcademicTerm'>

/** Sorgu anahtarının kökü (etkin kurum kendiliğinden eklenir); yazma sonrası bu önek tazelenir. */
export const ACADEMIC_YEARS_KEY = ['academic-years'] as const

/** Yıl listesi tek sayfada çekilir: kurumun yılları azdır (ucun üst sınırı 100). */
export const ACADEMIC_YEARS_PAGE_SIZE = 100

export const ACADEMIC_YEAR_CHANGED_MESSAGE =
  'Eğitim yılını başka biri değiştirdi. Liste güncellendi; son durumu kontrol edip yeniden deneyin.'
export const ACADEMIC_YEAR_NOT_FOUND_MESSAGE = 'Eğitim yılı bulunamadı. Liste güncellendi.'

/**
 * Koda özgü Türkçe metinler. Çakışma ve örtüşme mesajları sunucudaki gibidir ama istemci sözlüğü
 * kod kararlı kaldıkça metni sabitler; listede olmayan kodda sunucunun Türkçe mesajı gösterilir
 * (ör. çakışan yılın adını taşıyan `academic_year_overlap`).
 */
export const ACADEMIC_YEAR_MESSAGES = {
  version_conflict: ACADEMIC_YEAR_CHANGED_MESSAGE,
  not_found: ACADEMIC_YEAR_NOT_FOUND_MESSAGE,
  academic_year_not_found: ACADEMIC_YEAR_NOT_FOUND_MESSAGE,
  academic_term_not_found: 'Dönem bulunamadı. Liste güncellendi.',
  academic_year_exists: 'Bu başlangıç yılı için eğitim yılı zaten tanımlı.',
  academic_year_closed: 'Kapanmış eğitim yılı değiştirilemez.',
  academic_year_start_mismatch: 'Başlangıç günü eğitim yılının başlangıç yılı içinde olmalı.',
  academic_year_dates_invalid: 'Bitiş günü başlangıç gününden sonra olmalı.',
  academic_year_too_long: 'Eğitim yılı bir yıldan uzun olamaz.',
  academic_term_outside_year: 'Dönem, eğitim yılının başlangıç ve bitiş günleri arasında olmalı.',
  academic_term_dates_invalid: 'Dönemin bitiş günü başlangıç gününden önce olamaz.',
  academic_term_overlap: 'Dönem, yılın başka bir dönemiyle çakışıyor. Tarihleri değiştirin.',
  academic_term_name_exists: 'Bu yılda aynı adlı bir dönem var. Farklı bir ad yazın.',
  academic_term_limit: 'Bir yılda en çok 12 dönem olur.',
  academic_terms_required:
    'Okulda etkin eğitim yılının en az bir dönemi olmalı. Önce dönem ekleyin.',
  academic_year_already_active: 'Bu eğitim yılı zaten etkin.',
  academic_year_activation_order: 'Daha yeni bir yıl etkinken önceki yıl etkinleştirilemez.',
  academic_year_ended: 'Bitmiş eğitim yılı etkinleştirilemez.',
  academic_year_activation_too_early:
    'Eğitim yılı başlangıç gününden en çok 60 gün önce etkinleştirilebilir. Daha sonra yeniden deneyin.',
  academic_year_not_active: 'Yalnız etkin eğitim yılı kapatılabilir.',
  academic_year_not_ended:
    'Eğitim yılı son gününden önce kapatılamaz. Yeni yılı etkinleştirmek bu yılı kapatır.',
} as const satisfies CommandMessages

export interface AcademicYearTarget {
  startYear: number
  /** Ekrandaki yılın `rowVersion`'ı (`If-Match`); yoksa istek atılmaz. */
  version: number
}

export interface AcademicTermTarget extends AcademicYearTarget {
  termId: string
}

export function createAcademicYearRequest(
  client: KampusClient,
  body: CreateAcademicYearBody,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/academic-years', {
    params: { header: { 'idempotency-key': headers['idempotency-key'] } },
    body,
  })
}

const versioned = (headers: CommandHeaders) => ({
  ...headers,
  'if-match': requireIfMatch(headers),
})

export function updateAcademicYearRequest(
  client: KampusClient,
  input: AcademicYearTarget & { body: UpdateAcademicYearBody },
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/academic-years/{startYear}', {
    params: { path: { startYear: input.startYear }, header: versioned(headers) },
    body: input.body,
  })
}

export function addAcademicTermRequest(
  client: KampusClient,
  input: AcademicYearTarget & { body: AcademicTermBody },
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/academic-years/{startYear}/terms', {
    params: { path: { startYear: input.startYear }, header: versioned(headers) },
    body: input.body,
  })
}

export function updateAcademicTermRequest(
  client: KampusClient,
  input: AcademicTermTarget & { body: UpdateAcademicTermBody },
  headers: CommandHeaders,
) {
  return client.PATCH('/api/v1/academic-years/{startYear}/terms/{termId}', {
    params: {
      path: { startYear: input.startYear, termId: input.termId },
      header: versioned(headers),
    },
    body: input.body,
  })
}

export function removeAcademicTermRequest(
  client: KampusClient,
  input: AcademicTermTarget,
  headers: CommandHeaders,
) {
  return client.DELETE('/api/v1/academic-years/{startYear}/terms/{termId}', {
    params: {
      path: { startYear: input.startYear, termId: input.termId },
      header: versioned(headers),
    },
  })
}

export function activateAcademicYearRequest(
  client: KampusClient,
  input: AcademicYearTarget,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/academic-years/{startYear}/activate', {
    params: { path: { startYear: input.startYear }, header: versioned(headers) },
    // Şema gövdeyi zorunlu saydığından (isteğe bağlı boş nesne) boş nesne gider.
    body: {},
  })
}

export function closeAcademicYearRequest(
  client: KampusClient,
  input: AcademicYearTarget,
  headers: CommandHeaders,
) {
  return client.POST('/api/v1/academic-years/{startYear}/close', {
    params: { path: { startYear: input.startYear }, header: versioned(headers) },
    body: {},
  })
}

/** Yılın sürümü: personele döner; yoksa (öğrenci/veli yanıtı) yazma yapılamaz. */
export const yearVersion = (year: Pick<AcademicYear, 'rowVersion'>): number | null =>
  year.rowVersion ?? null
