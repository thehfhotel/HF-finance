/**
 * "จ่ายผ่าน KBIZ" — the pay-time destination, against a real database and a
 * real (temporary) shared queue directory.
 *
 * WHY THIS FILE EXISTS. `POST /api/bundles/:id/pay-via-kbiz` is the only
 * endpoint in the app that starts money moving, and until this file it had no
 * test at all. The rule it now pins (2026-08-19, owner's decision: "default
 * should be by requestor, approver should select account to transfer every time
 * when approve") is that a pay request with NO destination is REFUSED — the
 * requestor's admin-mapped handle is a default the picker pre-selects, never a
 * fallback the server applies on the approver's behalf.
 *
 * The HTTP code is the least interesting assertion here. What matters, and what
 * every test below checks, is that a refusal leaves the world untouched:
 *
 *   - the bundle is still APPROVED (never claimed into PAYING), with no
 *     `paymentIntentId` and no `payingSince`, and
 *   - NOTHING is in `queue/` — because the bot watches `queue/*.json`, and a
 *     file there is an instruction to a browser that logs into the bank.
 *
 * A test that only read the status code would pass against a version that
 * answered 400 *after* writing the intent.
 *
 * Needs Postgres, so the whole suite SKIPS when none is configured — same
 * convention as `share-tokens.integration.test.ts`, and the reason the deploy
 * gate (`deploy-reimbursement.yml`'s `contract` job) provides a postgres
 * service and sets `TEST_DATABASE_URL` for the reimbursement suite. Root
 * `bun test` collects this file too, with no workspace install, which is why
 * every import below is either a node builtin or DYNAMIC inside `beforeAll`.
 *
 * Set `TEST_DATABASE_URL` to a throwaway database — the suite creates and
 * deletes users, bundles and the `kbiz.payees` setting:
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/reimbursement_test \
 *     bun run test
 */

import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, test } from 'bun:test';

const TEST_DB = process.env.TEST_DATABASE_URL;

// `src/db.ts` reads DATABASE_URL at module-evaluation time and throws without
// it; `src/jwt.ts` does the same with JWT_SECRET. Both have to be in place
// before the dynamic imports in `beforeAll`.
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET ??= 'test-only-jwt-secret';

const describeDb = TEST_DB ? describe : describe.skip;

if (!TEST_DB) {
  console.log(
    '[pay-via-kbiz-destination] skipped — set TEST_DATABASE_URL to run (see the file header)',
  );
}

/** The two bot→api manifests live in `queue/` but are not queue items. */
const MANIFEST_FILES = new Set(['payee-handles.json', 'kbiz-favorites.json']);

describeDb('pay-via-kbiz: the destination is mandatory', () => {
  let prisma: (typeof import('../src/db'))['prisma'];
  let bundlesModule: typeof import('../src/routes/bundles');
  let app: { handle: (request: Request) => Promise<Response> };

  /** The temporary stand-in for `/home/deploy/kbiz-queue`. */
  let queueRoot: string;
  const queueDir = (): string => join(queueRoot, 'queue');

  let approverToken: string;
  let approverId: string;
  const createdUserIds: string[] = [];

  async function makeUser(name: string, role: 'EMPLOYEE' | 'APPROVER'): Promise<string> {
    const user = await prisma.user.create({
      data: { name, initials: name.slice(0, 2), role },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  /** An APPROVED bundle with one receipt — the only state that is payable. */
  async function makePayableBundle(submitterId: string, amount = '250.00'): Promise<string> {
    const bundle = await prisma.bundle.create({
      data: {
        userId: submitterId,
        name: 'ค่าเดินทาง ทดสอบ',
        status: 'APPROVED',
        approvedById: approverId,
        approvedAt: new Date(),
      },
    });
    await prisma.receipt.create({
      data: {
        userId: submitterId,
        bundleId: bundle.id,
        merchant: 'ร้านทดสอบ',
        category: 'อื่นๆ',
        amount,
        date: '2026-08-19',
      },
    });
    return bundle.id;
  }

  /** `User.id` → payee handle, as the admin screen stores it. */
  async function setPayeeMapping(mapping: Record<string, string>): Promise<void> {
    const { SETTING_KBIZ_PAYEES } = await import('@reimbursement/shared');
    await prisma.appSetting.upsert({
      where: { key: SETTING_KBIZ_PAYEES },
      create: { key: SETTING_KBIZ_PAYEES, value: mapping },
      update: { value: mapping },
    });
  }

  /** Publish (or, with `null`, un-publish) the bot's payee-handle manifest. */
  async function publishHandles(handles: string[] | null): Promise<void> {
    const file = join(queueDir(), 'payee-handles.json');
    if (handles === null) {
      await rm(file, { force: true });
      return;
    }
    await Bun.write(file, JSON.stringify({ handles, updatedAt: new Date().toISOString() }));
  }

  /** Every real queue item — i.e. everything the bot would act on. */
  async function queueItems(): Promise<string[]> {
    const entries = await readdir(queueDir());
    return entries.filter(
      (name) => name.endsWith('.json') && !name.startsWith('.') && !MANIFEST_FILES.has(name),
    );
  }

  async function voucherFiles(): Promise<string[]> {
    try {
      return await readdir(join(queueRoot, 'vouchers'));
    } catch {
      return [];
    }
  }

  async function pay(bundleId: string, body?: unknown): Promise<Response> {
    return await app.handle(
      new Request(`http://localhost/bundles/${bundleId}/pay-via-kbiz`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${approverToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }

  /**
   * The whole point of the suite: a refusal must leave the bundle unclaimed and
   * the queue empty. Asserted after EVERY refusal, never just the status code.
   */
  async function expectNothingHappened(bundleId: string): Promise<void> {
    const row = await prisma.bundle.findUniqueOrThrow({ where: { id: bundleId } });
    expect(row.status).toBe('APPROVED');
    expect(row.paymentIntentId).toBeNull();
    expect(row.payingSince).toBeNull();
    expect(await queueItems()).toEqual([]);
    expect(await voucherFiles()).toEqual([]);
  }

  beforeAll(async () => {
    // `KBIZ_QUEUE_DIR` is read once, at module evaluation, in `src/kbiz.ts` —
    // so the directory must exist and the env var must be set BEFORE the first
    // import below. `queue/` is the provisioning marker the app refuses to
    // create for itself (a bare root answers 503), so create it by hand, the
    // way the runbook does on the host.
    queueRoot = await mkdtemp(join(tmpdir(), 'kbiz-queue-test-'));
    await mkdir(join(queueRoot, 'queue'), { recursive: true });
    process.env.KBIZ_QUEUE_DIR = queueRoot;

    ({ prisma } = await import('../src/db'));
    const kbiz = await import('../src/kbiz');
    // Fails loudly rather than letting every test below pass on a 503: this is
    // the one assumption a module-cache ordering change could break silently.
    expect(await kbiz.isKbizConfigured()).toBe(true);

    bundlesModule = await import('../src/routes/bundles');
    const { Elysia } = await import('elysia');
    const { adminRoutes } = await import('../src/routes/admin');
    app = new Elysia().use(bundlesModule.bundleRoutes).use(adminRoutes) as unknown as typeof app;

    approverId = await makeUser('ผู้อนุมัติ ทดสอบ', 'APPROVER');
    const { signAuthToken } = await import('../src/jwt');
    approverToken = await signAuthToken({ userId: approverId });
  });

  afterEach(async () => {
    // Queue + manifest are per-test state; leaking either one across tests
    // would make "nothing was written" meaningless.
    for (const name of await readdir(queueDir())) {
      await rm(join(queueDir(), name), { recursive: true, force: true });
    }
    await rm(join(queueRoot, 'vouchers'), { recursive: true, force: true });
    await setPayeeMapping({});
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      // Bundles and receipts cascade with their user.
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    const { SETTING_KBIZ_PAYEES } = await import('@reimbursement/shared');
    await prisma.appSetting.deleteMany({ where: { key: SETTING_KBIZ_PAYEES } });
    await rm(queueRoot, { recursive: true, force: true });
  });

  // ── (a) no destination → refused ──────────────────────────────────────

  test('no body at all is refused with 400, and nothing is claimed or queued', async () => {
    const submitterId = await makeUser('พนักงาน ไม่มีปลายทาง', 'EMPLOYEE');
    // The mapping IS configured, and the handle IS published — so the OLD
    // implicit path would have paid it. That is exactly what must not happen.
    await setPayeeMapping({ [submitterId]: 'somchai-scb' });
    await publishHandles(['somchai-scb']);
    const bundleId = await makePayableBundle(submitterId);

    const response = await pay(bundleId);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message: string };
    expect(body.message).toBe(bundlesModule.DESTINATION_REQUIRED_400);
    await expectNothingHappened(bundleId);
  });

  test('an empty JSON body is refused the same way', async () => {
    const submitterId = await makeUser('พนักงาน บอดี้ว่าง', 'EMPLOYEE');
    await setPayeeMapping({ [submitterId]: 'somchai-scb' });
    await publishHandles(['somchai-scb']);
    const bundleId = await makePayableBundle(submitterId);

    const response = await pay(bundleId, {});

    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toBe(
      bundlesModule.DESTINATION_REQUIRED_400,
    );
    await expectNothingHappened(bundleId);
  });

  test('an explicit null destination is refused the same way', async () => {
    const submitterId = await makeUser('พนักงาน ปลายทางว่าง', 'EMPLOYEE');
    await setPayeeMapping({ [submitterId]: 'somchai-scb' });
    await publishHandles(['somchai-scb']);
    const bundleId = await makePayableBundle(submitterId);

    const response = await pay(bundleId, { destination: null });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toBe(
      bundlesModule.DESTINATION_REQUIRED_400,
    );
    await expectNothingHappened(bundleId);
  });

  test('the refusal is Thai prose that tells the approver what to do', () => {
    const message = bundlesModule.DESTINATION_REQUIRED_400;
    // Thai characters present, no Latin letters anywhere — guardrail: a
    // user-visible API message is never English.
    expect(message).toMatch(/[฀-๿]/);
    expect(message).not.toMatch(/[A-Za-z]/);
    expect(message).toContain('บัญชีปลายทาง');
  });

  // ── (e) a handle the bot never published is refused BEFORE the claim ───

  test('a mapped handle missing from the bot manifest is refused, not claimed', async () => {
    const submitterId = await makeUser('พนักงาน แฮนเดิลพิมพ์ผิด', 'EMPLOYEE');
    // The typo: the admin mapped `somchai-scbb`, the bot only knows
    // `somchai-scb`. Before this was fixed the mapping was accepted on its own
    // and the typo surfaced only after the bundle was already PAYING.
    await setPayeeMapping({ [submitterId]: 'somchai-scbb' });
    await publishHandles(['somchai-scb', 'nuch-kbank']);
    const bundleId = await makePayableBundle(submitterId);

    const response = await pay(bundleId, {
      destination: { kind: 'handle', handle: 'somchai-scbb' },
    });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { message: string }).message).toContain('สมุดบัญชีของบอท');
    await expectNothingHappened(bundleId);
  });

  test('a handle nobody ever mapped or published is refused', async () => {
    const submitterId = await makeUser('พนักงาน แฮนเดิลมั่ว', 'EMPLOYEE');
    await publishHandles(['somchai-scb']);
    const bundleId = await makePayableBundle(submitterId);

    const response = await pay(bundleId, {
      destination: { kind: 'handle', handle: 'ใครก็ไม่รู้' },
    });

    expect(response.status).toBe(409);
    await expectNothingHappened(bundleId);
  });

  // ── the destination still WORKS when it is stated explicitly ──────────

  test('a published handle pays: bundle claimed, one intent queued', async () => {
    const submitterId = await makeUser('พนักงาน จ่ายได้', 'EMPLOYEE');
    // No mapping at all — a published handle is sufficient on its own, which is
    // what makes the mapping a default rather than a permission.
    await publishHandles(['nuch-kbank']);
    const bundleId = await makePayableBundle(submitterId, '312.75');

    const response = await pay(bundleId, {
      destination: { kind: 'handle', handle: 'nuch-kbank' },
    });

    expect(response.status).toBe(200);
    const row = await prisma.bundle.findUniqueOrThrow({ where: { id: bundleId } });
    expect(row.status).toBe('PAYING');
    expect(row.paymentIntentId).toMatch(/^pi_[0-9a-f]{32}$/);
    expect(row.payingSince).not.toBeNull();

    const items = await queueItems();
    expect(items).toEqual([`${row.paymentIntentId}.json`]);
    const intent = (await Bun.file(join(queueDir(), items[0])).json()) as {
      destination: { kind: string; handle: string };
      payee: { handle: string } | null;
      amount: number;
      bundleId: string;
    };
    expect(intent.destination).toEqual({ kind: 'handle', handle: 'nuch-kbank' });
    expect(intent.payee).toEqual({ handle: 'nuch-kbank' });
    expect(intent.amount).toBe(312.75);
    expect(intent.bundleId).toBe(bundleId);
  });

  test('with NO bot manifest at all, the requestor mapping is still accepted', async () => {
    const submitterId = await makeUser('พนักงาน ไม่มีมานิเฟสต์', 'EMPLOYEE');
    await setPayeeMapping({ [submitterId]: 'somchai-scb' });
    await publishHandles(null);
    const bundleId = await makePayableBundle(submitterId);

    // Deliberate fail-open: `readPayeeHandlesManifest` returns null for every
    // problem, transient ones included, and an unreadable cache file must not
    // become "nobody can be reimbursed". The handle still has to be STATED.
    const response = await pay(bundleId, {
      destination: { kind: 'handle', handle: 'somchai-scb' },
    });

    expect(response.status).toBe(200);
    const row = await prisma.bundle.findUniqueOrThrow({ where: { id: bundleId } });
    expect(row.status).toBe('PAYING');
    expect(await queueItems()).toEqual([`${row.paymentIntentId}.json`]);
  });

  // ── (b) the per-requestor default survives as a DEFAULT ───────────────

  test('the picker can still pre-select: kbiz-settings exposes the mapping', async () => {
    const submitterId = await makeUser('พนักงาน มีค่าเริ่มต้น', 'EMPLOYEE');
    await setPayeeMapping({ [submitterId]: 'somchai-scb' });
    await publishHandles(['somchai-scb']);

    const response = await app.handle(
      new Request('http://localhost/admin/kbiz-settings', {
        headers: { authorization: `Bearer ${approverToken}` },
      }),
    );

    expect(response.status).toBe(200);
    const settings = (await response.json()) as {
      payees: Record<string, string>;
      availableHandles: string[] | null;
      configured: boolean;
    };
    // This is the endpoint `KbizDestinationPicker` reads to pre-select the
    // requestor's default. Making the destination mandatory must not have
    // taken the default away — only its automatic application.
    expect(settings.payees[submitterId]).toBe('somchai-scb');
    expect(settings.availableHandles).toContain('somchai-scb');
    expect(settings.configured).toBe(true);
  });
});

/**
 * The same two rules, pinned as TEXT — no database, no imports.
 *
 * Root `bun test` (the gate BOTH `deploy.yml`'s `test` job and
 * `deploy-reimbursement.yml`'s `contract` job run) collects this file with no
 * `apps/api/node_modules` and no `TEST_DATABASE_URL`, so everything above it
 * skips there. These two do not: they read the route source as a string, the
 * way `kbiz-poller.test.ts` reads `kbiz-outcomes.ts`. Coarse on purpose — the
 * DB-backed suite above is what proves the behaviour; this is the tripwire that
 * still fires on a machine, or a CI job, with no Postgres.
 */
describe('pay-via-kbiz destination rules (source text, no database)', () => {
  // Comments stripped first: this file's own prose explains what the removed
  // code used to look like, and a guard that matched its own documentation
  // would be unfixable.
  const source = readFileSync(
    fileURLToPath(new URL('../src/routes/bundles.ts', import.meta.url)),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('never assigns the destination FROM the requestor mapping', () => {
    // The removed implicit path was exactly this assignment. `mappedHandle` may
    // still be READ (it is the manifest-unavailable fallback for a handle the
    // approver explicitly stated) — it may never BECOME the destination on its
    // own.
    expect(code).not.toMatch(/destination\s*=\s*\{\s*kind:\s*'handle',\s*handle:\s*mappedHandle/);
  });

  it('accepts a stated handle only against the manifest, never on the mapping alone', () => {
    // The pre-existing defect: `handle === mappedHandle ||` short-circuited the
    // manifest check, so a typo'd mapping was only caught after the bundle had
    // been claimed into PAYING.
    expect(code).not.toContain('handle === mappedHandle ||');
  });

  it('refuses a missing destination in Thai, with no Latin letters', () => {
    const literal = /export const DESTINATION_REQUIRED_400 =\s*'([^']+)'/.exec(source)?.[1];
    expect(literal).toBeTruthy();
    expect(literal).toMatch(/[\u0E00-\u0E7F]/);
    expect(literal).not.toMatch(/[A-Za-z]/);
  });
});
