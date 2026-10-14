const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  if (!deployer) {
    throw new Error("No local Hardhat account available.");
  }

  const network = await ethers.provider.getNetwork();

  if (network.chainId !== 31337n) {
    throw new Error(
      `Local deployment only: expected chain ID 31337, got ${network.chainId}`
    );
  }

  console.log("Local deployer:", deployer.address);

  const EventTicket = await ethers.getContractFactory("EventTicket");
  const contract = await EventTicket.deploy(deployer.address);

  await contract.waitForDeployment();

  const address = await contract.getAddress();

  console.log("EventTicket deployed to:", address);
  console.log("Deployment transaction:", contract.deploymentTransaction().hash);

  const date = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  const tx = await contract.createEvent(
    "Local Demo Concert",
    date,
    ["General Admission", "VIP Box"],
    [ethers.parseEther("0.01"), ethers.parseEther("0.05")],
    [500, 50],
    110,
    5
  );

  await tx.wait();

  console.log("Local demo event created successfully.");
  console.log(`Set VITE_CONTRACT_ADDRESS=${address} in frontend/.env`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
