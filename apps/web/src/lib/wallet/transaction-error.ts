/** A wallet returned an executed failure, including the public transaction hash. */
export class WalletTransactionError extends Error {
  constructor(readonly hash: string, readonly failure: unknown) {
    super(`the transaction failed: ${JSON.stringify(failure).slice(0, 300)}`);
    this.name = "WalletTransactionError";
  }
}
