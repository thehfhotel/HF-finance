// `@reimbursement/shared` resolves through TWO INDEPENDENT MECHANISMS, and
// nothing in the type system ties them together:
//
//   dev / CI / tsc / bun  →  kbiz-bot/tsconfig.json `paths`
//   the built container   →  node_modules/@reimbursement/shared (a symlink the
//                            Dockerfile makes) + the shared package's own
//                            `exports` field
//
// The container has NO tsconfig.json to read: the repo-root .dockerignore
// excludes `kbiz-bot/*.json` and re-includes only package.json, so the file is
// not even in the build context. That makes the symlink LOAD-BEARING, not
// belt-and-braces — delete it as "redundant, the tsconfig already maps this"
// and `node --import tsx src/process-queue.ts` dies at startup with
// ERR_MODULE_NOT_FOUND. Nothing in CI would notice: `bun test` and `tsc` both
// take the tsconfig route, and the image builds fine either way. The bot just
// crashloops in prod, approved intents are never claimed, and bundles sit
// `paying` with money neither sent nor released.
//
// The same divergence bites from the other end: repoint the shared package's
// `exports` at a `./dist/…` build output and the container breaks while dev
// and CI stay green, because only the container consults `exports` at all.
//
// So this file pins the two mechanisms to ONE file. It reads the Dockerfile,
// the tsconfig and the shared package.json as text — no node_modules, no
// docker, no type information — and asserts every path in the chain denotes
// reimbursement/packages/shared/src/index.ts.

import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

const REPO_ROOT = at("../../");
const BOT_DIR = at("../");
const SHARED_PKG_DIR = at("../../reimbursement/packages/shared/");

const dockerfile = readFileSync(at("../Dockerfile"), "utf8");
const tsconfig = readFileSync(at("../tsconfig.json"), "utf8");
const dockerignore = readFileSync(at("../../.dockerignore"), "utf8");
const sharedPkg = JSON.parse(readFileSync(at("../../reimbursement/packages/shared/package.json"), "utf8"));

/** The one file every mechanism below has to end up at. */
const CONTRACT_FILE = resolve(SHARED_PKG_DIR, "src/index.ts");

/** tsconfig.json is JSONC (it has comments), so read the mapping as text. */
function tsconfigPathsTarget(specifier: string): string {
  const m = tsconfig.match(new RegExp(`"${specifier.replace("/", "\\/")}"\\s*:\\s*\\[\\s*"([^"]+)"`));
  if (!m) throw new Error(`kbiz-bot/tsconfig.json no longer maps "${specifier}"`);
  return m[1]!;
}

function dockerfileDirective(re: RegExp, what: string): RegExpMatchArray {
  const m = dockerfile.match(re);
  if (!m) throw new Error(`kbiz-bot/Dockerfile no longer ${what}`);
  return m;
}

describe("@reimbursement/shared resolves to one file by every route", () => {
  it("maps the tsconfig `paths` entry at the contract source", () => {
    // A bare `paths` entry is resolved relative to the tsconfig's own dir
    // (there is no `baseUrl` — TS7 removed it), which is what tsx and bun do too.
    expect(resolve(BOT_DIR, tsconfigPathsTarget("@reimbursement/shared"))).toBe(CONTRACT_FILE);
    expect(readFileSync(CONTRACT_FILE, "utf8").length).toBeGreaterThan(0);
  });

  it("points the shared package's own entry fields at that same file", () => {
    // This is the container's half of the resolution: node follows the symlink
    // to the package dir and then reads THESE fields. A repoint to ./dist/…
    // breaks the image alone, so it has to fail here instead.
    const entries = [sharedPkg.main, sharedPkg.types, sharedPkg.exports?.["."]];
    for (const entry of entries) {
      expect(typeof entry).toBe("string");
      expect(resolve(SHARED_PKG_DIR, entry as string)).toBe(CONTRACT_FILE);
    }
  });

  it("COPYs the shared package into the image at the path the WORKDIR implies", () => {
    const workdir = dockerfileDirective(/^WORKDIR\s+(\S+)/m, "sets a WORKDIR")[1]!;
    const copy = dockerfileDirective(
      /^COPY\s+(reimbursement\/packages\/shared)\s+(\S+)\s*$/m,
      "COPYs reimbursement/packages/shared",
    );
    const [, copySrc, copyDest] = copy as unknown as [string, string, string];

    // The COPY source is the real package dir, relative to the build context
    // (the REPO ROOT — docker-compose `context: .`, not kbiz-bot/).
    expect(resolve(REPO_ROOT, copySrc)).toBe(SHARED_PKG_DIR.replace(/\/$/, ""));

    // …and resolving the tsconfig's relative target from the container WORKDIR
    // lands on the copied file. This is what "keep the relative layout intact"
    // actually means, stated as an assertion instead of a comment.
    expect(posix.resolve(workdir, tsconfigPathsTarget("@reimbursement/shared"))).toBe(
      posix.join(copyDest, "src/index.ts"),
    );
  });

  it("links node_modules/@reimbursement/shared at that same copied dir", () => {
    const [, target, link] = dockerfileDirective(
      /ln\s+-sfn\s+(\S+)\s+(\S+)/,
      "symlinks the shared package into node_modules",
    ) as unknown as [string, string, string];
    const copyDest = dockerfileDirective(/^COPY\s+reimbursement\/packages\/shared\s+(\S+)\s*$/m, "COPYs the shared package")[1]!;

    expect(target).toBe(copyDest);
    // The bare specifier `@reimbursement/shared` only resolves at this exact name.
    expect(link).toBe("node_modules/@reimbursement/shared");
  });

  it("keeps a working mechanism for whichever way tsconfig.json is treated", () => {
    // The symlink exists BECAUSE tsconfig.json is excluded from the build
    // context. If that ever changes, the image should COPY the tsconfig and
    // resolve the way everything else does — either is fine, neither is not.
    const excluded = /^kbiz-bot\/\*\.json$/m.test(dockerignore);
    const reIncluded = /^!kbiz-bot\/tsconfig\.json$/m.test(dockerignore);
    const hasSymlink = /ln\s+-sfn\s+\S+\s+node_modules\/@reimbursement\/shared/.test(dockerfile);
    const copiesTsconfig = /^COPY\s+kbiz-bot\/tsconfig\.json\b/m.test(dockerfile);

    if (excluded && !reIncluded) {
      expect(hasSymlink).toBe(true);
    } else {
      expect(hasSymlink || copiesTsconfig).toBe(true);
    }
  });

  it("launches the bot from kbiz-bot/, which is where tsx finds the tsconfig", () => {
    // tsx reads tsconfig from process.cwd(), NOT from the imported file's dir,
    // so `node --import tsx kbiz-bot/src/process-queue.ts` from the repo root
    // fails while the identical file run from kbiz-bot/ works. The image gets
    // this right via WORKDIR; the npm scripts get it right by living here.
    expect(dockerfileDirective(/^WORKDIR\s+(\S+)/m, "sets a WORKDIR")[1]).toBe("/app/kbiz-bot");
    expect(dockerfile).toMatch(/^CMD\s+\["node",\s*"--import",\s*"tsx",\s*"src\//m);
  });
});
