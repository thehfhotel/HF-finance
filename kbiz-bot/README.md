# kbiz-bot

Browser-automation prototype for K BIZ (KBank Business Online).

**Scope right now: log in only.** No transfers, no actions. The login script
opens a real Chromium window, types your User ID / Password, then waits for
you to tap Approve in the K BIZ mobile app. On success it persists the
session to `storageState.json` so future scripts can reuse it.

## First-time setup

```sh
cd kbiz-bot
bun install
bunx playwright install chromium
cp .env.example .env
# edit .env with real credentials
```

## Run

```sh
bun run login
```

A Chromium window opens, fills the form, submits. Watch the terminal — it
will tell you when to confirm on your phone. After approval the script
saves `storageState.json` and exits.

## DRY pattern: `waitForMobileConfirmation`

Every sensitive K BIZ action (login, transfer, batch confirm) follows the
same desktop-then-mobile-approval flow. `src/wait.ts` exports a single
generic helper:

```ts
await waitForMobileConfirmation({
  reason: "...what the user is approving...",
  until: () => page.waitForURL(/.../),  // or any Promise that resolves on success
  timeoutMs: 180_000,                   // optional, default 3 min
});
```

The helper prints a clear "open the app and tap Approve" prompt, shows a
live elapsed/remaining counter, and races your success condition against
the timeout. Reuse it for every flow that requires phone approval.

## Files not in git

- `.env` — credentials
- `storageState.json` — logged-in session cookies
- traces, screenshots, videos
