// Unit tests for the card-assertion verify + authorization logic.
// We mint RS256 assertions with a locally-generated key and verify against its
// public half — no network / JWKS stubbing needed. Run with `bun test`.

import { describe, expect, it } from "bun:test";
import { SignJWT, generateKeyPair } from "jose";
import { CardAssertionError, verifyCardAssertion } from "../src/card";

const ISSUER = "https://id.thehfhotel.org/oidc";

type Claims = Record<string, unknown>;

async function mint(signingKey: CryptoKey, claims: Claims = {}, opts: { aud?: string; expOffset?: number } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const base: Claims = { sub: "Q0007", name: "สมชาย ทดสอบ", email: "q0007@example.invalid", apps: ["payroll"], badge: "Q0007" };
  return new SignJWT({ ...base, ...claims })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(ISSUER)
    .setAudience(opts.aud ?? "payroll")
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expOffset ?? 300))
    .sign(signingKey);
}

describe("verifyCardAssertion", () => {
  it("accepts a valid payroll assertion and returns the identity", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwt = await mint(privateKey);
    const id = await verifyCardAssertion(jwt, publicKey, { issuer: ISSUER });
    expect(id.badge).toBe("Q0007");
    expect(id.name).toBe("สมชาย ทดสอบ");
    expect(id.apps).toContain("payroll");
  });

  it("rejects a verified assertion that lacks the payroll grant (not_authorized)", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwt = await mint(privateKey, { apps: ["rooms", "frontdesk"] });
    await expect(verifyCardAssertion(jwt, publicKey, { issuer: ISSUER })).rejects.toMatchObject({
      reason: "not_authorized",
    });
  });

  it("rejects a wrong-audience assertion (invalid)", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwt = await mint(privateKey, {}, { aud: "rooms" });
    await expect(verifyCardAssertion(jwt, publicKey, { issuer: ISSUER })).rejects.toMatchObject({
      reason: "invalid",
    });
  });

  it("rejects an expired assertion (invalid)", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwt = await mint(privateKey, {}, { expOffset: -60 });
    await expect(verifyCardAssertion(jwt, publicKey, { issuer: ISSUER })).rejects.toMatchObject({
      reason: "invalid",
    });
  });

  it("rejects a signature from an unknown key (invalid)", async () => {
    const signer = await generateKeyPair("RS256");
    const other = await generateKeyPair("RS256");
    const jwt = await mint(signer.privateKey);
    await expect(verifyCardAssertion(jwt, other.publicKey, { issuer: ISSUER })).rejects.toBeInstanceOf(
      CardAssertionError,
    );
  });
});
