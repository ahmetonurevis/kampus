import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'

import { AppError, MESSAGES } from '../errors.ts'
import { getEnabledModules, isModuleKey } from '../services/modules.ts'
import { contextOf } from './authenticate.ts'

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

declare module 'fastify' {
  interface FastifyInstance {
    /** Kimlik + etkin kurumda modül açık mı; kapalıysa 403 `module_disabled`. */
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
  app.decorate('requireModule', (module: ModuleSource): preHandlerAsyncHookHandler => {
    // Sabit anahtar yazım hatası uygulama açılırken yakalanır.
    if (typeof module === 'string') assertModuleKey(module)
    return async function (request, reply) {
      await app.authenticate.call(app, request, reply)
      const key = typeof module === 'string' ? module : module(request)
      if (key === null) return
      assertModuleKey(key)
      const ctx = contextOf(request)
      const enabled = await getEnabledModules(ctx.db, ctx.institutionId)
      if (enabled?.[key] !== true) {
        request.log.info({ event: 'module.disabled_denied', module: key })
        throw new ModuleDisabledError()
      }
    }
  })
}
