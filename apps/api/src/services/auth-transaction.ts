import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createInternalAdapter } from 'better-auth/db'
import { getOrgAdapter } from 'better-auth/plugins/organization'

import { ORGANIZATION_OPTIONS, type Auth } from '../auth.ts'
import { schema, type Database } from '../db/client.ts'

type OrgContext = Parameters<typeof getOrgAdapter>[0]

/**
 * Better Auth yazmalarını (kullanıcı, üyelik, davet, oturum) bizim transaction'ımıza katar.
 *
 * Better Auth'un bağdaştırıcısı, iç bağdaştırıcısı (`createInternalAdapter`) ve organization
 * eklentisinin bağdaştırıcısı (`getOrgAdapter`) burada bizim Drizzle işlemimiz üzerine kurulur.
 * Böylece kimlik tablolarına yazma Better Auth'un kendi API'sinden geçer (alan eşlemesi, kimlik
 * üretimi, veritabanı kancaları; `.claude/rules/veritabani.md`: kimlik tablolarına doğrudan
 * `update`/`delete` yazılmaz) ama denetim kaydı ve uygulama satırlarıyla aynı transaction'dadır:
 * işlem geri alınırsa hiçbir Better Auth satırı kalmaz. `auth.api.*` uçları kullanılmaz; onlar
 * kendi bağdaştırıcılarıyla ayrı bağlantıdan yazar ve tek transaction kuralını bozar.
 */
export async function authTransaction(auth: Auth, tx: Database) {
  const context = await auth.$context
  // `auth.ts` ile aynı ayarlar; `transaction: false` çünkü işlem zaten açık.
  const adapter = drizzleAdapter(tx, {
    provider: 'pg',
    schema,
    usePlural: true,
    transaction: false,
  })(context.options)
  const { options } = context
  // Better Auth `create-context` ile aynı kanca listesi: kullanıcı ve oturum kancaları da çalışır.
  const internalAdapter = createInternalAdapter(adapter, {
    options,
    logger: context.logger,
    hooks: options.databaseHooks ? [{ source: 'user', hooks: options.databaseHooks }] : [],
    generateId: context.generateId,
  })
  // Bağlam tipi kurumun ayar tipiyle özelleşmiştir; eklenti genel `AuthContext` bekler (aynı
  // nesne, yalnız bağdaştırıcıları işleme bağlanmış).
  const bound: OrgContext = Object.assign(Object.create(null) as OrgContext, context, {
    adapter,
    internalAdapter,
  })
  return { adapter, internalAdapter, organization: getOrgAdapter(bound, ORGANIZATION_OPTIONS) }
}

export type AuthTransaction = Awaited<ReturnType<typeof authTransaction>>
