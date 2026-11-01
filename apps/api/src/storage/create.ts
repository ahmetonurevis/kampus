import { storageDir, publicUrl, type Config } from '../config.ts'
import { DiskStorage, storageSigningKey } from './disk.ts'

/** Ortamdaki sürücüyü kurar; klasör ilk yazmada açılır (OpenAPI üretimi diske dokunmaz). */
export function createStorage(config: Config): DiskStorage {
  switch (config.STORAGE_DRIVER) {
    case 'disk':
      return new DiskStorage({
        root: storageDir(config),
        baseUrl: publicUrl(config),
        signingKey: storageSigningKey(config.BETTER_AUTH_SECRET),
      })
    default:
      return config.STORAGE_DRIVER satisfies never
  }
}
