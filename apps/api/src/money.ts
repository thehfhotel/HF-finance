/**
 * The one place that turns a bundle's receipts into an amount of baht.
 *
 * Every path that moves money computes the total the same way and from the same
 * source — the receipt rows — so a manual /pay, an automated KBIZ intent and
 * the slip reconciliation can never disagree about what a bundle is worth.
 * Nothing here ever trusts an amount sent by a client.
 */
export function sumReceiptAmounts(
  receipts: ReadonlyArray<{ amount: { toString(): string } }>,
): number {
  const total = receipts.reduce((accumulator, { amount }) => accumulator + Number(amount), 0);
  return Number(total.toFixed(2));
}
