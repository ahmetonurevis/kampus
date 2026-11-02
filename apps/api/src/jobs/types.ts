import type { FastifyBaseLogger } from 'fastify'
import { z } from 'zod'

import type { Database } from '../db/client.ts'
import type { StorageDriver } from '../storage/storage.ts'

/** İşleyicinin bağımlılıkları; saat ayrı `now` parametresiyle gelir (testte sabitlenir). */
export interface JobDeps {
  db: Database
  storage: StorageDriver
  log: FastifyBaseLogger
}

/**
 * Kurum başına işin yükü (kod-yazim.md "Arka plan işleri", guvenlik-kvkk.md): yalnız kurum
 * kimliği. Kişisel veri, ad, e-posta ya da serbest metin yüke yazılmaz; işleyici gerekeni kurum
 * kapsamlı depo fonksiyonlarıyla kendisi okur. Katı şema: fazladan alan programlama hatasıdır.
 */
export const institutionJobDataSchema = z.strictObject({
  institutionId: z.string().min(1).max(200),
})
export type InstitutionJobData = z.infer<typeof institutionJobDataSchema>

/** Bir saat ve bir gün (saniye): tekil anahtarın zaman dilimi. */
export const HOUR_SECONDS = 3600
export const DAY_SECONDS = 86_400

/**
 * Zamanlanmış, kurum başına çalışan iş. Zamanlayıcı (`cron`, Europe/Istanbul) `<ad>.dispatch`
 * kuyruğuna tek iş bırakır; o iş kurumları dolaşıp her kurum için `<ad>` kuyruğuna bir iş koyar
 * (`dispatchInstitutionJobs`). Aynı kurum için aynı `slotSeconds` dilimi içinde ikinci iş açılmaz
 * (pg-boss `singletonKey` + `singletonSeconds`).
 *
 * `run` saf işleyicidir: yalnız verilen bağımlılıkları ve `now`'ı kullanır, idempotenttir (pg-boss
 * en az bir kez teslim eder; ikinci çalıştırma sonucu değiştirmez) ve yalnız sayı döndürür (log ve
 * iş sonucu olarak saklanır; kişisel veri yok).
 */
export interface InstitutionJob<R extends Record<string, number | string | null>> {
  /** Kuyruk adı, noktalı İngilizce (`idempotency.purge`). */
  name: string
  /** Beş alanlı cron ifadesi, Europe/Istanbul saatiyle. */
  cron: string
  slotSeconds: number
  run(deps: JobDeps, data: InstitutionJobData, now: Date): Promise<R>
}

export type AnyInstitutionJob = InstitutionJob<Record<string, number | string | null>>
