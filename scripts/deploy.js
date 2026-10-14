const { ethers } = require("hardhat");
const {
  assertSepolia,
  estimateRequiredBalance,
  assertSufficientBalance,
} = require("./lib/deployGuards");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account configured. Set PRIVATE_KEY in .env.");
  }
  console.log("Deploying contracts with the account:", deployer.address);

  // Preflight 1: abort before any transaction unless we are really on Sepolia.
  const { chainId, name: networkName } = await ethers.provider.getNetwork();
  console.log("Network:", networkName, "| Chain ID:", chainId.toString());
  assertSepolia(chainId);

  // Preflight 2: make sure the balance covers deployment + the demo event, with a buffer.
  const EventTicket = await ethers.getContractFactory("EventTicket");
  const balance = await ethers.provider.getBalance(deployer.address);
  const deployTx = await EventTicket.getDeployTransaction(deployer.address);
  const deployGas = await ethers.provider.estimateGas({ from: deployer.address, data: deployTx.data });
  const feeData = await ethers.provider.getFeeData();
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (!feePerGas) {
    throw new Error("Could not read the network fee data; aborting before any transaction.");
  }
  const required = estimateRequiredBalance({ deployGas, feePerGas });
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH");
  console.log("Estimated cost (with buffer):", ethers.formatEther(required), "ETH");
  assertSufficientBalance(balance, required, ethers.formatEther);

  // Deploy EventTicket contract, passing deployer as the initial owner
  const eventTicket = await EventTicket.deploy(deployer.address);

  await eventTicket.waitForDeployment();
  const contractAddress = await eventTicket.getAddress();
  console.log("EventTicket contract deployed to:", contractAddress);
  console.log("Deployment tx hash:", eventTicket.deploymentTransaction().hash);
  console.log(
    `Verify with: npx hardhat verify --network sepolia ${contractAddress} ${deployer.address}`
  );

  // Seed a demo event
  console.log("Seeding a demo event...");
  const eventName = "Demo Concert";
  const date = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days from now
  const tierNames = ["General Admission", "VIP Box"];
  const prices = [
    ethers.parseEther("0.01"), // 0.01 ETH
    ethers.parseEther("0.05")  // 0.05 ETH
  ];
  const maxSupply = [500, 50];
  const resaleCapPercent = 110; // 110%
  const royaltyPercent = 5;     // 5%

  const tx = await eventTicket.createEvent(
    eventName,
    date,
    tierNames,
    prices,
    maxSupply,
    resaleCapPercent,
    royaltyPercent
  );
  await tx.wait();

  console.log("Demo event seeded successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
