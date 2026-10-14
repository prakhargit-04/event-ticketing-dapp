// Strict parsing of ticket QR payloads and manual ticket input.
// Pure functions (no ethers / React) so they can be unit-tested with `node --test`.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const DIGITS_RE = /^[0-9]+$/
const MAX_TOKEN_ID = Number.MAX_SAFE_INTEGER

function toTokenId(value) {
  const str = typeof value === "number" ? String(value) : value
  if (typeof str !== "string" || !DIGITS_RE.test(str)) {
    throw new Error("Ticket ID must be a positive whole number.")
  }
  const id = Number(str)
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_TOKEN_ID) {
    throw new Error("Ticket ID must be a positive whole number.")
  }
  return id
}

function sameAddress(a, b) {
  return typeof a === "string" && ADDRESS_RE.test(a) && a.toLowerCase() === b.toLowerCase()
}

/**
 * Parse a scanned QR value. Must be JSON of the form
 * { "contractAddress": "0x...", "tokenId": 7 } for THIS contract.
 * Returns the token id or throws an Error with a user-facing message.
 */
export function parseTicketQr(raw, expectedContractAddress) {
  if (!ADDRESS_RE.test(expectedContractAddress || "")) {
    throw new Error("App contract address is not configured.")
  }
  let parsed
  try {
    parsed = JSON.parse(String(raw ?? "").trim())
  } catch {
    throw new Error("QR code is not a TRUSTIX ticket.")
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("QR code is not a TRUSTIX ticket.")
  }
  if (!sameAddress(parsed.contractAddress, expectedContractAddress)) {
    throw new Error("This ticket belongs to a different contract and cannot be verified here.")
  }
  return toTokenId(parsed.tokenId)
}

/**
 * Parse text typed into the manual field: either a bare ticket number ("7")
 * or the full QR JSON (validated exactly like a scan).
 */
export function parseManualTicketInput(input, expectedContractAddress) {
  const text = String(input ?? "").trim()
  if (text.startsWith("{")) return parseTicketQr(text, expectedContractAddress)
  return toTokenId(text)
}
