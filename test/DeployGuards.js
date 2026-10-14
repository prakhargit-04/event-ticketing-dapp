const { expect } = require("chai");
const {
  SEPOLIA_CHAIN_ID,
  SEED_GAS_BUDGET,
  assertSepolia,
  estimateRequiredBalance,
  assertSufficientBalance,
} = require("../scripts/lib/deployGuards");

describe("Deployment safety guards", function () {
  describe("chain ID", function () {
    it("Sepolia chain ID constant is 11155111", function () {
      expect(SEPOLIA_CHAIN_ID).to.equal(11155111n);
    });

    it("hardhat.config.js pins the sepolia network to chain ID 11155111", function () {
      const config = require("../hardhat.config.js");
      expect(config.networks.sepolia.chainId).to.equal(11155111);
    });

    it("accepts Sepolia as bigint, number, or numeric string", function () {
      expect(() => assertSepolia(11155111n)).to.not.throw();
      expect(() => assertSepolia(11155111)).to.not.throw();
      expect(() => assertSepolia("11155111")).to.not.throw();
    });

    it("rejects Ethereum mainnet, local Hardhat, and other chains", function () {
      for (const id of [1n, 31337n, 137n, 11155112n]) {
        expect(() => assertSepolia(id)).to.throw(/Refusing to deploy/);
      }
    });

    it("rejects an unreadable chain ID", function () {
      expect(() => assertSepolia(undefined)).to.throw(/could not read/);
      expect(() => assertSepolia("abc")).to.throw(/could not read/);
    });
  });

  describe("balance preflight", function () {
    it("computes (deploy + seed gas) * fee * (1 + buffer)", function () {
      const required = estimateRequiredBalance({
        deployGas: 2000000n,
        seedGas: 500000n,
        feePerGas: 10n,
        bufferPercent: 20n,
      });
      expect(required).to.equal(30000000n); // 2.5M gas * 10 wei * 1.2
    });

    it("uses the default seed budget and a 20% buffer when omitted", function () {
      const required = estimateRequiredBalance({ deployGas: 1000000n, feePerGas: 100n });
      expect(required).to.equal(((1000000n + SEED_GAS_BUDGET) * 100n * 120n) / 100n);
    });

    it("rejects non-bigint or negative inputs", function () {
      expect(() => estimateRequiredBalance({ deployGas: 1, feePerGas: 1n })).to.throw(/deployGas/);
      expect(() => estimateRequiredBalance({ deployGas: 1n, feePerGas: -1n })).to.throw(/feePerGas/);
    });

    it("passes when the balance equals or exceeds the requirement", function () {
      expect(() => assertSufficientBalance(100n, 100n)).to.not.throw();
      expect(() => assertSufficientBalance(101n, 100n)).to.not.throw();
    });

    it("fails with a clear message when the balance is too low", function () {
      expect(() => assertSufficientBalance(99n, 100n)).to.throw(/Insufficient deployer balance/);
      expect(() => assertSufficientBalance(0n, 1n)).to.throw(/No transaction was sent/);
    });
  });
});
