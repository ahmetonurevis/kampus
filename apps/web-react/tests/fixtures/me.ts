// `GET /api/v1/me` yanıt fabrikası. Varsayılan geçerlidir; testler yalnız ilgili alanı değiştirir.
// Kimlikler önekli; kayıt kimlikleri school-core örnek verisiyle aynı (s1, s2, t1).
import type { Me } from '../../src/auth/session-mapping.ts'
import type { RoleKey } from '../../src/lib/navigation.ts'

type Links = NonNullable<Me['activeMembership']>['links']

const LINKS: Record<RoleKey, Links> = {
  yonetici: [],
  onburo: [],
  ogretmen: [{ kind: 'teacher', recordId: 't1' }],
  ogrenci: [{ kind: 'student', recordId: 's1' }],
  veli: [
    { kind: 'child', recordId: 's1' },
    { kind: 'child', recordId: 's2' },
  ],
}

export function meFixture(role: RoleKey = 'yonetici', patch: Partial<Me> = {}): Me {
  return {
    user: { id: 'test-user', name: 'Test Kullanıcı', email: 'test@kampus.test' },
    activeInstitution: {
      id: 'test-inst-a',
      name: 'Test Okulu',
      slug: 'test-okulu',
      type: 'school',
      enabledModules: {},
      academicYear: null,
    },
    activeMembership: { id: 'test-member-a', role, links: LINKS[role] },
    memberships: [
      {
        id: 'test-member-a',
        institutionId: 'test-inst-a',
        institutionName: 'Test Okulu',
        institutionType: 'school',
        role,
      },
    ],
    ...patch,
  }
}
