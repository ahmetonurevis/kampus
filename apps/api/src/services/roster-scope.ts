import { GRADUATION_RENEWAL_MATCH } from '@kampus/school-core/lib/student-roster.ts'

import type { EqualsMatch } from '../db/records.ts'

/**
 * Kayıt durumunu (DOM-KAY-026) okuyan komutların `renewals` kısmi yüklemesi: türetme yenileme
 * kayıtlarından yalnız uygulanmış mezuniyetleri okur. Yenileme kaydı her yıl öğrenci sayısı kadar
 * büyür; yoklama gibi sık komutlar kurum kilidi altında hepsini yüklemez. Süzgeç değerleri core'da
 * tek yerdedir (`GRADUATION_RENEWAL_MATCH`); iki alan eşitliği `and` ile birleşir. Yalnız
 * `renewals` yazmayan komutlarda kullanılır: kısmi yüklenen koleksiyonda kayıt silme/arşivleme
 * kararı verilemez.
 */
export const GRADUATION_RENEWALS: { match: readonly EqualsMatch[] } = {
  match: GRADUATION_RENEWAL_MATCH.map(({ field, value }) => ({
    kind: 'equals' as const,
    field,
    values: [value],
  })),
}
