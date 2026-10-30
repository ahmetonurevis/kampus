---
paths:
  - '**/*.ts'
  - '**/*.tsx'
  - '**/tsconfig*.json'
---

# TypeScript kuralları

- `strict` açık. `any` yerine `unknown` + daraltma. Taşıma sırasında kaçınılmazsa `// TODO(ts): neden` ile işaretlenir; sayısı artırılmaz.
- Silinebilir sözdizimi (`erasableSyntaxOnly`): enum yerine `as const` nesne + birleşim tipi; namespace ve parametre özelliği yok.
- Domain tipleri Zod şemasından türetilir (`z.infer`); aynı şekil için elle ikinci tip yazılmaz. State tipi örnek veri üreticisinden türetilir.
- Göreli içe aktarmalar uzantılıdır (`./x.ts`); yalnız tip için `import type`.
- Taşıma davranış değiştirmez; davranış değişikliği ayrı committe yapılır.
- Doğrulama: `pnpm typecheck` sıfır hata.
