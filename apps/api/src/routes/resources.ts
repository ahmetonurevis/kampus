import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { getResource, getResourceVersion, listResources } from '../services/resources.ts'
import { readErrors } from './communication.schemas.ts'
import {
  resourceDetailResponseSchema,
  resourceListQuerySchema,
  resourceListResponseSchema,
  resourceParamsSchema,
  resourceVersionParamsSchema,
  resourceVersionResponseSchema,
} from './resources.schemas.ts'

/**
 * İçerik havuzu okuma uçları (ADR 0004 karar 3, 9; docs/domain/kaynak-platformu.md). `learning`
 * modülüne bağlıdır; ön büro içerik havuzuna erişmez (403, DOM-YTK-021). Görünürlük core
 * `canReadVersion`'dır; okunamayan veya başka kurumun kaynağı 404. Yazma uçları ayrı dilimdedir.
 */

const MODULE = 'learning'
const READERS: readonly Role[] = ['yonetici', 'ogretmen', 'ogrenci', 'veli']
const ACCESS =
  'Roller: `yonetici`, `ogretmen`, `ogrenci`, `veli`; ön büro 403. Modül `learning`; kapalıysa 403 `module_disabled`.'

export function registerResourceRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Kimlik, modül ve rol şema doğrulamasından önce: oturumsuz istek geçersiz kimlikte de 401 alır.
  const preValidation = [app.requireModule(MODULE), app.requireRole(READERS)]

  typed.get(
    '/api/v1/resources',
    {
      preValidation,
      schema: {
        operationId: 'listResources',
        tags: ['resources'],
        summary: 'İçerik havuzu',
        description: `Kişinin görebildiği kaynaklar, sayfalı (DOM-KYN-030, 040, 041). Personel satırı kaynağın okunabilir baş sürümüdür (arşivli olmayan, en yüksek numara) ve \`view: 'staff'\` taşır; öğrenci ve veli yalnız paylaşım kapsamındaki, düzey/seviyesine uyan, lisansı geçerli güncel yayın sürümünü \`view: 'learner'\` olarak görür (cevap anahtarı ve lisans ayrıntısı yok). Baş sürümü arşivli veya kaldırılmış kaynak varsayılan olarak listede ve aramada yoktur; yalnız \`status=archived\` / \`status=removed\` ile gelir (DOM-KYN-051). Velide \`studentId\` görünümü seçili çocuğa daraltır (veli materyal sayfası; bağlı olmayan çocuk 404). Normalleşince terim kalmayan \`q\` (ör. \`!!!\`) boş sonuç döner. Süzgeçler baş sürüme uygulanır; bilinmeyen parametre 400. ${ACCESS}`,
        querystring: resourceListQuerySchema,
        response: { 200: resourceListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const result = await listResources(contextOf(request), request.query)
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/resources/:resourceId',
    {
      preValidation,
      schema: {
        operationId: 'getResource',
        tags: ['resources'],
        summary: 'Kaynak ayrıntısı',
        description: `Personel: kaynak, paylaşım hedefleri, okunabilir sürümler, baş sürümün tamamı (içerik, cevap anahtarı, lisans) ve açık sürümde yayım eksikleri. Öğrenci/veli: güncel yayın sürümünün öğrenci görünümü (seçenekler kişiye sabit karıştırılır, cevap anahtarı yok, dinleme dökümü gizli; DOM-KYN-003, 024). Okunabilir sürümü olmayan veya başka kurumun kaynağı 404. ${ACCESS}`,
        params: resourceParamsSchema,
        response: { 200: resourceDetailResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getResource(contextOf(request), request.params.resourceId),
    }),
  )

  typed.get(
    '/api/v1/resources/:resourceId/versions/:versionId',
    {
      preValidation,
      schema: {
        operationId: 'getResourceVersion',
        tags: ['resources'],
        summary: 'Kaynak sürümü',
        description: `Tek sürüm. Personel okuyabildiği her sürümü (arşivli dahil; DOM-KYN-032) tam görür; öğrenci/veli yalnız güncel yayın sürümünü öğrenci görünümüyle. Diğer durumlarda 404. ${ACCESS}`,
        params: resourceVersionParamsSchema,
        response: { 200: resourceVersionResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getResourceVersion(
        contextOf(request),
        request.params.resourceId,
        request.params.versionId,
      ),
    }),
  )
}
