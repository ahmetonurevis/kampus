---
name: ts-tasima
description: Kampüs kodunu JavaScript'ten TypeScript'e davranış değiştirmeden taşıma yöntemi — paket sırası, tsconfig, node:test ve Expo ayrıntıları, doğrulama. school-core, testler, mobil veya e2e dosyalarını TS'e taşırken kullan. Vue dosyaları taşınmaz (yerini React alır).
---

# TypeScript'e taşıma

Sıra: kök araç zinciri → `packages/school-core` → `tests` (birim) → `apps/mobile` → `tests/e2e`. Her adım ayrı commit; her commit yeşil.

## Kök araç zinciri (bir kez)

- Kök devDependencies: `typescript`, `@types/node`, `typescript-eslint`.
- `tsconfig.base.json`: `strict`, `noEmit`, `target`/`module` `esnext`, `moduleResolution` `bundler`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `isolatedModules`, `skipLibCheck`, `resolveJsonModule`.
- Her paket kendi `tsconfig.json`'u ile tabanı genişletir. Kök `pnpm typecheck` her paketin `typecheck` script'ini koşar (`pnpm -r --if-present typecheck`). CI'a `pnpm typecheck` adımı eklenir.
- ESLint: `typescript-eslint` önerilen kuralları `.ts`/`.tsx` için; mevcut Vue ve JS kuralları korunur.

## Dosya taşıma

1. `git mv x.js x.ts` (JSX → `.tsx`). İçe aktaran bütün yollar `.ts` uzantısına güncellenir (`grep -rn "x.js'"`).
2. Tipler: Zod şemalarından `z.infer`; state tipi `ReturnType<typeof createSeed>`; fonksiyon parametreleri ve dönüşleri açık. Kaçınılmaz `any` → `// TODO(ts): neden`.
3. Davranış değiştirme. Kod okurken bulduğun hatayı not et, ayrı committe düzelt.
4. Node 24 `.ts` dosyalarını doğrudan çalıştırır: birim testleri `node --test tests/*.test.ts`. Enum, namespace ve parametre özelliği kullanılamaz.
5. Expo: `apps/mobile/tsconfig.json` `expo/tsconfig.base`'i genişletir; Metro uzantılı `.ts` içe aktarmalarını çözer, `export:web` ile doğrula.

## Doğrulama

`pnpm typecheck` sıfır hata, `pnpm lint`, `pnpm test`, `pnpm build`, ilgili e2e; mobilde `export:web`. Commit: "<paket> paketini TypeScript'e taşı".
