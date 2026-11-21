import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { FINANCE_PAY_RATE_ROLES } from '@kampus/school-core/lib/finance-pay-rates.ts'
import {
  FINANCE_SEVERANCE_ROLES,
  severanceRequestSchema,
} from '@kampus/school-core/lib/finance-severance.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { estimateSeveranceFor, severancePaySuggestionFor } from '../services/finance-severance.ts'
import { commandErrors } from './commands.schemas.ts'
import {
  severanceEstimateResponseSchema,
  severancePaySuggestionQuery,
  severancePaySuggestionResponse,
} from './finance-severance.schemas.ts'

/**
 * Kıdem ve ihbar tazminatı tahmini (ON-205, ON-341; docs/domain/finans.md DOM-FIN-094). Hesap
 * core'dadır; servis kurumun çıkış günündeki bordro parametresini (K-344) ve seçilen personelin ücret
 * tanımını (K-345…K-347) okur. Sonuç saklanmaz, gövde loglanmaz (K-273). Kurum ve rol oturumdan;
 * modül `finance`, rol core `FINANCE_SEVERANCE_ROLES` (yönetici, K-272); ücret okuması ayrıca
 * `FINANCE_PAY_RATE_ROLES` (K-347).
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
          'İşe giriş ve çıkış günü, aylık brüt ücret, düzenli yan ödemeler, çıkış nedeni ve ihbar bilgisinden kıdem ve ihbar tazminatının tahmini dökümünü döner (ON-205; DOM-FIN-094). Hesap **saklanmaz** (K-273; `Idempotency-Key` gerekmez). Kıdem tavanı, gelir vergisi dilimleri ve damga vergisi oranı kurumun **çıkış günündeki bordro parametre setinden** okunur (DOM-FIN-100; kurum kopyası platform setinin yerini alır); 2025 öncesi çıkışta set yoksa yedek tablo kullanılır, kaynak `parameters`ta döner (K-344). Kıdem: bir tam yıl ve kıdem doğuran neden şartıyla esas aylık (giydirilmiş brüt ile tavanın küçüğü) × (tam yıl + artık gün / 365); gelir vergisinden istisna, damga vergisi. İhbar: yalnız işveren feshinde ve ihbar verilmediyse 4857 md. 17 süresi (2/4/6/8 hafta) × 7 × giydirilmiş aylık / 30; gelir vergisi `cumulativeTaxBaseCents` yoksa ilk dilim oranı, varsa dilimli (K-274); damga vergisi. İsteğe bağlı `membershipId`: personelin çıkış günündeki ücret önerisi sunucuda yeniden okunur ve kaynağı (`paySource`: tanım kimlikleri, başlangıç günü, önerilen tutarlar, girilen ücretin öneriden farkı) döner (K-345, K-346); okuma `finance.pay_rate.read` denetimine düşer, personel olmayan ya da başka kurumun üyeliği 404 (K-347). Tutarlar kuruş. Son bilinen tavan ya da tarife kullanıldıysa `warnings` uyarır. Bilinmeyen alan 400. Rol: `yonetici` (diğerleri 403); `finance` modülü kapalıysa 403 `module_disabled`. Tahmindir; bordro ya da mali müşavir hesabı yerine geçmez.',
        body: severanceRequestSchema,
        response: { 200: severanceEstimateResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({ data: await estimateSeveranceFor(contextOf(request), request.body) }),
  )

  typed.get(
    '/api/v1/finance/severance-pay-suggestion',
    {
      preValidation: [app.authenticate, finance, app.requireRole(FINANCE_PAY_RATE_ROLES)],
      schema: {
        operationId: 'getFinanceSeverancePaySuggestion',
        tags: ['finance-severance'],
        summary: 'Kıdem hesabı için personelin ücret önerisi',
        description:
          'Personelin `date` (çıkış) gününde yürürlükteki ücret tanımından kıdem hesaplayıcısına öneri (K-345): aylık brüt ana ücret ve kıdeme esas yan hakların aylık toplamı (nakdi yan haklar girer; ayni yan haklar ve saat başı ek ders/nöbet ücretleri girmez). Ana ücret net, saatlik ya da ders saati üzerindense ya da günde ana ücret yoksa öneri yapılmaz: tutarlar `null`, `status` nedeni verir. Tutar içerdiği için her okuma denetim kaydına `finance.pay_rate.read` olarak düşer (yalnız alan adı; K-307, K-347). Olmayan, başka kurumun ya da personel olmayan üyelik 404. Rol: yalnız `yonetici` (ücret okuyan rol, K-306); modül `finance`.',
        querystring: severancePaySuggestionQuery,
        response: { 200: severancePaySuggestionResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await severancePaySuggestionFor(
        contextOf(request),
        request.query.membershipId,
        request.query.date,
      ),
    }),
  )
}
