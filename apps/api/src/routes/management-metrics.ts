import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { getClassMetrics, getTeacherMetrics } from '../services/management-metrics.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  classMetricsResponseSchema,
  metricsQuerySchema,
  teacherMetricsResponseSchema,
} from './management-metrics.schemas.ts'

/**
 * Kampüsler & Sınıflar "Ortalama" ve Eğitim Kadrosu "Performans" sütunları (IST-010). Toplam
 * SQL'dedir (`db/management-metrics.ts`); web bütün not ve soru kayıtlarını çekmez. Yalnız
 * yönetici (yönetim ekranları yöneticinindir); not ortalaması `academic`, soru süresi `learning`
 * modülüne bağlıdır: kapalı modül 403 `module_disabled`, kurum türünde olmayan modül 404.
 */
export function registerManagementMetricRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const response = (
    ok: typeof classMetricsResponseSchema | typeof teacherMetricsResponseSchema,
  ) => ({
    200: ok,
    ...authenticatedErrors,
    404: errorResponseSchema,
  })

  typed.get(
    '/api/v1/class-metrics',
    {
      preValidation: [app.requireModule('academic'), app.requireRole(['yonetici'])],
      schema: {
        operationId: 'listClassMetrics',
        tags: ['school-management'],
        summary: 'Sınıf ölçüleri',
        description:
          "Sınıf başına aktif öğrenci sayısı ve not ortalaması (IST-010): önce öğrencinin notlarının yuvarlanmamış ortalaması, sonra sınıfta notu olan öğrencilerin ortalaması; yuvarlama yalnız sonda bir kez (DOM-AKD-003). Güncel sınıf esastır (öğretim yılı alanı yok); sayı olmayan ve 0-100 dışı puan atlanır. Öğrencinin güncel sınıfı esastır; aktif öğrencisi olmayan sınıf dönmez. Toplam SQL'dedir. Yalnız yönetici (diğer roller 403); `academic` modülü kapalıysa 403 `module_disabled`.",
        querystring: metricsQuerySchema,
        response: response(classMetricsResponseSchema),
      },
    },
    async (request) => ({ data: await getClassMetrics(contextOf(request)) }),
  )

  typed.get(
    '/api/v1/teacher-metrics',
    {
      preValidation: [app.requireModule('learning'), app.requireRole(['yonetici'])],
      schema: {
        operationId: 'listTeacherMetrics',
        tags: ['school-management'],
        summary: 'Öğretmen ölçüleri',
        description:
          "Öğretmen başına soru sayısı, 24 saat yanıt hedefini aşan soru, hedef uyumu ve performans (yoklama, ödev takibi ve hedef uyumunun ortalaması; IST-010). Yanıtlanan soruda yanıt süresi, yanıtsız soruda geçen süre ölçülür; geri çekilen soru sayılmaz (DOM-ILT-091). Arşivlenmiş öğretmen ve soru dışlanır; geçerli oluşturma tarihi olmayan soru sayılmaz. Toplam SQL'dedir. Yalnız yönetici (diğer roller 403); `learning` modülü kapalıysa 403 `module_disabled`.",
        querystring: metricsQuerySchema,
        response: response(teacherMetricsResponseSchema),
      },
    },
    async (request) => ({ data: await getTeacherMetrics(contextOf(request)) }),
  )
}
