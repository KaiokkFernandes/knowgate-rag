import type { Prisma } from '@knowgate/db';
import type { OrgMembership } from '../organizations/org-access';

/**
 * Which documents a membership can see. Always scoped to the organization; members see
 * ORG documents plus TEAMS documents shared with a team they belong to. Admins see every
 * document of the organization, because they manage them.
 */
export function documentAccessWhere(membership: OrgMembership): Prisma.DocumentWhereInput {
  const inOrg = { organizationId: membership.organizationId };
  if (membership.role === 'ADMIN') return inOrg;
  return {
    ...inOrg,
    OR: [
      { visibility: 'ORG' },
      {
        visibility: 'TEAMS',
        documentTeams: { some: { team: { members: { some: { userId: membership.userId } } } } },
      },
    ],
  };
}
