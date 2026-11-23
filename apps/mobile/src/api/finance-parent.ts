// Veli Finans & Ödeme Planı ve Dekontlar ekranlarının saf karar ve sorguları (ON-078; IST-107,
// IST-124). Satır görünümü web ile ortak katmandadır (`@kampus/react-shared/finance-parent-model.ts`);
// burada yalnız ekranın açılma kararı, taksit sorgusu, kapsam hatasının okunması ve istemci sayfası
// vardır. Kapsamı (velayetli ve kısıtsız ya da ödeyici veli) sunucu uygular; ekran süzmez.
import type { ApiError } from '@kampus/api-client/errors.ts'
import type { CollectionQuery, CollectionSort } from '@kampus/react-shared/collections.ts'
import { isModuleDisabledError } from '@kampus/react-shared/collections.ts'
import { isInvoiceStatusKey } from '@kampus/react-shared/finance-model.ts'
import { INVOICE_STATUS_LABELS } from '@kampus/school-core/lib/format.ts'
import { navigation } from '@kampus/school-core/modules/full-navigation.ts'
import { API_PAGE_SIZE, type ListState } from './list-state.ts'
import { isModuleOpen, type MobileSession } from './session-state.ts'

/** Veli menüsündeki sayfa yolları (`full-navigation.ts`, `veli/finans`, `veli/dekontlar`). */
export const PARENT_FINANCE_PATH = 'finans'
export const PARENT_RECEIPTS_PATH = 'dekontlar'
export type ParentFinancePath = typeof PARENT_FINANCE_PATH | typeof PARENT_RECEIPTS_PATH

/**
 * Ekran açık mı: yalnız veli ve sayfanın modülü (finans) kurumda açıkken. Öğrenci ödemeleri
 * telefonda gösterilmez (kayıt da öğrenciye bu sayfaları bağlamaz); kapalı modülde sunucu da 403
 * `module_disabled` döner.
 */
export function canOpenParentFinance(
  session: Pick<MobileSession, 'role' | 'modules'>,
  path: ParentFinancePath,
): boolean {
  if (session.role !== 'veli') return false
  const page = navigation.veli.find((item) => item.path === path)
  return page !== undefined && isModuleOpen(session.modules, page.module)
}

/** Vadeye göre, eşitlikte kimlik: web varsayılanı, sayfalar arası kararlı sıra. */
const INVOICE_SORT: readonly CollectionSort[] = ['dueDate', 'id']

/** Seçili çocuğun taksitleri: durum süzgeci ve sayfa sunucuda uygulanır. */
export function familyInvoiceQuery(childId: string, state: ListState): CollectionQuery {
  return {
    page: state.index + 1,
    pageSize: API_PAGE_SIZE,
    sort: INVOICE_SORT,
    filters: {
      studentId: childId,
      ...(isInvoiceStatusKey(state.filter) ? { status: INVOICE_STATUS_LABELS[state.filter] } : {}),
    },
  }
}

/**
 * Kapsam dışı öğrenci: bakiye, ekstre ve tahsilat uçları başka öğrencide 404, yetkisiz rolde 403
 * verir (iletişim kısıtlı veli finans okumaz). Ekran bunu hata değil boş durum olarak anlatır;
 * kapalı modül ayrı mesajdır (`QueryError`).
 */
export function isFinanceOutOfScope(error: ApiError): boolean {
  if (isModuleDisabledError(error)) return false
  return error.status === 404 || error.status === 403
}

export const OUT_OF_SCOPE_NOTICE = {
  title: 'Ödeme bilgisi görüntülenemiyor',
  text: 'Bu öğrencinin ödeme bilgileri hesabınıza açık değil. Bilgi için okulla iletişime geçin.',
} as const

/** Sunucunun tek yanıtta verdiği küçük listeler (tahsilat, ekstre) telefonda sayfalanır. */
export function pageSlice<T>(items: readonly T[], index: number, size = API_PAGE_SIZE): T[] {
  return items.slice(index * size, index * size + size)
}
