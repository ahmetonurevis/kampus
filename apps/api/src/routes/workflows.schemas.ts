import { z } from 'zod'

import type { WorkflowCommand } from '@kampus/school-core/lib/school-workflows.ts'
import type { ModuleKey } from '@kampus/school-core/modules/collection-modules.ts'

import type { Role } from '../auth.ts'

/**
 * İş akışı köprüsünün komut tablosu (api-tasarimi.md §1: `POST /workflows/:command`). Her komut
 * kendi rotasıdır: gövde şeması core `workflowSchemas[komut]`'tur ve OpenAPI'de komut başına
 * ayrı işlem olarak görünür. Bilinmeyen komutun rotası yoktur: 404 `not_found` (core
 * `unknown_command` ile aynı anlam). Tablo `satisfies Record<WorkflowCommand, …>` ile core'un
 * komut listesine bağlıdır; core komut ekleyince burada eklenmeden tip denetimi geçmez.
 *
 * `record`: komutun `:recordId` alıp almadığı (`optional`: kimliksiz oluşturur, kimlikle
 * günceller). `idempotency: 'required'`: taksit/sözleşme oluşturan (yenileme) ve toplu içe
 * aktaran komutlar (api.md). Rol ve kapsam core'un kuralıdır (`mayRun`, `scopeFor`); rota her
 * rolü kabul eder, core reddi 403'tür.
 */
export interface WorkflowRoute {
  record: 'none' | 'required' | 'optional'
  idempotency: 'required' | 'optional'
  summary: string
}

const create = (summary: string): WorkflowRoute => ({
  record: 'none',
  idempotency: 'optional',
  summary,
})
const onRecord = (summary: string): WorkflowRoute => ({
  record: 'required',
  idempotency: 'optional',
  summary,
})
const upsert = (summary: string): WorkflowRoute => ({
  record: 'optional',
  idempotency: 'optional',
  summary,
})

export const WORKFLOW_ROUTES = {
  goal: create('Hedef oluştur'),
  'goal-review': onRecord('Hedefi onayla veya gerekçeyle reddet'),
  'goal-step': onRecord('Hedefe adım ekle'),
  'goal-step-done': onRecord('Hedef adımını tamamla'),
  'goal-suggest': onRecord('Hedef için adım öner'),
  'goal-comment': onRecord('Hedefe yorum ekle'),
  'goal-close': onRecord('Hedefi kapat'),
  guidance: create('Rehberlik dosyası aç'),
  'guidance-note': onRecord('Rehberlik dosyasına not ekle'),
  exam: create('Deneme sınavı oluştur'),
  'exam-result': create('Deneme sonucu gir'),
  'exam-import': { ...create('Deneme sonuçlarını CSV ile içe aktar'), idempotency: 'required' },
  renewal: { ...create('Kayıt yenileme planla'), idempotency: 'required' },
  'renewal-activate': onRecord('Sınıf geçişini uygula'),
  lesson: upsert('Ders ekle veya güncelle'),
  substitute: onRecord('Vekil öğretmen ata'),
  'lesson-cancel': onRecord('Dersi iptal et'),
  'study-task': create('Çalışma görevi ver'),
  'study-complete': onRecord('Çalışma görevini tamamla'),
  'study-review': onRecord('Çalışma görevini değerlendir'),
  event: create('Etkinlik oluştur'),
  consent: onRecord('Etkinlik iznine yanıt ver'),
  'event-cancel': onRecord('Etkinliği iptal et'),
  route: upsert('Servis güzergâhı ekle veya güncelle'),
  'route-archive': onRecord('Servis güzergâhını arşivle'),
  'transport-assign': create('Öğrenciyi servise ata'),
  'transport-remove': onRecord('Servis atamasını kaldır'),
  meal: upsert('Yemek menüsü ekle veya güncelle'),
  club: create('Kulüp oluştur'),
  'club-enroll': onRecord('Öğrenciyi kulübe kaydet'),
  'club-leave': onRecord('Kulüp üyeliğini sonlandır'),
  'club-attendance': onRecord('Kulüp yoklaması al'),
  achievement: create('Sosyal başarı ekle'),
  'club-archive': onRecord('Kulübü arşivle'),
} as const satisfies Record<WorkflowCommand, WorkflowRoute>

/**
 * Komutun modülü: rota `requireModule` ile okuma uçlarıyla aynı sırayı uygular (kurum türünde
 * olmayan modül 404, kapalı modül 403 `module_disabled`; DOM-YTK-012, DOM-YTK-040). Core
 * komut → modül tablosunu dışa aktarmadığı için burada tutulur; test her komutun core'da yalnız
 * bu modül kapanınca `module_disabled` verdiğini doğrular (tablo core'dan sapamaz).
 * TODO(core-command-modules): core tabloyu dışa aktarınca buradan okunur.
 */
export const WORKFLOW_MODULES = {
  goal: 'goals',
  'goal-review': 'goals',
  'goal-step': 'goals',
  'goal-step-done': 'goals',
  'goal-suggest': 'goals',
  'goal-comment': 'goals',
  'goal-close': 'goals',
  guidance: 'guidance',
  'guidance-note': 'guidance',
  exam: 'exams',
  'exam-result': 'exams',
  'exam-import': 'exams',
  renewal: 'renewal',
  'renewal-activate': 'renewal',
  lesson: 'planning',
  substitute: 'planning',
  'lesson-cancel': 'planning',
  'study-task': 'study',
  'study-complete': 'study',
  'study-review': 'study',
  event: 'calendar',
  consent: 'calendar',
  'event-cancel': 'calendar',
  route: 'transport',
  'route-archive': 'transport',
  'transport-assign': 'transport',
  'transport-remove': 'transport',
  meal: 'meals',
  club: 'clubs',
  'club-enroll': 'clubs',
  'club-leave': 'clubs',
  'club-attendance': 'clubs',
  achievement: 'clubs',
  'club-archive': 'clubs',
} as const satisfies Record<WorkflowCommand, ModuleKey>

export const workflowRecordParamsSchema = z.object({
  recordId: z.string().min(1).max(200).describe('Komutun konusu olan kayıt (ör. hedef kimliği)'),
})

export const workflowQuerySchema = z.strictObject({
  childId: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Yalnız veli: işlemin yapıldığı çocuk (velinin bağlı çocuklarından biri; değilse kapsam boştur ve core 403 döner)',
    ),
})

/** Gövdesiz komutların gövdesi: boş nesne (core girdiyi okumaz). */
export const emptyCommandBodySchema = z.object({}).describe('Gövdesiz komut')

/** OpenAPI açıklaması: rol kuralı core'dadır. */
export function workflowDescription(command: WorkflowCommand, roles: readonly Role[]): string {
  return `school-core \`runWorkflow('${command}')\`. Gövde core \`workflowSchemas\` şemasıdır. Core'un izin verdiği roller: ${roles.map((role) => `\`${role}\``).join(', ')}; kayıt kapsamı core \`scopeFor\` ile üyelik bağlantılarından hesaplanır. Modül: \`${WORKFLOW_MODULES[command]}\`; kurum türünde olmayan modül 404, kapalı modül 403 \`module_disabled\`, yetkisiz rol veya kapsam dışı kayıt 403, yok veya başka kurumun kaydı 404, iş kuralı 422, çakışma 409.`
}
