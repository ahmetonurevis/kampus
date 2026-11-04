import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { fieldCipherFromConfig } from '../lib/field-crypto.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  getHealthProfile,
  updateHealthProfile,
  type HealthProfileDeps,
} from '../services/health-profiles.ts'
import { commandErrors } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  healthProfileParamsSchema,
  healthProfileResponseSchema,
  updateHealthProfileBodySchema,
} from './health-profiles.schemas.ts'

/**
 * Öğrencinin sağlık ve acil bilgisi uçları (IST-020; docs/domain/iletisim-ve-veli.md DOM-ILT-035,
 * okuma denetimi DOM-YTK-052). Erişim düzeyi core `lib/health-profile.ts`'ten (Sabah kararı 98);
 * rol listesi yalnız ilk süzgeçtir, öğrenciyle bağ serviste denetlenir.
 *
 * Modülsüzdür: öğrenci kaydı (`students`) her zaman açık çekirdek koleksiyondur ve acil müdahale
 * bilgisi (alerji, acil talimat) bir modül kapatıldı diye derse giren öğretmenden gizlenmemelidir
 * (`test/module-inventory.test.ts` modülsüz listesi).
 */

/** Okuyabilen roller; ön büro hiç okumaz (DOM-ILT-035). */
const READ_ROLES = ['yonetici', 'ogretmen', 'veli', 'ogrenci'] as const satisfies readonly Role[]
/** Yazabilen roller; öğretmen (rehber dahil) yazmaz. */
const WRITE_ROLES = ['yonetici', 'veli', 'ogrenci'] as const satisfies readonly Role[]

const ACCESS =
  'Tam görünüm: yönetici, öğrencinin sınıfının rehber öğretmeni, 18 yaş altı öğrencinin velayetli ve iletişim kısıtı olmayan velisi, 18 yaşını doldurmuş öğrencinin kendisi. Yalnız acil görünüm (`level: emergency`; alerji ve acil talimat): öğrencinin sınıfına derse giren öğretmen. Ön büro ve reşit olmayan öğrencinin kendisi 403 `health_profile_forbidden`; yetişkin öğrencinin velisi 403. Kapsam dışı öğrenci (ilgisiz öğretmen, bağı olmayan, velayetsiz ya da kısıtlı veli, başka öğrenci), olmayan, arşivli ya da başka kurumun öğrencisi 404.'

export function registerHealthProfileRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Anahtar uygulama kurulurken bir kez türetilir (`config.ts` doğrulamıştır).
  const cipher = fieldCipherFromConfig(app.config)
  const deps = (request: FastifyRequest): HealthProfileDeps => ({
    cipher,
    audit: { secret: app.config.BETTER_AUTH_SECRET, ip: request.ip, requestId: request.id },
  })

  typed.get(
    '/api/v1/students/:studentId/health-profile',
    {
      preValidation: [app.authenticate, app.requireRole(READ_ROLES)],
      schema: {
        operationId: 'getStudentHealthProfile',
        tags: ['institution'],
        summary: 'Öğrencinin sağlık ve acil bilgisi',
        description: `Öğrencinin yapılandırılmış sağlık ve acil bilgisi (DOM-ILT-035). Düzey okuyana göredir; acil düzeyde tam alanlar yanıtta yoktur. Kayıt yoksa boş profil ve \`version: 1\` döner. Her başarılı okuma, kayıt olmasa da, denetim kaydına yazılır (\`health_profile.read\`, acil düzeyde \`health_profile.read_emergency\`; yalnız alan adları, DOM-YTK-052); denetim yazılamazsa yanıt dönmez. ${ACCESS} Modülsüz. Roller: \`yonetici\`, \`ogretmen\`, \`veli\`, \`ogrenci\`; ön büro 403.`,
        params: healthProfileParamsSchema,
        response: { 200: healthProfileResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getHealthProfile(contextOf(request), deps(request), request.params.studentId),
    }),
  )

  typed.patch(
    '/api/v1/students/:studentId/health-profile',
    {
      preValidation: [app.authenticate, app.requireRole(WRITE_ROLES)],
      schema: {
        operationId: 'updateStudentHealthProfile',
        tags: ['institution'],
        summary: 'Öğrencinin sağlık ve acil bilgisini güncelle',
        description:
          'Kısmi güncelleme (core `healthProfilePatchSchema`): yalnız gönderilen içerik alanları değişir, gönderilmeyen alan aynen kalır (boş liste göndermek listeyi boşaltır); en az bir içerik alanı gerekir. `legalBasis` gönderilmezse mevcut dayanak kalır, kayıt yokken zorunludur. Birleşmiş profil tam şemada doğrulanır (400). `version` okunan sürümdür (kayıt yoksa 1); tutmazsa 409 `version_conflict`. Yazma ve denetim kaydı (`health_profile.update`, yalnız değişen alan adları) tek transaction içindedir. Yazabilenler: yönetici, 18 yaş altı öğrencinin velayetli ve kısıtsız velisi, 18 yaşını doldurmuş öğrencinin kendisi; diğerleri 403 `health_profile_write_forbidden` (öğretmen ve ön büro rol süzgecinde 403), kapsam dışı ya da başka kurumun öğrencisi 404. İçerik şifreli saklanır. Modülsüz. Roller: `yonetici`, `veli`, `ogrenci`.',
        params: healthProfileParamsSchema,
        body: updateHealthProfileBodySchema,
        response: { 200: healthProfileResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({
      data: await updateHealthProfile(
        contextOf(request),
        deps(request),
        request.params.studentId,
        request.body,
      ),
    }),
  )
}
