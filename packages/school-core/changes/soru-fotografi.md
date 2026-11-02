---
etki: minor
---

- Öğrenci sorusuna fotoğraf eklenebilir (OG-260; DOM-ILT-094): yeni dosya amacı `student_question_photo` (JPEG/PNG/WEBP, en çok 5 MB, soru başına en çok 3; `FILE_PURPOSES`).
- `askQuestionSchema` dosya alanı `files` (dosya adı) yerine `fileIds` oldu; `question_files_unsupported` kalktı. `askQuestion` `options.files` (`QuestionFile`: servisin yüklediği, öğrencinin kendi dosyaları) ile fotoğrafları denetler: en çok `QUESTION_PHOTO_LIMIT` (3), fazlası 422 `question_photo_limit`; listede olmayan 422 `question_photo_unavailable`; başka amaçlı 422 `question_photo_purpose`; tür ve boyut `assertFileAllowed`. Kayda yalnız `fileIds` girer (`QuestionFields.fileIds`).
