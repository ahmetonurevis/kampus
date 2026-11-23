import { defineConfig } from 'drizzle-kit'

// `db:generate` yalnız şemayı okur; bağlantı adresi gerekmez. `db:migrate` kendi betiğini kullanır.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema',
  out: './drizzle',
  strict: true,
  verbose: true,
})
