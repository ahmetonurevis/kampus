---
etki: minor
---

- Demirbaş sayımı kuralı eklendi (`lib/finance-fixed-asset-counts.ts`, DOM-FIN-087): bütün kurum, kampüs ya da oda kapsamında sayım başlatma ve beklenen listenin dondurulması (`planFixedAssetCountStart`, `fixedAssetCountSchema`, kapsam anahtarı `fixedAssetCountScopeKey` ile aynı kapsamda tek açık sayım), karekod/etiket okutması (`planFixedAssetCountScan`, `fixedAssetCountScanSchema`, `normalizeFixedAssetCountCode`): bulundu, yanlış konumda, listede olmayan kurum demirbaşı; bilinmeyen kod ve hurdaya ayrılmış demirbaş reddedilir. Tamamlama ve iptal (`planFixedAssetCountClose`), tamamlanmış sayımda konum düzeltmesi (`planFixedAssetCountRelocate`), rapor sonucu (`fixedAssetCountOutcome`) ve sonuç CSV'si (`fixedAssetCountCsv`).
