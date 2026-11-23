---
name: ts-tasima
description: Kampüs kodunu JavaScript'ten TypeScript'e davranış değiştirmeden taşıma yöntemi — artımlı geçiş (ts-nocheck ile yeşil commit, sonra dosya dosya), paket sırası, tsconfig, node:test ve Expo ayrıntıları, DomainError dönüşümü, doğrulama. school-core, testler, mobil veya e2e dosyalarını TS'e taşırken kullan. Vue dosyaları taşınmaz (yerini React alır).
---

# TypeScript'e taşıma

Kurallar `.claude/rules/typescript.md`, ayrıntı `docs/muhendislik/kod-yazim.md`. Sıra: kök araç zinciri → `packages/school-core` → `tests` (birim) → `apps/mobile` → `tests/e2e`. Her commit yeşil.

## Kök araç zinciri (bir kez)

- Kök devDependencies: `typescript`, `@types/node`, `typescript-eslint`.
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noEmit`, `module`/`target` `esnext`, `moduleResolution` `bundler`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `isolatedModules`, `skipLibCheck`, `resolveJsonModule`. Paketler kendi `tsconfig.json`'uyla genişletir.
- Kök `pnpm typecheck` = `pnpm -r --if-present typecheck`; CI'da adım olarak bulunur. ESLint `.ts`/`.tsx` için `typescript-eslint`; mevcut JS kuralları korunur.

## Artımlı yöntem

1. **Saf rename ayrı commit:** `git mv x.js x.ts` (JSX → `.tsx`) ve içe aktarma yollarının `.ts` uzantısına güncellenmesi (`grep -rn "x.js'"`) başka hiçbir değişiklik içermez; git benzerlik oranıyla geçmişi izler. Rename'i tip düzeltmesiyle karıştırma.
2. **Yeşil geçiş:** tip hataları çoksa dosyanın başına `// @ts-nocheck — TODO(ts): <neden>` koy, commit yeşil kalsın. Sonra dosya dosya (her biri ayrı commit) işareti kaldırıp tipleri düzelt. İşaretli dosya sayısı yalnız azalır.
3. **Tipler:** Zod şemalarından `z.infer`; state tipi örnek veri üreticisinden; fonksiyon sınırları açık. `any` yerine `unknown` + daraltma; kaçınılmaz olanda `// TODO(ts): neden`. Non-null `!` yalnız testte; kaynak kodda daraltma veya açık hata.
4. **`DomainError` dönüşümü ayrı commit:** string/sonuç nesnesi hatalarını `DomainError`'a çevirmek davranış değişikliğidir (çağıranlar ve testler etkilenir); taşımayla karıştırma, kendi testleriyle gelir.
5. Davranış değiştirme. Okurken bulduğun hatayı not et; ayrı committe ve önce hatayı üreten testle düzelt.
6. Node 24 `.ts` dosyalarını doğrudan çalıştırır (`node --test tests/*.test.ts`); enum, namespace, parametre özelliği yok (`erasableSyntaxOnly`).
7. Expo: `apps/mobile/tsconfig.json` `expo/tsconfig.base`'i genişletir; `export:web` ile doğrula.

## Doğrulama

`dogrula` skill'i: `pnpm typecheck` sıfır hata, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, ilgili e2e; mobilde `export:web`. Commit başlıkları: "<paket> dosyalarını yeniden adlandır", "<dosya> tiplerini tamamla", "<paket> hatalarını DomainError'a çevir".
