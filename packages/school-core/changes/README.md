# Değişiklik parçaları

Dalda yapılan her davranış değişikliği bu klasöre tek, kısa bir dosya ekler: `<konu>.md` (dal konusuyla aynı, kebab-case). Paralel dallar ayrı dosya yazdığı için CHANGELOG çakışmaz. Kural: `docs/muhendislik/git-ve-surum.md` §4–§5.

```md
---
etki: minor
---

- Okuma-anlama modülü eklendi: … (kullanıcıya ve tüketiciye etkisi)
```

- `etki`: `major`, `minor` veya `patch`. Satırlar Türkçe, geçmiş zaman edilgen; kırıcı satır "**Kırıcı:**" ile başlar ve geçiş adımını verir.
- Teslimde parçalar `CHANGELOG.md`'ye yeni `## x.y.z` başlığıyla derlenir, sürüm verilir ve bu dosya dışındaki parçalar silinir.
