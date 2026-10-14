// Resolves which contract the frontend talks to. VITE_CONTRACT_ADDRESS is required:
// there is deliberately no fallback to a previous deployment.
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export function resolveContractAddress({ envAddress }) {
  const addr = (envAddress || "").trim()
  if (!addr) {
    return {
      address: "",
      error: "Configuration error: VITE_CONTRACT_ADDRESS is not set. Set it to your deployed EventTicket address (see frontend/.env.example) and restart or redeploy.",
    }
  }
  if (!ADDRESS_RE.test(addr)) {
    return { address: "", error: "Configuration error: VITE_CONTRACT_ADDRESS is not a valid contract address." }
  }
  return { address: addr, error: null }
}
