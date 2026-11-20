import type { DepartmentMeeting } from '@kampus/react-shared/use-finance-department-meetings.ts'

// Zümre tutanağı test verisi (DOM-FIN-132; ON-217): form ve PDF testleri aynı ayrıntıyı kullanır.

export const AGENDA_A = '00000000-0000-4000-8000-00000000000a'
export const AGENDA_B = '00000000-0000-4000-8000-00000000000b'

export function meetingFixture(overrides: Partial<DepartmentMeeting> = {}): DepartmentMeeting {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    subjectId: 'math',
    subjectName: 'Matematik',
    kind: 'term_start',
    meetingDate: '2026-09-10',
    location: 'Öğretmenler odası',
    chairMembershipId: 'm-chair',
    chairName: 'Selin Kaya',
    agendaCount: 2,
    status: 'finalized',
    signedDate: '2026-09-12',
    finalizedAt: '2026-09-12T09:00:00.000Z',
    attendeeCount: 3,
    attendedCount: 2,
    decisionCount: 2,
    openDecisionCount: 1,
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-12T09:00:00.000Z',
    version: 3,
    agenda: [
      { id: AGENDA_A, title: 'Açılış ve yoklama', discussion: null },
      {
        id: AGENDA_B,
        title: 'Yıllık planların incelenmesi',
        discussion: 'Planlar kazanımlara göre gözden geçirildi.',
      },
    ],
    attendees: [
      {
        membershipId: 'm-2',
        name: 'Mert Aydın',
        role: 'ogretmen',
        active: true,
        status: 'attended',
      },
      {
        membershipId: 'm-chair',
        name: 'Selin Kaya',
        role: 'ogretmen',
        active: true,
        status: 'attended',
      },
      {
        membershipId: 'm-3',
        name: 'Zeynep Arslan',
        role: 'ogretmen',
        active: false,
        status: 'excused',
      },
    ],
    decisions: [
      {
        id: 'd1',
        number: '2.1',
        agendaItemId: AGENDA_B,
        text: 'Ortak yazılı sınav takvimi hazırlanacak.',
        responsibleMembershipId: 'm-2',
        responsibleName: 'Mert Aydın',
        dueDate: '2026-09-30',
        status: 'open',
        followUpNote: null,
        overdue: true,
        statusChangedAt: '2026-09-12T09:00:00.000Z',
        createdAt: '2026-09-10T09:00:00.000Z',
        version: 1,
      },
      {
        id: 'd2',
        number: '2.2',
        agendaItemId: AGENDA_B,
        text: 'Ders planları paylaşılacak.',
        responsibleMembershipId: 'm-chair',
        responsibleName: 'Selin Kaya',
        dueDate: null,
        status: 'completed',
        followUpNote: 'Paylaşıldı.',
        overdue: false,
        statusChangedAt: '2026-09-20T09:00:00.000Z',
        createdAt: '2026-09-10T09:05:00.000Z',
        version: 2,
      },
    ],
    ...overrides,
  }
}
