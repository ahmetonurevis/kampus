import { roleSchema } from '../auth.ts'
import type { Database } from '../db/client.ts'
import { AuthenticationError } from '../errors.ts'
import {
  findMembership,
  getInstitution,
  getUser,
  listMembershipLinks,
  listUserMemberships,
} from './memberships.ts'

/** Oturum sahibinin kimliği, üyelikleri ve etkin kurumu. Rolü tanınmayan üyelik listelenmez. */
export async function describeSession(
  db: Database,
  session: { userId: string; activeInstitutionId: string | null },
) {
  const user = await getUser(db, session.userId)
  if (!user) throw new AuthenticationError()
  const all = await listUserMemberships(db, session.userId)
  const memberships = all.flatMap((row) => {
    const role = roleSchema.safeParse(row.role)
    return role.success ? [{ ...row, role: role.data }] : []
  })
  const institutionId = session.activeInstitutionId
  const membership = institutionId ? await findMembership(db, institutionId, user.id) : null
  const role = roleSchema.safeParse(membership?.role)
  if (!institutionId || !membership || !role.success)
    return { user, activeInstitution: null, activeMembership: null, memberships }
  return {
    user,
    activeInstitution: await getInstitution(db, institutionId),
    activeMembership: {
      id: membership.id,
      role: role.data,
      links: await listMembershipLinks(db, institutionId, membership.id),
    },
    memberships,
  }
}
