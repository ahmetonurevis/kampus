import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_SEVERANCE_ROLES,
  severanceEstimate,
  severanceRequestSchema,
  severanceWarningCodes,
} from '@kampus/school-core/lib/finance-severance.ts'

import { authenticatedErrors } from './common.schemas.ts'
import { severanceEstimateResponseSchema } from './finance-severance.schemas.ts'

/**
 * Kıdem ve ihbar tazminatı tahmini (ON-205; docs/domain/finans.md DOM-FIN-094). Elle girdili saf
 * hesap: kurum kaydı okumaz ve yazmaz, sonuç saklanmaz, gövde loglanmaz (K-273). Kurum ve rol
 * oturumdan; modül `finance`, rol core `FINANCE_SEVERANCE_ROLES` (yönetici, K-272). Hesap core'da
 * olduğundan servis katmanı yoktur.
 */
export function registerFinanceSeveranceRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const finance = app.requireModule('finance')

  typed.post(
    '/api/v1/finance/severance-estimates',
    {
      preValidation: [app.authenticate, finance, app.requireRole(FINANCE_SEVERANCE_ROLES)],
      schema: {
        operationId: 'estimateFinanceSeverance',
        tags: ['finance-severance'],
        summary: 'Kıdem ve ihbar tazminatını tahmin et',
        description:
          'Elle girilen işe giriş ve çıkış günü, aylık brüt ücret, düzenli yan ödemeler, çıkış nedeni ve ihbar bilgisinden kıdem ve ihbar tazminatının tahmini dökümünü döner (ON-205; DOM-FIN-094). **Hiçbir şey yazmaz**, hesap saklanmaz (K-273; `Idempotency-Key` gerekmez). Kıdem: bir tam yıl ve kıdem doğuran neden şartıyla esas aylık (giydirilmiş brüt ile çıkış günündeki tavanın küçüğü) × (tam yıl + artık gün / 365); gelir vergisinden istisna, damga vergisi binde 7,59. İhbar: yalnız işveren feshinde ve ihbar verilmediyse 4857 md. 17 süresi (2/4/6/8 hafta) × 7 × giydirilmiş aylık / 30; gelir vergisi `cumulativeTaxBaseCents` yoksa ilk dilim oranı, varsa dilimli (K-274); damga vergisi. Tutarlar kuruş. Tavan ve tarife tablosu dışındaki günde son bilinen değer kullanılır, `warnings` uyarır. Bilinmeyen alan 400. Rol: `yonetici` (diğerleri 403); `finance` modülü kapalıysa 403 `module_disabled`. Tahmindir; bordro ya da mali müşavir hesabı yerine geçmez.',
        body: severanceRequestSchema,
        response: { 200: severanceEstimateResponseSchema, ...authenticatedErrors },
      },
    },
    (request) => {
      const estimate = severanceEstimate(request.body)
      return Promise.resolve({ data: { ...estimate, warnings: severanceWarningCodes(estimate) } })
    },
  )
}
