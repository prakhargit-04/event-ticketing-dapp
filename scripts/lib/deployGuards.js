// Pure deployment-safety helpers (no network access) so they can be unit-tested.

const SEPOLIA_CHAIN_ID = 11155111n;

// Conservative gas budget for the demo-event createEvent() call made after deployment.
const SEED_GAS_BUDGET = 500000n;

// Safety margin on top of the estimated cost, to absorb fee movement between estimate and send.
const DEFAULT_BUFFER_PERCENT = 20n;

/** Throws unless the connected chain is Sepolia. Call before sending any transaction. */
function assertSepolia(chainId) {
  let id;
  try {
    id = BigInt(chainId);
  } catch {
    throw new Error(`Refusing to deploy: could not read the connected chain ID (${String(chainId)}).`);
  }
  if (id !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Refusing to deploy: connected to chain ID ${id}, expected Sepolia (${SEPOLIA_CHAIN_ID}). ` +
        `Check SEPOLIA_RPC_URL and run with --network sepolia.`
    );
  }
}

/** Estimated wei needed: (deploy gas + seed gas) * fee per gas, plus a percentage buffer. */
function estimateRequiredBalance({
  deployGas,
  seedGas = SEED_GAS_BUDGET,
  feePerGas,
  bufferPercent = DEFAULT_BUFFER_PERCENT,
}) {
  for (const [name, v] of Object.entries({ deployGas, seedGas, feePerGas, bufferPercent })) {
    if (typeof v !== "bigint" || v < 0n) {
      throw new Error(`estimateRequiredBalance: ${name} must be a non-negative bigint.`);
    }
  }
  return ((deployGas + seedGas) * feePerGas * (100n + bufferPercent)) / 100n;
}

/** Throws with a clear message if the balance cannot cover the planned transactions. */
function assertSufficientBalance(balance, required, formatEther = (w) => w.toString() + " wei") {
  if (balance < required) {
    throw new Error(
      `Insufficient deployer balance: have ${formatEther(balance)} ETH, ` +
        `need about ${formatEther(required)} ETH for deployment + demo event (including buffer). ` +
        `Fund the wallet with Sepolia ETH and retry. No transaction was sent.`
    );
  }
}

module.exports = {
  SEPOLIA_CHAIN_ID,
  SEED_GAS_BUDGET,
  DEFAULT_BUFFER_PERCENT,
  assertSepolia,
  estimateRequiredBalance,
  assertSufficientBalance,
};
