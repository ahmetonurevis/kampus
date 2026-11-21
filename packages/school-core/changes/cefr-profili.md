---
etki: minor
---

- CEFR profilinin zaman çizelgesi eklendi (OG-079; IST-060, DOM-BEC-030, DOM-BEC-034): `cefr/timeline.ts`. `levelTimeline` kararları en yeniden eskiye, aynı becerinin (genel seviye ayrı izlenir) bir önceki kararına göre `previousLevel` ve `change` (`first`, `up`, `down`, `same`; `LEVEL_CHANGES`) ile verir. `levelSeries` bir becerinin gerçek karar noktalarını eskiden yeniye (mini grafik), `timelineSkills` kararı olan becerileri (önce genel seviye) verir. `decisionEvidence` kararın dayandığı kanıtları yalnız değişmez `evidence_snapshot` kopyasından özetler: beceri kararında o becerinin, genel kararda bütün kanıtlar; önerinin dayandığı kanıt `basis` ile işaretli; karar anındaki öneri (`suggestedLevel`) ve kararın öneriye uyup uymadığı (`followsSuggestion`). Hiçbiri saklanmaz.
