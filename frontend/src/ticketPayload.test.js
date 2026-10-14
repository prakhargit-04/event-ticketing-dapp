import test from "node:test"
import assert from "node:assert/strict"
import { parseTicketQr, parseManualTicketInput } from "./ticketPayload.js"
import { resolveContractAddress } from "./config.js"
import { isUserRejection } from "./walletErrors.js"

const A = "0x83fdB96C679E42924f9F63c1441e4dE291883803"
const B = "0x1111111111111111111111111111111111111111"
const qr = (o) => JSON.stringify(o)

test("accepts a valid QR for this contract (case-insensitive address)", () => {
  assert.equal(parseTicketQr(qr({ contractAddress: A, tokenId: 7 }), A), 7)
  assert.equal(parseTicketQr(qr({ contractAddress: A.toLowerCase(), tokenId: "12" }), A), 12)
})
test("rejects a QR from a different contract", () => {
  assert.throws(() => parseTicketQr(qr({ contractAddress: B, tokenId: 7 }), A), /different contract/)
})
test("rejects a QR with no / malformed contract address", () => {
  assert.throws(() => parseTicketQr(qr({ tokenId: 7 }), A), /different contract/)
  assert.throws(() => parseTicketQr(qr({ contractAddress: "0x123", tokenId: 7 }), A), /different contract/)
})
test("rejects non-JSON, arrays and bare digits from the scanner", () => {
  assert.throws(() => parseTicketQr("hello 42", A), /not a TRUSTIX/)
  assert.throws(() => parseTicketQr("42", A), /not a TRUSTIX/)
  assert.throws(() => parseTicketQr("[1,2]", A), /not a TRUSTIX/)
  assert.throws(() => parseTicketQr("null", A), /not a TRUSTIX/)
})
test("rejects invalid token ids", () => {
  for (const bad of [0, -1, 1.5, "1e3", "abc", "12abc", null, undefined, {}, 2 ** 60]) {
    assert.throws(() => parseTicketQr(qr({ contractAddress: A, tokenId: bad }), A), /positive whole number/, String(bad))
  }
})
test("manual input: bare number or full QR JSON, strictly validated", () => {
  assert.equal(parseManualTicketInput(" 5 ", A), 5)
  assert.equal(parseManualTicketInput(qr({ contractAddress: A, tokenId: 9 }), A), 9)
  assert.throws(() => parseManualTicketInput("ticket 5", A), /positive whole number/)
  assert.throws(() => parseManualTicketInput(qr({ contractAddress: B, tokenId: 9 }), A), /different contract/)
})
test("requires a configured contract address", () => {
  assert.throws(() => parseTicketQr(qr({ contractAddress: A, tokenId: 1 }), ""), /not configured/)
})

test("config: missing or blank env var is an error (no fallback address)", () => {
  for (const v of [undefined, "", "   "]) {
    const r = resolveContractAddress({ envAddress: v })
    assert.equal(r.address, "")
    assert.match(r.error, /VITE_CONTRACT_ADDRESS is not set/)
  }
})
test("config: invalid env var is an error", () => {
  const r = resolveContractAddress({ envAddress: "0xabc" })
  assert.equal(r.address, "")
  assert.match(r.error, /not a valid/)
})
test("config: valid env var is used", () => {
  const r = resolveContractAddress({ envAddress: " " + B + " " })
  assert.equal(r.address, B)
  assert.equal(r.error, null)
})

test("isUserRejection: detects wallet rejections, ignores other errors", () => {
  assert.equal(isUserRejection({ code: 4001 }), true)
  assert.equal(isUserRejection({ code: "ACTION_REJECTED" }), true)
  assert.equal(isUserRejection({ code: -32601, message: "method not supported" }), false)
  assert.equal(isUserRejection(new Error("boom")), false)
  assert.equal(isUserRejection(null), false)
  assert.equal(isUserRejection(undefined), false)
})
