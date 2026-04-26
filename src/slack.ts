export async function notifySlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.log("[slack] no webhook configured, skipping:", text.slice(0, 80));
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.error(`[slack] webhook returned ${res.status}: ${await res.text()}`);
  } catch (e) {
    console.error("[slack] notification failed:", (e as Error).message);
  }
}
