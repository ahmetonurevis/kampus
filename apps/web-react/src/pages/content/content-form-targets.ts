// İçerik formunun adres değerleri (`?icerik-form=`). Ayrı dosyadadır: başka sayfalar (Materyal
// Kütüphanesi) formu yüklemeden bağlantı kurar.

/** `?icerik-form=yeni`: yeni içerik; başka değer düzenlenen içeriğin kimliğidir. */
export const NEW_CONTENT = 'yeni'
/** `?icerik-form=yeni-materyal`: türü materyal dosyası seçili yeni içerik (Materyal Kütüphanesi). */
export const NEW_MATERIAL = 'yeni-materyal'

export const isNewTarget = (target: string) => target === NEW_CONTENT || target === NEW_MATERIAL
