import { useEffect } from 'react'

/** Sekme başlığı `<başlık> · Kampüs`; ekran okuyucu ve geçmiş listesi sayfayı ayırt eder. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Kampüs`
  }, [title])
}
