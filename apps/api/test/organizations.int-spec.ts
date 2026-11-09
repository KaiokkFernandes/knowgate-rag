import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createApp } from './setup/create-app';
import { registerUser, type TestUser } from './setup/users';

const MISSING_ID = '01a1b2c3-0000-7000-8000-000000000001';

describe('Organizations, members and teams (integration)', () => {
  let app: INestApplication<App>;
  let pool: Pool;

  beforeAll(async () => {
    app = await createApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1000' });
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  /** Request as a given user. */
  const as = (user: TestUser) => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${user.token}`);
    const server = () => request(app.getHttpServer());
    return {
      get: (path: string) => auth(server().get(path)),
      post: (path: string, body?: object) => auth(server().post(path)).send(body),
      patch: (path: string, body: object) => auth(server().patch(path)).send(body),
      put: (path: string) => auth(server().put(path)),
      delete: (path: string) => auth(server().delete(path)),
    };
  };

  async function createOrg(owner: TestUser, name = 'Acme'): Promise<string> {
    const response = await as(owner).post('/orgs', { name }).expect(201);
    return (response.body as { id: string }).id;
  }

  async function addMember(admin: TestUser, orgId: string, user: TestUser, role = 'MEMBER') {
    await as(admin).post(`/orgs/${orgId}/members`, { email: user.email, role }).expect(201);
  }

  async function createTeam(admin: TestUser, orgId: string, name = 'RH'): Promise<string> {
    const response = await as(admin).post(`/orgs/${orgId}/teams`, { name }).expect(201);
    return (response.body as { id: string }).id;
  }

  describe('organizations', () => {
    it('makes the creator ADMIN with the default daily token limit', async () => {
      const owner = await registerUser(app);

      const response = await as(owner).post('/orgs', { name: '  Acme  ' }).expect(201);
      const me = await as(owner).get('/me').expect(200);

      expect(response.body).toMatchObject({
        name: 'Acme',
        role: 'ADMIN',
        dailyTokenLimit: 200_000,
      });
      expect(me.body).toMatchObject({
        organizations: [{ id: (response.body as { id: string }).id, name: 'Acme', role: 'ADMIN' }],
      });
    });

    it('rejects an invalid name (400)', async () => {
      const owner = await registerUser(app);

      await as(owner).post('/orgs', { name: '   ' }).expect(400);
    });

    it('requires authentication before checking membership (401, not 404)', async () => {
      const orgId = await createOrg(await registerUser(app));

      await request(app.getHttpServer()).get(`/orgs/${orgId}`).expect(401);
    });

    it('hides organizations from non-members (404, same as a missing one)', async () => {
      const orgId = await createOrg(await registerUser(app));
      const outsider = await registerUser(app);

      await as(outsider).get(`/orgs/${orgId}`).expect(404);
      await as(outsider).get(`/orgs/${MISSING_ID}`).expect(404);
      await as(outsider).get('/orgs/not-a-uuid').expect(404);
    });
  });

  describe('members', () => {
    let admin: TestUser;
    let orgId: string;

    beforeEach(async () => {
      admin = await registerUser(app);
      orgId = await createOrg(admin);
    });

    it('lets an admin add an existing user by e-mail, case-insensitively', async () => {
      const user = await registerUser(app);

      const response = await as(admin)
        .post(`/orgs/${orgId}/members`, { email: user.email.toUpperCase() })
        .expect(201);

      expect(response.body).toMatchObject({ userId: user.id, role: 'MEMBER' });
      await as(admin).post(`/orgs/${orgId}/members`, { email: user.email }).expect(409);
      await as(admin).post(`/orgs/${orgId}/members`, { email: 'nobody@example.test' }).expect(404);
    });

    it('lets members read but not manage (403)', async () => {
      const member = await registerUser(app);
      const other = await registerUser(app);
      await addMember(admin, orgId, member);

      const list = await as(member).get(`/orgs/${orgId}/members`).expect(200);

      expect(list.body).toHaveLength(2);
      await as(member).post(`/orgs/${orgId}/members`, { email: other.email }).expect(403);
      await as(member).patch(`/orgs/${orgId}/members/${admin.id}`, { role: 'MEMBER' }).expect(403);
      await as(member).delete(`/orgs/${orgId}/members/${admin.id}`).expect(403);
    });

    it('lets a member leave, revoking access immediately with the same token', async () => {
      const member = await registerUser(app);
      await addMember(admin, orgId, member);

      await as(member).delete(`/orgs/${orgId}/members/${member.id}`).expect(204);

      await as(member).get(`/orgs/${orgId}`).expect(404);
    });

    it('applies role changes on the next request (roles are not in the token)', async () => {
      const member = await registerUser(app);
      await addMember(admin, orgId, member);
      await as(member).post(`/orgs/${orgId}/teams`, { name: 'Eng' }).expect(403);

      await as(admin).patch(`/orgs/${orgId}/members/${member.id}`, { role: 'ADMIN' }).expect(200);

      await as(member).post(`/orgs/${orgId}/teams`, { name: 'Eng' }).expect(201);
    });

    it('never leaves the organization without an admin (409)', async () => {
      await as(admin).patch(`/orgs/${orgId}/members/${admin.id}`, { role: 'MEMBER' }).expect(409);
      await as(admin).delete(`/orgs/${orgId}/members/${admin.id}`).expect(409);
    });

    it('keeps one admin when two admins demote each other at the same time', async () => {
      const second = await registerUser(app);
      await addMember(admin, orgId, second, 'ADMIN');

      for (let round = 0; round < 5; round++) {
        await pool.query(`UPDATE "Membership" SET role = 'ADMIN' WHERE "organizationId" = $1`, [
          orgId,
        ]);

        const statuses = (
          await Promise.all([
            as(admin).patch(`/orgs/${orgId}/members/${second.id}`, { role: 'MEMBER' }),
            as(second).patch(`/orgs/${orgId}/members/${admin.id}`, { role: 'MEMBER' }),
          ])
        )
          .map((r) => r.status)
          .sort();

        // One wins; the other is blocked (409 last admin, or 403 if already demoted).
        expect(statuses[0]).toBe(200);
        expect([403, 409]).toContain(statuses[1]);
        const { rows } = await pool.query<{ count: string }>(
          `SELECT count(*) FROM "Membership" WHERE "organizationId" = $1 AND role = 'ADMIN'`,
          [orgId],
        );
        expect(rows[0]?.count).toBe('1');
      }
    });
  });

  describe('teams', () => {
    let admin: TestUser;
    let orgId: string;

    beforeEach(async () => {
      admin = await registerUser(app);
      orgId = await createOrg(admin);
    });

    it('lets admins create teams with unique names per organization', async () => {
      const member = await registerUser(app);
      await addMember(admin, orgId, member);

      await createTeam(admin, orgId, 'RH');

      await as(admin).post(`/orgs/${orgId}/teams`, { name: 'RH' }).expect(409);
      await as(member).post(`/orgs/${orgId}/teams`, { name: 'Eng' }).expect(403);
      // Same name in another organization is fine.
      const otherAdmin = await registerUser(app);
      await createTeam(otherAdmin, await createOrg(otherAdmin), 'RH');
    });

    it('adds organization members to a team, idempotently', async () => {
      const member = await registerUser(app);
      await addMember(admin, orgId, member);
      const teamId = await createTeam(admin, orgId);

      await as(admin).put(`/orgs/${orgId}/teams/${teamId}/members/${member.id}`).expect(204);
      await as(admin).put(`/orgs/${orgId}/teams/${teamId}/members/${member.id}`).expect(204);

      const list = await as(member).get(`/orgs/${orgId}/teams/${teamId}/members`).expect(200);
      expect(list.body).toEqual([expect.objectContaining({ userId: member.id })]);
      const teams = await as(member).get(`/orgs/${orgId}/teams`).expect(200);
      expect(teams.body).toEqual([expect.objectContaining({ id: teamId, memberCount: 1 })]);
    });

    it('refuses to add someone who is not a member of the organization', async () => {
      const outsider = await registerUser(app);
      const teamId = await createTeam(admin, orgId);

      await as(admin).put(`/orgs/${orgId}/teams/${teamId}/members/${outsider.id}`).expect(404);
    });

    it('does not reach a team of another organization through its own route (IDOR)', async () => {
      const otherAdmin = await registerUser(app);
      const otherOrgId = await createOrg(otherAdmin, 'Globex');
      const foreignTeam = await createTeam(otherAdmin, otherOrgId, 'Secret');

      await as(admin).get(`/orgs/${orgId}/teams/${foreignTeam}/members`).expect(404);
      await as(admin).put(`/orgs/${orgId}/teams/${foreignTeam}/members/${admin.id}`).expect(404);
      await as(admin).delete(`/orgs/${orgId}/teams/${foreignTeam}`).expect(404);
      // And the foreign team is untouched.
      await as(otherAdmin).get(`/orgs/${otherOrgId}/teams/${foreignTeam}/members`).expect(200);
    });

    it('removes team memberships when the user leaves the organization', async () => {
      const member = await registerUser(app);
      await addMember(admin, orgId, member);
      const teamId = await createTeam(admin, orgId);
      await as(admin).put(`/orgs/${orgId}/teams/${teamId}/members/${member.id}`).expect(204);

      await as(admin).delete(`/orgs/${orgId}/members/${member.id}`).expect(204);

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM "TeamMember" WHERE "userId" = $1`,
        [member.id],
      );
      expect(rows[0]?.count).toBe('0');
    });

    it('deletes a team and its memberships', async () => {
      const member = await registerUser(app);
      await addMember(admin, orgId, member);
      const teamId = await createTeam(admin, orgId);
      await as(admin).put(`/orgs/${orgId}/teams/${teamId}/members/${member.id}`).expect(204);

      await as(admin).delete(`/orgs/${orgId}/teams/${teamId}`).expect(204);

      await as(admin).delete(`/orgs/${orgId}/teams/${teamId}`).expect(404);
      await as(admin).get(`/orgs/${orgId}/teams/${teamId}/members`).expect(404);
    });
  });
});
