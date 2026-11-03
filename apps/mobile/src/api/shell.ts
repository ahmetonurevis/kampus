// Mobil API modu kabuk sözleşmesi: ekran kaydına (`screen-registry.ts`) eklenen bir menü ekranının
// kabuktan alacağı her şey buradan içe aktarılır; yeni kanca değil, mevcut kabuk yardımcılarının
// tek giriş noktasıdır. Sunucu verisi ve komutlar `@kampus/react-shared` kancalarıyla doğrudan
// okunur/yazılır (ör. `use-collection.ts` `useCollectionAll`, `use-api-command.ts`); sorgu anahtarı
// etkin kurumu `KampusProvider` üzerinden zaten içerir.
//
// Tipik ekran:
//   const session = useApiSession()              // kullanıcı, rol, etkin kurum, açık modüller
//   const open = canOpenScreen(session, 'Ekran')  // kapalı modül → "Modül kullanıma kapalı"
//   const [selected, setSelected] = useSelectedChild()
//   const childId = resolveChild(session.childIds, selected) // veli: seçili ya da ilk çocuk
//   const list = useListMemory(`ekran:${childId}`)           // arama/süzgeç/sayfa bellekte
//   const notify = useNotify()                               // Türkçe toast
//   sorgu hatası → <QueryError error={…} onRetry={…} />, yükleniyor → <ListLoading label="…" />

/** Oturum: `user`, `role`, `membershipId`, `institution` (`id`, `name`, `type`), `modules`, `childIds`. */
export { useApiSession } from './auth.tsx'
/** Ekran bu rol ve kurumda açık mı (modül kapalıysa ya da rol eşleşmezse `false`). */
export { canOpenScreen } from './pages.ts'
/** Modül anahtarı açık mı; seçili çocuğu hesabın çocuklarına göre çözer. */
export { isModuleOpen, resolveChild, type MobileSession } from './session-state.ts'
/** Veli seçili çocuğu ve liste başına arama/süzgeç/sayfa (yalnız bellekte; cihaza yazılmaz). */
export { useListMemory, useSelectedChild } from './view-memory.tsx'
export { API_PAGE_SIZE, clampPageIndex, withFilter, withSearch } from './list-state.ts'
/** Türkçe toast; teknik ayrıntı gösterilmez. */
export { useNotify } from './toast.tsx'
export { ListLoading, QueryError } from './QueryState.tsx'
export type { ApiScreenProps } from '../route-types.ts'
