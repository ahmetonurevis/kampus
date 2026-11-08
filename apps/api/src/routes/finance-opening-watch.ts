import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { openingWatchQuerySchema } from '@kampus/school-core/lib/finance-opening-watch.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { openingWatchFor } from '../services/finance-opening-watch.ts'
import { commandErrors } from './commands.schemas.ts'
import { openingWatchResponseSchema } from './finance-opening-watch.schemas.ts'

/** Açılış nöbeti (DOM-FIN-061, ON-095). Modül `finance`; yönetici ve ön büro okur (K-58). */
const STAFF = ['yonetici', 'onburo'] as const

export function registerFinanceOpeningWatchRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  typed.get(
    '/api/v1/finance/opening-watch',
    {
      preValidation: [app.authenticate, app.requireModule('finance'), app.requireRole(STAFF)],
      schema: {
        operationId: 'getFinanceOpeningWatch',
        tags: ['finance-opening-watch'],
        summary: 'Açılış nöbeti: ilk taksitler, onaysız sözleşmeler, kayıt değişiklikleri, iadeler',
        description:
          'Yeni öğretim yılı ya da dönem açılışında izlenecekler (DOM-FIN-061). `firstInstallments`: seçilen yılın sözleşme zinciri başına en küçük numaralı güncel taksiti; kalanı olan ve vadesi geçmiş ya da 7 gün içinde gelecek olanlar (kısmi ödeme düşülür). `unapprovedContracts`: seçilen yılın kurum imzası ya da ödeyici onayı bekleyen sürümleri (ek protokol dahil; ayrılan öğrenci hariç). `enrollmentChanges`: pencereye düşen kesin kayıt, yenileme planı, dönem geçişi, mezuniyet ve ayrılış (DOM-KAY-026); yenileme modülü kapalıysa geçiş olayı yoktur (`renewalModule`). `refunds`: pencereden bağımsız ödenmemiş bütün ayrılış iadeleri. Her bölüm sayılarla birlikte en çok 20 satır döner. `academicYear` verilmezse kurumun etkin yılı; pencere yıl (ya da `termId` dönemi) başlangıcından 30 gün önce ile 41 gün sonrası arasıdır, `from`/`to` birlikte verilirse onlar (yalnız biri 400). Ters pencere 422 `opening_window_invalid`, 120 günü aşan 422 `opening_window_too_long`, yılda olmayan dönem 422 `opening_term_not_found`. Hiçbir şey yazmaz. Roller: `yonetici`, `onburo`.',
        querystring: openingWatchQuerySchema,
        response: { 200: openingWatchResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({ data: await openingWatchFor(contextOf(request), request.query) }),
  )
}
