/**
 * DRY helper for "please confirm on your KBIZ mobile app" flows.
 *
 * KBIZ shows the same in-browser pattern whenever a sensitive action needs
 * mobile-app approval (login, transfer, confirm batch, etc.): the desktop
 * page sits on a "waiting" screen until you tap Approve in the app, after
 * which the desktop redirects / shows a success state. We don't try to detect
 * the "waiting" screen — we just race a caller-supplied success condition
 * against a timeout, and print user-friendly progress to stdout in the
 * meantime.
 *
 * Usage:
 *   await waitForMobileConfirmation({
 *     reason: "ยืนยันการเข้าสู่ระบบ KBIZ",
 *     until: () => page.waitForURL(/dashboard/),
 *   });
 */
export async function waitForMobileConfirmation<T>(opts: {
  reason: string;
  until: () => Promise<T>;
  timeoutMs?: number;
}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 3 * 60_000;
  const startedAt = Date.now();

  const bar = "─".repeat(48);
  process.stdout.write("\n");
  process.stdout.write(`📱 ${bar}\n`);
  process.stdout.write(`📱 ${opts.reason}\n`);
  process.stdout.write(`📱 กรุณาเปิดแอป K BIZ บนมือถือและกดยืนยัน (timeout ${Math.floor(timeoutMs / 1000)}s)\n`);
  process.stdout.write(`📱 ${bar}\n\n`);

  const heartbeat = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const remaining = Math.max(0, Math.floor(timeoutMs / 1000) - elapsed);
    process.stdout.write(`\r⏳ รอการยืนยัน… ผ่านไป ${elapsed}s · เหลือ ${remaining}s   `);
  }, 1000);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Mobile confirmation timed out after ${timeoutMs / 1000}s: ${opts.reason}`)),
      timeoutMs
    );
  });

  try {
    const result = await Promise.race([opts.until(), timeoutPromise]);
    process.stdout.write(`\r✅ ยืนยันแล้ว (${Math.floor((Date.now() - startedAt) / 1000)}s)                    \n\n`);
    return result;
  } catch (e) {
    process.stdout.write(`\r❌ ${(e as Error).message}\n\n`);
    throw e;
  } finally {
    clearInterval(heartbeat);
    if (timer) clearTimeout(timer);
  }
}
