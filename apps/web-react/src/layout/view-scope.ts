import { createContext } from 'react'

/**
 * Görünüm belleği kapsamı (veli için seçili çocuk). Liste durumu ve kaydırma bu kapsamla
 * ayrılır; bir çocuğun araması/sayfası diğerine taşınmaz.
 */
export const ViewScopeContext = createContext('')
