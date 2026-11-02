// İçerik havuzu kaynak eylemlerinin saf modeli (OG-217): paylaşım formu, gerekçe formu ve hata
// eşlemesi. Kural core `content/visibility.ts` (`shareTargetsSchema`, `planShareChange`) ve
// `content/resource.ts` (`transitionReasonSchema`) içindedir; burada yalnız form ve sunum vardır.
import { z } from 'zod'
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { StaffResource } from '@kampus/react-shared/resource-model.ts'
import { transitionReasonSchema } from '@kampus/school-core/content/resource.ts'
import { SHARE_SCOPES, type ShareScope } from '@kampus/school-core/content/taxonomy.ts'
import { shareTargetsSchema, type ShareTargets } from '@kampus/school-core/content/visibility.ts'

export type ShareFormValues = {
  scope: ShareScope
  classIds: string[]
  studentIds: string[]
}

/**
 * Form değerinden API gövdesi: seçilmeyen kapsamın listesi gönderilmez. Kullanıcı kapsamı
 * değiştirip geri dönebilsin diye form iki listeyi de tutar; core şeması yanlış kapsamdaki
 * listeyi reddettiğinden gövdeye yalnız seçilen kapsamın listesi girer.
 */
export function shareBody(values: unknown): unknown {
  if (typeof values !== 'object' || values === null) return values
  const { scope, classIds, studentIds } = values as Partial<ShareFormValues>
  return {
    scope,
    studentIds: scope === 'students' ? (studentIds ?? []) : [],
    classIds: scope === 'classes' ? (classIds ?? []) : [],
  }
}

export type ShareFormOutput = ShareTargets
/** Form şeması: girdi form değeri, çıktı core paylaşım hedefi (`zodResolver` için tipli). */
export const shareFormSchema = z.preprocess(shareBody, shareTargetsSchema) as z.ZodType<
  ShareFormOutput,
  ShareFormValues
>

/** Formun başlangıcı kaynağın kayıtlı paylaşımıdır. */
export function shareDefaults(
  resource: Pick<StaffResource, 'shareScope' | 'sharedStudentIds' | 'sharedClassIds'>,
): ShareFormValues {
  return {
    scope: resource.shareScope,
    classIds: [...resource.sharedClassIds],
    studentIds: [...resource.sharedStudentIds],
  }
}

export const SHARE_SCOPE_OPTIONS = (Object.keys(SHARE_SCOPES) as ShareScope[]).map((value) => ({
  value,
  label: SHARE_SCOPES[value].label,
}))

/** Kapsamın kime açıldığı (DOM-KYN-031, 040); zümre ve kurum onaylı sürüm ister. */
export const SHARE_SCOPE_NOTES: Record<ShareScope, string> = {
  private: 'İçerik öğrencilere ve diğer öğretmenlere kapalıdır.',
  students: 'Seçtiğiniz öğrenciler, düzeyleri uyuyorsa yayındaki sürümü görür.',
  classes: 'Seçtiğiniz sınıf ve grupların öğrencileri yayındaki sürümü görür.',
  department: 'Dersin zümresindeki öğretmenler okur, atar ve kopyalar; onaylı sürüm gerekir.',
  institution: 'Kurumdaki bütün öğretmenler okur, atar ve kopyalar; onaylı sürüm gerekir.',
}

/**
 * Paylaşım hatasının gösterileceği alan (DOM-KYN-021, 031, 040). Hedef kapsam dışı veya kurumda
 * yoksa seçilen listenin altında, lisans ve onay engeli kapsam seçiminin altında görünür;
 * diğerleri toast'tır.
 */
export function shareErrorField(
  error: Pick<ApiError, 'code'>,
  scope: ShareScope,
): keyof ShareFormValues | undefined {
  switch (error.code) {
    case 'share_target_out_of_scope':
    case 'share_target_not_found':
      return scope === 'students' ? 'studentIds' : scope === 'classes' ? 'classIds' : 'scope'
    case 'license_restricts_share':
    case 'share_scope_review_required':
      return 'scope'
    default:
      return undefined
  }
}

/** Telif bildirimi ve kaldırma gerekçesi (5–1000 karakter, core `transitionReasonSchema`). */
export const reasonSchema = z.object({ reason: transitionReasonSchema })
export type ReasonInput = z.input<typeof reasonSchema>

export const SHARE_SUCCESS = 'Paylaşım güncellendi.'
export const COPY_SUCCESS = 'Kopya oluşturuldu; taslak yalnız size açık.'
export const REPORT_SUCCESS = 'Telif bildirimi alındı; içerik incelemeye alındı.'
export const REMOVE_SUCCESS = 'İçerik kaldırıldı.'

/** Kaldırma sonrası yöneticiye etkilenen kopya ve quiz sayısı (DOM-KYN-050, 051). */
export function removalNotice(result: {
  affectedCopyIds: readonly string[]
  affectedContainerVersionIds: readonly string[]
}): string {
  const parts: string[] = []
  if (result.affectedCopyIds.length > 0)
    parts.push(`${result.affectedCopyIds.length} kopyayı ayrıca inceleyin`)
  if (result.affectedContainerVersionIds.length > 0)
    parts.push(
      `${result.affectedContainerVersionIds.length} quiz veya alıştırma sürümü bu içeriği kullanıyor`,
    )
  return parts.length > 0 ? `${REMOVE_SUCCESS} ${parts.join('; ')}.` : REMOVE_SUCCESS
}
