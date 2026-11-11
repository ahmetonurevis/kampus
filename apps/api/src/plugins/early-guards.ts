import type { FastifyInstance, RouteOptions } from 'fastify'

/**
 * Doğrulamadan önce koşması gereken ön işleyiciler (`requireModule`, `requireRole`). Fastify şema
 * doğrulaması `preHandler`'dan önce çalışır: kapalı modül ya da yetkisiz rol, geçersiz sorguda
 * 403 yerine 400 ve sorgu şemasının `issues` ayrıntısını alırdı (api-tasarimi.md §5, IST-009).
 * Sıra: 401 → modül 403 → rol 403 → 400 → 404.
 */
const EARLY_GUARDS = new WeakSet<object>()

/** Ön işleyiciyi "doğrulamadan önce" diye işaretler ve olduğu gibi döndürür. */
export function markEarlyGuard<T extends object>(guard: T): T {
  EARLY_GUARDS.add(guard)
  return guard
}

/** `preHandler` listesinde işaretli bir denetim bulunursa uygulama açılırken hata verir. */
export function assertGuardsBeforeValidation(route: Pick<RouteOptions, 'preHandler' | 'url'>) {
  const hooks = [route.preHandler ?? []].flat()
  if (hooks.some((hook) => EARLY_GUARDS.has(hook)))
    throw new Error(
      `${route.url}: requireModule/requireRole preHandler'da olamaz; preValidation kullanın (IST-009)`,
    )
}

/** Her rota kaydında yerleşimi denetler; kayıttan önce çağrılmalıdır. */
export function registerEarlyGuardCheck(app: FastifyInstance) {
  app.addHook('onRoute', assertGuardsBeforeValidation)
}
