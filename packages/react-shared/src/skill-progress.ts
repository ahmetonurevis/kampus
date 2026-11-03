import type { KampusClient } from '@kampus/api-client/client.ts'
import type { components } from '@kampus/api-client/schema.d.ts'

import { runRequest } from './api-result.ts'

/**
 * Beceri ilerleme panosu ucunun (`GET /students/:id/skill-progress`; OG-080, IST-057,
 * DOM-BEC-035) saf yardımcıları. Kanca `use-skill-progress.ts`'tedir. Kapsamı sunucu uygular:
 * öğrenci kendisini, veli bağlı çocuğunu, öğretmen sınıfındaki ya da grubundaki öğrenciyi, yönetici
 * herkesi görür; kapsam dışı 404. Pano iki kurum türünde de `learning` modülüne bağlıdır.
 */

export type SkillProgress = components['schemas']['SkillProgress']
export type SkillCurve = SkillProgress['skills'][number]
export type SkillProgressPoint = SkillCurve['points'][number]

/** Sorgu anahtarının kökü (etkin kurumla `institutionKey` içinde kullanılır). */
export const SKILL_PROGRESS_KEY = ['skill-progress'] as const

export function fetchSkillProgress(client: KampusClient, studentId: string, signal?: AbortSignal) {
  return runRequest(() =>
    client.GET('/api/v1/students/{studentId}/skill-progress', {
      params: { path: { studentId } },
      ...(signal ? { signal } : {}),
    }),
  )
}
