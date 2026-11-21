---
etki: patch
---

- Personelin sürüm puanlama durumuna `secondRatingRequestUsed` eklendi (OG-1012; DOM-BEC-024): teslim için ikinci puanlama istemi yapılıp yapılmadığını sürümden bağımsız söyler, puan taşımaz. Yeniden teslimle gelen sürüm kapsamda değilken de `true` kalır; web bu durumda "İkinci değerlendirici iste" düğmesini açmaz ve bilgi metni gösterir.
