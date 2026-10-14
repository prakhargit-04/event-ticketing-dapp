// True when the user declined a MetaMask / wallet prompt (EIP-1193 code 4001,
// or ethers v6 "ACTION_REJECTED"). Pure function so it can be unit-tested.
export function isUserRejection(err) {
  if (!err) return false
  return (
    err.code === 4001 ||
    err.code === "ACTION_REJECTED" ||
    err.info?.error?.code === 4001
  )
}
