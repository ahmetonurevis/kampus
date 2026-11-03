/**
 * Yazma taslağı otomatik kaydının saf mantığı (IST-047). React'ten bağımsızdır: kayıt isteği
 * dışarıdan verilir. Kayıtlar sıralıdır; kısayol ("zaten kayıtlı") yalnız ekrandaki metin
 * kaydedilmiş metinle aynıysa VE o kaydın revizyonu sunucudaki güncel revizyonsa kullanılır.
 * Kaydedilmiş metin (`savedBody`) yalnız başarılı kayıttan ve sunucudan gelen taslaktan
 * (`sync`) güncellenir; böylece "kaydedilmemiş değişiklik" ve teslim güncel metne göre karar verir.
 * Kayıt hatasında otomatik yeniden deneme yoktur (409 sonrası başka pencerenin metninin üstüne
 * sessizce yazılmasın diye); metin kirli kalır, sonraki değişiklik ya da "Teslim et" yeniden dener.
 */

/** Yazmayı bıraktıktan sonra otomatik kayda kadar beklenen süre. */
export const DRAFT_DELAY_MS = 1500

export type DraftSnapshot = { revision: number; body: string; savedAt: string | null }

export type SaveResult = { ok: true; revision: number; savedAt: string | null } | { ok: false }

export type DraftSubmit = (input: { revision: number | null; body: string }) => Promise<SaveResult>

export type DraftSaverOptions = {
  /** Kayıt isteği; sonradan `setSubmit` ile değiştirilebilir (React her çizimde yenisini verir). */
  submit?: DraftSubmit
  /** Açılıştaki taslak; yoksa `null` ve `initialBody` "kaydedilmiş" sayılır (boşuna kayıt atılmaz). */
  draft: DraftSnapshot | null
  initialBody: string
  /** Otomatik kayıt gecikmesi (varsayılan `DRAFT_DELAY_MS`). */
  delayMs?: number
}

/** Sunucudaki yeni revizyonun ekrandaki duruma etkisi. */
export type SyncOutcome =
  /** Yeni bir şey yok. */
  | { kind: 'none' }
  /** Ekranda kaydedilmemiş değişiklik yoktu: ekran metni sunucu metnine alınır. */
  | { kind: 'adopt'; body: string; savedAt: string | null }
  /** Kaydedilmemiş değişiklik var: revizyon güncellendi, bir sonraki teslim/kayıt onay ister. */
  | { kind: 'conflict' }

export function createDraftSaver(options: DraftSaverOptions) {
  let revision: number | null = options.draft?.revision ?? null
  let savedBody = options.draft?.body ?? options.initialBody
  /** `savedBody`'nin kaydedildiği revizyon; güncel revizyondan farklıysa kısayol kapanır. */
  let savedRevision: number | null = revision
  let running: Promise<boolean> | null = null
  /** Başka pencerenin değişikliği öğrenciye bildirildi mi (409 mesajı ya da çakışma uyarısı). */
  let informed = false
  let conflict = false
  let submit: DraftSubmit | undefined = options.submit
  let timer: ReturnType<typeof setTimeout> | undefined
  const delayMs = options.delayMs ?? DRAFT_DELAY_MS

  const isDirty = (text: string) => text !== savedBody || savedRevision !== revision

  function cancel() {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  async function save(text: string): Promise<boolean> {
    if (running) await running
    if (text === savedBody && revision !== null && savedRevision === revision) return true
    const run = (async () => {
      // Kayıt komutu hata fırlatmaz; yine de beklenmeyen bir istisna başarısız kayıt sayılır.
      const result = submit
        ? await submit({ revision, body: text }).catch((error: unknown): SaveResult => {
            console.error('[kampus]', 'draft-save-failed', error)
            return { ok: false }
          })
        : ({ ok: false } as const)
      if (!result.ok) {
        // Başarısız kayıt (409 dahil) komutun toast'ıyla bildirilir; ikinci basış serbesttir.
        informed = true
        return false
      }
      revision = result.revision
      savedRevision = result.revision
      savedBody = text
      informed = false
      conflict = false
      return true
    })()
    running = run
    try {
      return await run
    } finally {
      if (running === run) running = null
    }
  }

  return {
    save,
    setSubmit(next: DraftSubmit) {
      submit = next
    },
    /**
     * Otomatik kaydı (yeniden) kurar: her çağrı önceki zamanlayıcıyı iptal eder, kayıt son
     * değişiklikten `delayMs` sonra yapılır. Kirli olmayan, boş ya da çakışmalı metin kurulmaz.
     */
    schedule(text: string) {
      cancel()
      if (conflict || !isDirty(text) || text.trim() === '') return
      timer = setTimeout(() => {
        timer = undefined
        void save(text)
      }, delayMs)
    },
    /** Bekleyen otomatik kaydı iptal eder (alan kilitlendi ya da bileşen kaldırıldı). */
    cancel,
    /** Bekleyen otomatik kayıt var mı. */
    hasPending: () => timer !== undefined,
    /**
     * Teslimden önce bekleyen kaydı tamamlar; teslim edilecek revizyonu döndürür. Başka pencerenin
     * değişikliği öğrenciye henüz bildirilmediyse kayıt atılmaz ve `null` döner (ilk basış bildirir).
     */
    async flush(text: string): Promise<number | null> {
      cancel()
      if (conflict) {
        conflict = false
        informed = true
        return null
      }
      return (await save(text)) ? revision : null
    },
    /** Sunucudan gelen güncel taslağı işler; `screenText` ekrandaki metindir. */
    sync(latest: DraftSnapshot, screenText: string): SyncOutcome {
      if (latest.revision === revision) return { kind: 'none' }
      revision = latest.revision
      if (screenText === savedBody) {
        savedBody = latest.body
        savedRevision = latest.revision
        return latest.body === screenText
          ? { kind: 'none' }
          : { kind: 'adopt', body: latest.body, savedAt: latest.savedAt }
      }
      if (!informed) conflict = true
      return { kind: 'conflict' }
    },
    /** Kaydedilmemiş değişiklik var ve başka pencerenin kaydı henüz onaylanmadı. */
    hasConflict: () => conflict,
    /** Ekran metni kayıtlı metinden farklı mı (otomatik kayıt gerekir mi). */
    isDirty,
    revision: () => revision,
  }
}

export type DraftSaver = ReturnType<typeof createDraftSaver>
