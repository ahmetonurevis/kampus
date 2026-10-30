---
paths:
  - '**/*.ts'
  - '**/*.tsx'
  - '**/tsconfig*.json'
---

# TypeScript kuralları

Ayrıntı: `docs/muhendislik/kod-yazim.md`.

- `strict` ve `noUncheckedIndexedAccess` açık (`tsconfig.base.json`). `any` yerine `unknown` + daraltma. Taşıma sırasında kaçınılmazsa `// TODO(ts): neden` ile işaretlenir; sayısı artırılmaz. `!` yalnız testte.
- Silinebilir sözdizimi (`erasableSyntaxOnly`): enum yerine `as const` nesne + birleşim tipi; namespace ve parametre özelliği yok (sınıf alanları açık yazılır).
- Domain tipleri Zod şemasından türetilir (`z.infer`); aynı şekil için elle ikinci tip yazılmaz. State tipi örnek veri üreticisinden türetilir. Zod yalnız sınırda (HTTP, ortam, dosya, depo).
- Göreli içe aktarmalar uzantılıdır (`./x.ts`); yalnız tip için `import type`. Sıra: `node:*` → dış paket → `@kampus/*` → göreli.
- Adlı dışa aktarım; `export default` yalnız çatı gerektirdiğinde (Expo girişi, yapılandırma dosyaları, `React.lazy` rotası). Barrel `export *` yok.
- İsimler: tanımlayıcılar İngilizce, kullanıcı metni Türkçe; dosya kebab-case, React bileşeni PascalCase `.tsx`, hook `use-<ad>.ts`. Zaman alanı `…At`/`…Date`, para tamsayı kuruş.
- Yalnız `Error` alt sınıfı fırlatılır (`DomainError`, `AppError`); boş `catch` yok; hata ya loglanır ya yeniden fırlatılır (`{ cause }`). Promise'ler `await` edilir veya `void` + `.catch`.
- Birleşim tipi `switch` + `satisfies never` ile tüketilir; yapılandırma nesneleri `satisfies` ile tiplenir.
- Yorum Türkçe ve "neden" odaklı; yorum satırına alınmış kod yok. `TODO(<konu>): neden` biçimi.
- Taşıma davranış değiştirmez; davranış değişikliği ayrı committe yapılır.
- Doğrulama: `pnpm typecheck` (`pnpm -r --if-present typecheck`) sıfır hata.
