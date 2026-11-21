import type {
  EmergencyCard,
  EmergencyContact,
} from '@kampus/react-shared/use-finance-emergency-summaries.ts'
import { emergencyAlertLabels } from '@kampus/school-core/lib/finance-emergency-summaries.ts'
import { transportRosterRelationshipLabel } from '@kampus/school-core/lib/finance-transport-roster.ts'

// Acil durum özeti kartının metinleri (DOM-FIN-155; ON-165): ekran ve sınıf PDF'i aynı metni
// kullanır. Uyarı yalnız türdür (tanı ve ilaç adı yok); telefon API'den maskeli gelir.

/** Uyarı metni: `Alerji · Düzenli ilaç`, yoksa `Uyarı yok`. */
export function alertText(card: Pick<EmergencyCard, 'alerts'>): string {
  const labels = emergencyAlertLabels(card.alerts)
  return labels.length === 0 ? 'Uyarı yok' : labels.join(' · ')
}

/** Bugünkü ilaç metni. */
export const medicationTodayText = (card: Pick<EmergencyCard, 'medicationToday'>) =>
  card.medicationToday ? 'Bugün okulda verilecek onaylı ilaç var' : 'Bugün okulda ilaç yok'

/** Kişi metni: `Ayşe Yılmaz (Anne) 0532 *** ** 12`; telefon yoksa `telefon yok`. */
export function contactText(contact: EmergencyContact, phone?: string): string {
  const relationship = transportRosterRelationshipLabel(contact.relationship)
  return [
    contact.name ?? 'Veli',
    relationship === null ? null : `(${relationship})`,
    phone ?? contact.phoneMasked ?? 'telefon yok',
  ]
    .filter((part) => part !== null)
    .join(' ')
}

/** Kartın bütün kişileri tek satırda; kişi yoksa `—`. */
export const contactsText = (card: Pick<EmergencyCard, 'contacts'>) =>
  card.contacts.length === 0 ? '—' : card.contacts.map((item) => contactText(item)).join('; ')
