import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

/**
 * Share tokens against a real database.
 *
 * These cover what the pure crypto tests cannot: revocation actually taking
 * effect, ownership scoping, and the issue limit. They need Postgres, so the
 * whole suite SKIPS when none is configured — a developer without Docker
 * running still gets a green, meaningful `bun test`, and CI (which provides a
 * postgres service) runs the full thing.
 *
 * Set `TEST_DATABASE_URL` to point at a throwaway database. It must NOT be a
 * database anyone cares about: the suite creates and deletes users.
 *
 *   docker compose -f docker-compose.dev.yml up -d
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/reimbursement \
 *     bun test
 */

const TEST_DB = process.env.TEST_DATABASE_URL;

// Point the app's own db module at the test database BEFORE importing anything
// that touches it — `src/db.ts` reads DATABASE_URL at module-evaluation time
// and throws when it is missing.
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const describeDb = TEST_DB ? describe : describe.skip;

if (!TEST_DB) {
  console.log(
    '[share-tokens.integration] skipped — set TEST_DATABASE_URL to run (see the file header)',
  );
}

describeDb('share tokens (database)', () => {
  // Imported dynamically: a static import would be evaluated even when the
  // suite is skipped, and `src/db.ts` throws without DATABASE_URL.
  let tokens: typeof import('../src/share_tokens');
  let prisma: (typeof import('../src/db'))['prisma'];

  const userIds: string[] = [];

  async function makeUser(name: string): Promise<string> {
    const user = await prisma.user.create({
      data: { name, initials: name.slice(0, 2), role: 'EMPLOYEE' },
    });
    userIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    tokens = await import('../src/share_tokens');
    ({ prisma } = await import('../src/db'));
  });

  afterAll(async () => {
    // Tokens cascade with the user, so deleting the users is enough.
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  });

  test('a freshly issued token resolves to its owner', async () => {
    const userId = await makeUser('Issue Owner');
    const issued = await tokens.issueShareToken(userId, 'iPhone ทดสอบ');

    const resolved = await tokens.resolveShareToken(issued.token);
    expect(resolved?.id).toBe(userId);
  });

  test('the plaintext is never stored — only its hash', async () => {
    const userId = await makeUser('Hash Only');
    const issued = await tokens.issueShareToken(userId, '');

    const row = await prisma.shareToken.findUnique({ where: { id: issued.id } });
    expect(row).not.toBeNull();
    expect(row!.tokenHash).not.toBe(issued.token);
    expect(row!.tokenHash).toBe(tokens.hashShareToken(issued.token));
  });

  test('a revoked token stops resolving immediately', async () => {
    const userId = await makeUser('Revoker');
    const issued = await tokens.issueShareToken(userId, '');

    expect(await tokens.resolveShareToken(issued.token)).not.toBeNull();
    expect(await tokens.revokeShareToken(userId, issued.id)).toBe(true);
    expect(await tokens.resolveShareToken(issued.token)).toBeNull();
  });

  test('revoking twice reports false the second time rather than throwing', async () => {
    const userId = await makeUser('Double Revoke');
    const issued = await tokens.issueShareToken(userId, '');

    expect(await tokens.revokeShareToken(userId, issued.id)).toBe(true);
    expect(await tokens.revokeShareToken(userId, issued.id)).toBe(false);
  });

  // The authorization test that matters: ids are guessable in principle, so
  // ownership has to be enforced in the query, not by a check the caller does.
  test('one employee cannot revoke another employee’s token', async () => {
    const ownerId = await makeUser('Token Owner');
    const attackerId = await makeUser('Attacker');
    const issued = await tokens.issueShareToken(ownerId, '');

    expect(await tokens.revokeShareToken(attackerId, issued.id)).toBe(false);
    // And the token still works for its real owner.
    expect((await tokens.resolveShareToken(issued.token))?.id).toBe(ownerId);
  });

  test('a well-formed token that was never issued resolves to null', async () => {
    const neverIssued = `hfr_${'0'.repeat(64)}`;
    expect(await tokens.resolveShareToken(neverIssued)).toBeNull();
  });

  test('a malformed token resolves to null without hitting the database', async () => {
    expect(await tokens.resolveShareToken('not-a-token')).toBeNull();
    expect(await tokens.resolveShareToken('')).toBeNull();
  });

  test('listing returns only the caller’s live tokens, never the hash', async () => {
    const mineId = await makeUser('Lister');
    const otherId = await makeUser('Other Lister');
    await tokens.issueShareToken(mineId, 'เครื่องที่หนึ่ง');
    const revoked = await tokens.issueShareToken(mineId, 'เครื่องที่สอง');
    await tokens.issueShareToken(otherId, 'ของคนอื่น');
    await tokens.revokeShareToken(mineId, revoked.id);

    const listed = await tokens.listShareTokens(mineId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.label).toBe('เครื่องที่หนึ่ง');
    expect(listed[0]).not.toHaveProperty('tokenHash');
  });

  test('issuing stops at the per-user limit, and revoking frees a slot', async () => {
    const userId = await makeUser('Limit Tester');
    const issued = [];
    for (let i = 0; i < tokens.MAX_TOKENS_PER_USER; i += 1) {
      issued.push(await tokens.issueShareToken(userId, `เครื่อง ${i}`));
    }

    await expect(tokens.issueShareToken(userId, 'one too many')).rejects.toBeInstanceOf(
      tokens.ShareTokenLimitError,
    );

    await tokens.revokeShareToken(userId, issued[0]!.id);
    // A revoked token does not count against the limit.
    await expect(tokens.issueShareToken(userId, 'replacement')).resolves.toBeDefined();
  });

  test('using a token stamps lastUsedAt', async () => {
    const userId = await makeUser('Stamper');
    const issued = await tokens.issueShareToken(userId, '');
    expect(issued.lastUsedAt).toBeNull();

    await tokens.resolveShareToken(issued.token);

    // The stamp is fire-and-forget so an upload is never blocked on bookkeeping;
    // give it a moment to land before asserting.
    await Bun.sleep(150);
    const row = await prisma.shareToken.findUnique({ where: { id: issued.id } });
    expect(row!.lastUsedAt).not.toBeNull();
  });
});
