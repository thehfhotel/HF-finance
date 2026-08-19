// The disk half of the one-push-at-a-time invariant. Everything here runs
// against a real temp directory (fs is the whole point of arm-lock.ts) but no
// browser, no network and no queue — `bun test` from the repo root runs this
// file BEFORE kbiz-bot/node_modules exists, so nothing it touches may reach
// for playwright.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { ARM_LOCK_FILE, readArmLockRaw, writeArmLock } from "../src/lib/arm-lock";
import { armedLock, conservativeLock, parseArmLock, releasedLock, CONSERVATIVE_TOTAL_MS } from "../src/lib/arm-gate";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kbiz-arm-lock-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const lockPath = () => join(dir, ARM_LOCK_FILE);

describe("readArmLockRaw", () => {
  it("reads a missing file as no lock, never throwing", () => {
    // The overwhelmingly common case: no push outstanding. It must read as
    // "none", not as an error a caller could mistake for "cannot tell".
    expect(readArmLockRaw(dir)).toEqual({ text: null, mtimeMs: null });
    expect(parseArmLock(null, null, Date.now())).toEqual({ live: false, source: "none" });
  });

  it("reads a missing DIRECTORY as no lock, never throwing", () => {
    expect(readArmLockRaw(join(dir, "does", "not", "exist"))).toEqual({ text: null, mtimeMs: null });
  });

  it("returns the text and a plausible mtime for a file that exists", () => {
    const before = Date.now();
    writeArmLock(conservativeLock("pi_a", before), dir);
    const { text, mtimeMs } = readArmLockRaw(dir);
    expect(text).toContain("pi_a");
    expect(mtimeMs).not.toBeNull();
    // mtime resolution varies by filesystem — a 5 s window is plenty.
    expect(Math.abs((mtimeMs as number) - before)).toBeLessThan(5_000);
  });
});

describe("writeArmLock is atomic", () => {
  it("round-trips a lock through tmp-file + rename", () => {
    const now = Date.parse("2026-08-14T01:24:31.000Z");
    const lock = armedLock("pi_a", now);
    writeArmLock(lock, dir);

    expect(existsSync(lockPath())).toBe(true);
    // The tmp file must not survive the rename.
    expect(existsSync(`${lockPath()}.tmp`)).toBe(false);
    expect(JSON.parse(readFileSync(lockPath(), "utf8"))).toEqual(lock);
  });

  it("never lets a half-written tmp file be read as the lock", () => {
    // Simulate a crash mid-write: the .tmp file exists with garbage in it and
    // the real path was never renamed over. readArmLockRaw must see NO lock —
    // if it read the tmp file, parseArmLock would treat the garbage as corrupt
    // and (correctly, but pointlessly) wedge the bot for 10.5 minutes.
    writeFileSync(`${lockPath()}.tmp`, '{"intentId":"pi_a","armed', "utf8");
    expect(readArmLockRaw(dir)).toEqual({ text: null, mtimeMs: null });
    expect(parseArmLock(readArmLockRaw(dir).text, null, Date.now()).live).toBe(false);
  });

  it("overwrites a previous lock in place — one file, one outstanding push", () => {
    const t0 = Date.parse("2026-08-14T01:00:00.000Z");
    writeArmLock(conservativeLock("pi_a", t0), dir);
    const armed = armedLock("pi_a", t0 + 30_000);
    writeArmLock(armed, dir);
    writeArmLock(releasedLock(armed, "success", t0 + 60_000), dir);

    const parsed = JSON.parse(readFileSync(lockPath(), "utf8"));
    expect(parsed.state).toBe("released");
    expect(parsed.resolution).toBe("success");
    // Released is WRITTEN, not deleted: no ENOENT race, and the file is an
    // audit trail of what armed when.
    expect(existsSync(lockPath())).toBe(true);
  });

  it("creates the state dir when it does not exist yet", () => {
    const nested = join(dir, "data");
    writeArmLock(conservativeLock("pi_a", Date.now()), nested);
    expect(existsSync(join(nested, ARM_LOCK_FILE))).toBe(true);
  });

  it("throws when the write cannot happen, so the caller can fail closed", () => {
    // A path whose parent is a FILE, not a directory — mkdirSync throws
    // ENOTDIR. The contract is that writeArmLock throws and process-queue
    // refuses to arm; a silent failure here would be a silent double-pay path.
    const file = join(dir, "not-a-dir");
    writeFileSync(file, "x", "utf8");
    expect(() => writeArmLock(conservativeLock("pi_a", Date.now()), join(file, "sub"))).toThrow();
  });
});

describe("the written file is what parseArmLock understands", () => {
  it("a freshly written conservative lock reads back LIVE for 10.5 minutes", () => {
    const t0 = Date.parse("2026-08-14T01:00:00.000Z");
    writeArmLock(conservativeLock("pi_a", t0), dir);
    const { text, mtimeMs } = readArmLockRaw(dir);

    expect(parseArmLock(text, mtimeMs, t0 + 1_000)).toMatchObject({ live: true, source: "parsed" });
    expect(parseArmLock(text, mtimeMs, t0 + CONSERVATIVE_TOTAL_MS - 1)).toMatchObject({ live: true });
    expect(parseArmLock(text, mtimeMs, t0 + CONSERVATIVE_TOTAL_MS)).toEqual({ live: false, source: "expired" });
  });

  it("a released lock reads back as not live even inside the window — with releasedAt/resolution/intentId surfaced", () => {
    // 2026-08-19: these three used to be thrown away by parseArmLock's
    // "released" branch — the exact data the cross-poll gate needs.
    const t0 = Date.parse("2026-08-14T01:00:00.000Z");
    const armed = armedLock("pi_a", t0);
    writeArmLock(releasedLock(armed, "success", t0 + 8_000), dir);
    const { text, mtimeMs } = readArmLockRaw(dir);
    expect(parseArmLock(text, mtimeMs, t0 + 9_000)).toEqual({
      live: false,
      source: "released",
      releasedAt: t0 + 8_000,
      resolution: "success",
      intentId: "pi_a",
    });
  });
});

describe("no playwright import (root CI runs bun test before kbiz-bot's node_modules exist)", () => {
  it("arm-lock.ts imports nothing from playwright", () => {
    expect(readFileSync(at("../src/lib/arm-lock.ts"), "utf8")).not.toMatch(/from\s+["']playwright["']/);
  });

  it("arm-gate.ts imports nothing from playwright — its flows import is `import type`, which is erased", () => {
    const src = readFileSync(at("../src/lib/arm-gate.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']playwright["']/);
    // The one import from the flows tree (which DOES load playwright for real)
    // must stay type-only. Drop the `type` keyword and root CI dies with an
    // unresolved-import stack trace pointing at a browser package.
    expect(src).toMatch(/import type \{ TransferOutcome \} from "\.\.\/flows\/transfer-other-flow"/);
  });
});
