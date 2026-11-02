---
etki: minor
---

Ses dönüştürme işi eklendi (OG-262; ADR 0003 karar 10; DOM-BEC-054). `speaking_recording` ve `listening_audio` yüklemesi `processing` başlar; `media.transcode` işi (pg-boss, sistem `ffmpeg`/`ffprobe`) sesi AAC-LC/M4A, mono, 48 kHz'e çevirir, süreyi `durationMs`'e yazar, türü `audio/mp4` yapar ve özgün nesneyi siler. Boş, tamamen sessiz, çözülemeyen ya da amaç sınırını aşan kayıt `rejected` olur. Böylece gerçek yüklemedeki sesli teslim artık `recording_not_measured` almaz. Kuyruk kapalıyken dönüşüm yüklemeden hemen sonra süreç içinde çalışır. Yeni ortam değişkenleri `FFMPEG_PATH`, `FFPROBE_PATH`; migration 0033 dönüşümün içerik kolonlarını güncellemesine izin verir.
