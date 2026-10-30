/** Oturum veya `/me` beklenirken: yönlendirme kararı verilmeden önce gösterilir. */
export function SessionPending() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-dvh place-items-center bg-background text-sm text-muted-foreground"
    >
      Oturum bilgileri yükleniyor…
    </div>
  )
}
