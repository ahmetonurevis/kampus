import type {
  FastifyInstance,
  FastifyRequest,
  preHandlerAsyncHookHandler,
  RouteOptions,
} from 'fastify'

import { moduleAvailableFor } from '@kampus/school-core/modules/collection-modules.ts'

import { AppError, MESSAGES, NotFoundError } from '../errors.ts'
import { getInstitutionModules, isModuleKey } from '../services/modules.ts'
import { contextOf } from './authenticate.ts'
import { markEarlyGuard, registerEarlyGuardCheck } from './early-guards.ts'

/** Kapalı modül yanıtı (api-tasarimi.md §5: modül kapalı → 403 `module_disabled`; DOM-YTK-040). */
export class ModuleDisabledError extends AppError {
  constructor() {
    super(403, 'module_disabled', MESSAGES.module_disabled)
    this.name = 'ModuleDisabledError'
  }
}

/**
 * Modül anahtarı sabit verilir ya da istekten çözülür (ör. koleksiyon adından). Çözücü `null`
 * dönerse uç modüle bağlı değildir; çözücünün fırlattığı hata (ör. bilinmeyen koleksiyon 404)
 * olduğu gibi yanıt olur.
 */
export type ModuleSource = string | ((request: FastifyRequest) => string | null)

/**
 * Rota → modül envanterinin bir satırı (IST-009, `test/module-inventory.test.ts`). `modules`
 * rotanın `preValidation` listesindeki `requireModule` kaynaklarıdır; boş liste rotanın modül
 * denetimi taşımadığını söyler.
 */
export interface RouteModuleEntry {
  method: string
  url: string
  modules: readonly ModuleSource[]
}

/** `requireModule` ön işleyicisi → modül kaynağı; envanter rotadaki denetimi buradan tanır. */
const GUARD_MODULES = new WeakMap<object, ModuleSource>()

declare module 'fastify' {
  interface FastifyInstance {
    /** Kayıtlı rotaların modül envanteri (HEAD hariç), kayıt sırasıyla. */
    routeModules: () => readonly RouteModuleEntry[]
    /**
     * Kimlik + etkin kurumda modül var ve açık mı. Kurum türünde olmayan modül 404 (bulunmaz
     * gibi, DOM-YTK-012), kapalı modül 403 `module_disabled` (DOM-YTK-040). Yalnız `preValidation`'da
     * kullanılır (sorgu/gövde doğrulamasından önce); `preHandler`'da kullanım açılışta hata verir.
     */
    requireModule: (module: ModuleSource) => preHandlerAsyncHookHandler
  }
}

function assertModuleKey(key: string): void {
  if (!isModuleKey(key))
    throw new AppError(500, 'internal_error', MESSAGES.internal_error, {
      cause: new Error(`unknown module ${key}`),
    })
}

export function registerModuleGuard(app: FastifyInstance) {
  // Modül ve rol denetimi `preValidation`'da olmalıdır; yanlış yerleşim açılışta hata verir.
  registerEarlyGuardCheck(app)
  const inventory: RouteModuleEntry[] = []
  app.decorate('routeModules', () => inventory)
  app.addHook('onRoute', (route: RouteOptions) => {
    for (const method of [route.method].flat()) {
      if (method === 'HEAD') continue
      const modules = [route.preValidation ?? []].flat().flatMap((hook) => {
        const source = GUARD_MODULES.get(hook)
        return source === undefined ? [] : [source]
      })
      inventory.push({ method, url: route.url, modules })
    }
  })
  app.decorate('requireModule', (module: ModuleSource): preHandlerAsyncHookHandler => {
    // Sabit anahtar yazım hatası uygulama açılırken yakalanır.
    if (typeof module === 'string') assertModuleKey(module)
    const guard = markEarlyGuard(async function (request, reply) {
      await app.authenticate.call(app, request, reply)
      const key = typeof module === 'string' ? module : module(request)
      if (key === null) return
      assertModuleKey(key)
      const ctx = contextOf(request)
      const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
      if (institution && !moduleAvailableFor(key, institution.type)) {
        request.log.info({ event: 'module.unavailable_denied', module: key })
        throw new NotFoundError()
      }
      if (institution?.modules[key] !== true) {
        request.log.info({ event: 'module.disabled_denied', module: key })
        throw new ModuleDisabledError()
      }
    } satisfies preHandlerAsyncHookHandler)
    GUARD_MODULES.set(guard, module)
    return guard
  })
}
