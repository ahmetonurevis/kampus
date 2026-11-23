import type { App } from '../../src/app.ts'
import { signInAs } from './app.ts'

/**
 * Kayıt ve finans testlerinde ilk kullanımda açılan oturum (ON-312). Giriş yine Better Auth'tur
 * (`signInAs`); yalnız zamanı ertelenir ve aynı test içinde çerez yeniden kullanılır. Her giriş
 * parola doğrulamasında bir scrypt hesaplar (~100 ms CPU); kurulumda açılıp hiç kullanılmayan
 * oturum bu maliyeti boşa öder.
 */
export function lazySession(
  app: App,
  user: { email: string; password: string },
): () => Promise<string> {
  let cookie: Promise<string> | undefined
  return () => (cookie ??= signInAs(app, user))
}
