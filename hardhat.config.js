require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      chainId: 11155111, // Hardhat also rejects an RPC endpoint that reports a different chain
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  // Used only by `npx hardhat verify` (one Etherscan key works for Sepolia).
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
};
