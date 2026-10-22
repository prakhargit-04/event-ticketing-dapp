const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EventTicket Contract", function () {
  let eventTicket;
  let owner;
  let addr1;
  let addr2;

  // This runs before each test: it redeploys the contract to start fresh
  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    // Deploy EventTicket contract, passing the owner address to the Ownable constructor
    eventTicket = await ethers.deployContract("EventTicket", [owner.address]);
    await eventTicket.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await eventTicket.owner()).to.equal(owner.address);
    });

    it("Should set the correct ERC721 name and symbol", async function () {
      expect(await eventTicket.name()).to.equal("EventTicket");
      expect(await eventTicket.symbol()).to.equal("EVT");
    });
  });

  describe("Event Creation", function () {
    it("Should allow owner to create an event", async function () {
      const name = "Blockchain Developer Conference";
      const date = Math.floor(Date.now() / 1000) + 86400; // tomorrow
      const tierNames = ["General", "VIP"];
      const prices = [ethers.parseEther("0.05"), ethers.parseEther("0.15")];
      const maxSupply = [100, 20];
      const resaleCapPercent = 110;
      const royaltyPercent = 10;

      // Expect that calling createEvent emits the EventCreated event
      await expect(eventTicket.connect(owner).createEvent(
        name,
        date,
        tierNames,
        prices,
        maxSupply,
        resaleCapPercent,
        royaltyPercent
      )).to.emit(eventTicket, "EventCreated")
        .withArgs(1, name, date, resaleCapPercent, royaltyPercent);

      // Verify stored event data using our custom getEventTiers helper
      const tiers = await eventTicket.getEventTiers(1);
      expect(tiers.tierNames[0]).to.equal("General");
      expect(tiers.prices[0]).to.equal(prices[0]);
      expect(tiers.maxSupply[0]).to.equal(100n);
      expect(tiers.mintedSupply[0]).to.equal(0n);
    });

    it("Should revert if non-owner tries to create an event", async function () {
      const name = "Underground Party";
      const date = Math.floor(Date.now() / 1000) + 86400;
      const tierNames = ["Standard"];
      const prices = [ethers.parseEther("0.01")];
      const maxSupply = [50];
      const resaleCapPercent = 100;
      const royaltyPercent = 5;

      // Non-owners calling createEvent should fail with the OwnableUnauthorizedAccount custom error
      await expect(
        eventTicket.connect(addr1).createEvent(
          name,
          date,
          tierNames,
          prices,
          maxSupply,
          resaleCapPercent,
          royaltyPercent
        )
      ).to.be.revertedWithCustomError(eventTicket, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("Should revert if array lengths do not match", async function () {
      const name = "Invalid Event";
      const date = Math.floor(Date.now() / 1000) + 86400;
      const tierNames = ["General", "VIP"];
      const prices = [ethers.parseEther("0.05")]; // length 1 (mismatch)
      const maxSupply = [100, 20]; // length 2
      const resaleCapPercent = 110;
      const royaltyPercent = 10;

      await expect(
        eventTicket.connect(owner).createEvent(
          name,
          date,
          tierNames,
          prices,
          maxSupply,
          resaleCapPercent,
          royaltyPercent
        )
      ).to.be.revertedWith("Array lengths for tierNames, prices, and maxSupply must match");
    });
  });

  describe("Minting Tickets", function () {
    const eventName = "Tech Festival";
    let eventDate;
    const tierNames = ["General", "VIP"];
    let prices;
    const maxSupply = [2, 10]; // Low supply to test exhaustion limit easily
    const resaleCapCap = 120;
    const royalty = 8;
    let eventId;

    // Create a default event before each minting test
    beforeEach(async function () {
      eventDate = Math.floor(Date.now() / 1000) + 86400;
      prices = [ethers.parseEther("0.05"), ethers.parseEther("0.15")];
      
      await eventTicket.connect(owner).createEvent(
        eventName,
        eventDate,
        tierNames,
        prices,
        maxSupply,
        resaleCapCap,
        royalty
      );
      eventId = 1;
    });

    it("Should successfully mint a ticket and verify ownership and mapping", async function () {
      const tierIndex = 0; // General tier
      const ticketPrice = prices[tierIndex];

      // Expect successful minting to emit TicketMinted
      await expect(eventTicket.connect(addr1).mintTicket(eventId, tierIndex, { value: ticketPrice }))
        .to.emit(eventTicket, "TicketMinted")
        .withArgs(addr1.address, eventId, 1, tierIndex);

      // Verify that addr1 owns the newly minted token (tokenId = 1)
      expect(await eventTicket.ownerOf(1)).to.equal(addr1.address);

      // Verify that the ticket struct mapping is correctly updated
      const ticket = await eventTicket.tickets(1);
      expect(ticket.eventId).to.equal(eventId);
      expect(ticket.tier).to.equal(tierIndex);
      expect(ticket.used).to.be.false;

      // Verify that nextTokenId incremented to 2
      expect(await eventTicket.nextTokenId()).to.equal(2n);

      // Verify that the supply counts updated
      const tiers = await eventTicket.getEventTiers(eventId);
      expect(tiers.mintedSupply[tierIndex]).to.equal(1n);

      // Verify that the wallet mint count updated
      expect(await eventTicket.walletEventMintCount(eventId, addr1.address)).to.equal(1n);
    });

    it("Should revert if payment is incorrect", async function () {
      const tierIndex = 0;
      const incorrectPrice = ethers.parseEther("0.04"); // Correct is 0.05

      await expect(
        eventTicket.connect(addr1).mintTicket(eventId, tierIndex, { value: incorrectPrice })
      ).to.be.revertedWith("Incorrect payment amount sent");
    });

    it("Should revert if trying to mint beyond max supply of a tier", async function () {
      const tierIndex = 0; // General tier (maxSupply is 2)
      const ticketPrice = prices[tierIndex];

      // Mint first ticket
      await eventTicket.connect(addr1).mintTicket(eventId, tierIndex, { value: ticketPrice });
      // Mint second ticket (supply is now full)
      await eventTicket.connect(addr2).mintTicket(eventId, tierIndex, { value: ticketPrice });

      // Attempt to mint third ticket (should revert)
      await expect(
        eventTicket.connect(addr1).mintTicket(eventId, tierIndex, { value: ticketPrice })
      ).to.be.revertedWith("Tier supply has been exhausted");
    });

    it("Should revert if trying to mint beyond the per-wallet limit (max 4 tickets)", async function () {
      const tierIndex = 1; // VIP tier (maxSupply is 10)
      const ticketPrice = prices[tierIndex];

      // Mint 4 tickets using addr1
      await eventTicket.connect(addr1).mintTicket(eventId, tierIndex, { value: ticketPrice });
      await eventTicket.connect(addr1).mintTicket(eventId, tierIndex, { value: ticketPrice });
      await eventTicket.connect(addr1).mintTicket(eventId, tierIndex, { value: ticketPrice });
      await eventTicket.connect(addr1).mintTicket(eventId, tierIndex, { value: ticketPrice });

      // Attempt to mint the 5th ticket (should revert)
      await expect(
        eventTicket.connect(addr1).mintTicket(eventId, tierIndex, { value: ticketPrice })
      ).to.be.revertedWith("Exceeds maximum limit of 4 tickets per event per wallet");
    });
  });

  describe("Withdrawal", function () {
    it("Should allow the owner to withdraw accumulated funds", async function () {
      const eventDate = Math.floor(Date.now() / 1000) + 86400;
      const prices = [ethers.parseEther("1.0")];
      await eventTicket.connect(owner).createEvent(
        "Expensive Concert",
        eventDate,
        ["Standard"],
        prices,
        [10],
        100,
        5
      );

      // Buy a ticket for 1 ETH
      await eventTicket.connect(addr1).mintTicket(1, 0, { value: ethers.parseEther("1.0") });

      // Check contract balance
      const contractAddress = await eventTicket.getAddress();
      const contractBalanceBefore = await ethers.provider.getBalance(contractAddress);
      expect(contractBalanceBefore).to.equal(ethers.parseEther("1.0"));

      // Owner withdraws
      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
      
      const tx = await eventTicket.connect(owner).withdraw();
      const receipt = await tx.wait();
      
      // Calculate gas cost (gasUsed * gasPrice)
      const gasUsed = receipt.gasUsed;
      const gasPrice = tx.gasPrice;
      const gasCost = gasUsed * gasPrice;

      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      const contractBalanceAfter = await ethers.provider.getBalance(contractAddress);

      expect(contractBalanceAfter).to.equal(0n);
      expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + ethers.parseEther("1.0") - gasCost);
    });

    it("Should revert if non-owner tries to withdraw", async function () {
      await expect(
        eventTicket.connect(addr1).withdraw()
      ).to.be.revertedWithCustomError(eventTicket, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });
  });

  describe("Ticket Resale", function () {
    const eventName = "Summer Festival";
    let eventDate;
    const tierNames = ["General", "VIP"];
    let prices;
    const maxSupply = [10, 5];
    const resaleCapPercent = 120; // 120% cap
    const royaltyPercent = 10;    // 10% royalty
    let eventId = 1;
    let tokenId = 1;

    beforeEach(async function () {
      eventDate = Math.floor(Date.now() / 1000) + 86400;
      prices = [ethers.parseEther("0.1"), ethers.parseEther("0.5")];
      
      // Create Event
      await eventTicket.connect(owner).createEvent(
        eventName,
        eventDate,
        tierNames,
        prices,
        maxSupply,
        resaleCapPercent,
        royaltyPercent
      );

      // Mint a General ticket to addr1
      await eventTicket.connect(addr1).mintTicket(eventId, 0, { value: prices[0] });
    });

    it("Should list a ticket for resale within the price cap successfully", async function () {
      const listPrice = ethers.parseEther("0.12"); // exactly 120% of 0.1
      await expect(eventTicket.connect(addr1).listForResale(tokenId, listPrice))
        .to.emit(eventTicket, "ResaleListed")
        .withArgs(tokenId, listPrice, addr1.address);

      const listing = await eventTicket.getResaleListing(tokenId);
      expect(listing.isListed).to.be.true;
      expect(listing.price).to.equal(listPrice);
      expect(listing.seller).to.equal(addr1.address);
    });

    it("Should revert if listing price exceeds the resale cap", async function () {
      const invalidPrice = ethers.parseEther("0.121"); // exceeds 120% of 0.1
      await expect(
        eventTicket.connect(addr1).listForResale(tokenId, invalidPrice)
      ).to.be.revertedWith("Price exceeds resale cap");
    });

    it("Should revert if non-owner tries to list a ticket", async function () {
      const listPrice = ethers.parseEther("0.1");
      await expect(
        eventTicket.connect(addr2).listForResale(tokenId, listPrice)
      ).to.be.revertedWith("Not the ticket owner");
    });

    it("Should successfully buy a resale ticket - verify new owner, seller and organizer payments", async function () {
      const listPrice = ethers.parseEther("0.12");
      await eventTicket.connect(addr1).listForResale(tokenId, listPrice);

      // Royalty = 10% of 0.12 = 0.012 ETH
      // Seller remainder = 0.108 ETH
      const royaltyAmount = ethers.parseEther("0.012");
      const sellerAmount = ethers.parseEther("0.108");

      // Balance before
      const organizerBalanceBefore = await ethers.provider.getBalance(owner.address);
      const sellerBalanceBefore = await ethers.provider.getBalance(addr1.address);

      // Buyer (addr2) buys
      const tx = await eventTicket.connect(addr2).buyResale(tokenId, { value: listPrice });
      await tx.wait();

      // Verify new owner
      expect(await eventTicket.ownerOf(tokenId)).to.equal(addr2.address);

      // Verify listing cleared
      const listing = await eventTicket.getResaleListing(tokenId);
      expect(listing.isListed).to.be.false;

      // Verify balances
      const organizerBalanceAfter = await ethers.provider.getBalance(owner.address);
      const sellerBalanceAfter = await ethers.provider.getBalance(addr1.address);

      expect(organizerBalanceAfter).to.equal(organizerBalanceBefore + royaltyAmount);
      expect(sellerBalanceAfter).to.equal(sellerBalanceBefore + sellerAmount);
    });

    it("Should revert if trying to buy with incorrect payment", async function () {
      const listPrice = ethers.parseEther("0.12");
      await eventTicket.connect(addr1).listForResale(tokenId, listPrice);

      await expect(
        eventTicket.connect(addr2).buyResale(tokenId, { value: ethers.parseEther("0.1") })
      ).to.be.revertedWith("Incorrect payment amount sent");
    });

    it("Should revert if trying to buy a ticket that isn't listed", async function () {
      await expect(
        eventTicket.connect(addr2).buyResale(tokenId, { value: ethers.parseEther("0.1") })
      ).to.be.revertedWith("Ticket not listed for resale");
    });

    it("Should cancel a resale listing and verify it can no longer be bought", async function () {
      const listPrice = ethers.parseEther("0.1");
      await eventTicket.connect(addr1).listForResale(tokenId, listPrice);

      await expect(eventTicket.connect(addr1).cancelResaleListing(tokenId))
        .to.emit(eventTicket, "ResaleCancelled")
        .withArgs(tokenId, addr1.address);

      // Verify it's no longer listed
      const listing = await eventTicket.getResaleListing(tokenId);
      expect(listing.isListed).to.be.false;

      // Verify buy reverts
      await expect(
        eventTicket.connect(addr2).buyResale(tokenId, { value: listPrice })
      ).to.be.revertedWith("Ticket not listed for resale");
    });

    it("Should revert if non-owner tries to cancel listing", async function () {
      const listPrice = ethers.parseEther("0.1");
      await eventTicket.connect(addr1).listForResale(tokenId, listPrice);

      await expect(
        eventTicket.connect(addr2).cancelResaleListing(tokenId)
      ).to.be.revertedWith("Not the ticket owner");
    });
  });

  describe("Entry Verification", function () {
    const eventName = "Tech Meetup";
    let eventDate;
    const tierNames = ["Standard"];
    let prices;
    const maxSupply = [100];
    const resaleCapPercent = 100;
    const royaltyPercent = 0;
    let eventId = 1;
    let tokenId = 1;
    let verifier;
    let unauthorized;

    beforeEach(async function () {
      [, addr1, addr2, verifier, unauthorized] = await ethers.getSigners();
      eventDate = Math.floor(Date.now() / 1000) + 86400;
      prices = [ethers.parseEther("0.02")];

      await eventTicket.connect(owner).createEvent(
        eventName,
        eventDate,
        tierNames,
        prices,
        maxSupply,
        resaleCapPercent,
        royaltyPercent
      );

      // Mint ticket 1 to addr1
      await eventTicket.connect(addr1).mintTicket(eventId, 0, { value: prices[0] });
    });

    it("Owner can add a verifier successfully", async function () {
      await expect(eventTicket.connect(owner).addVerifier(verifier.address))
        .to.emit(eventTicket, "VerifierAdded")
        .withArgs(verifier.address);

      expect(await eventTicket.authorizedVerifiers(verifier.address)).to.be.true;
    });

    it("Non-owner cannot add a verifier (reverts)", async function () {
      await expect(
        eventTicket.connect(addr1).addVerifier(verifier.address)
      ).to.be.revertedWithCustomError(eventTicket, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("An authorized verifier can call markAsUsed successfully", async function () {
      // Add verifier
      await eventTicket.connect(owner).addVerifier(verifier.address);

      // Verifier marks as used
      await expect(eventTicket.connect(verifier).markAsUsed(tokenId))
        .to.emit(eventTicket, "TicketUsed")
        .withArgs(tokenId, eventId, verifier.address);

      const details = await eventTicket.getTicketDetails(tokenId);
      expect(details.used).to.be.true;
    });

    it("The owner (even without being explicitly added as verifier) can call markAsUsed", async function () {
      await expect(eventTicket.connect(owner).markAsUsed(tokenId))
        .to.emit(eventTicket, "TicketUsed")
        .withArgs(tokenId, eventId, owner.address);

      const details = await eventTicket.getTicketDetails(tokenId);
      expect(details.used).to.be.true;
    });

    it("A random unauthorized wallet cannot call markAsUsed (reverts)", async function () {
      await expect(
        eventTicket.connect(unauthorized).markAsUsed(tokenId)
      ).to.be.revertedWith("Not authorized: must be owner or verifier");
    });

    it("isValidForEvent returns true for an unused ticket", async function () {
      expect(await eventTicket.isValidForEvent(tokenId)).to.be.true;
    });

    it("isValidForEvent returns false after the ticket has been marked used", async function () {
      await eventTicket.connect(owner).markAsUsed(tokenId);
      expect(await eventTicket.isValidForEvent(tokenId)).to.be.false;
    });

    it("isValidForEvent returns false for a non-existent ticket", async function () {
      const nonExistentTokenId = 999;
      expect(await eventTicket.isValidForEvent(nonExistentTokenId)).to.be.false;
    });

    it("markAsUsed reverts if called twice on the same ticket (prevents double-entry)", async function () {
      await eventTicket.connect(owner).markAsUsed(tokenId);

      await expect(
        eventTicket.connect(owner).markAsUsed(tokenId)
      ).to.be.revertedWith("Ticket has already been used");
    });

    it("Owner can remove a verifier successfully", async function () {
      await eventTicket.connect(owner).addVerifier(verifier.address);
      
      await expect(eventTicket.connect(owner).removeVerifier(verifier.address))
        .to.emit(eventTicket, "VerifierRemoved")
        .withArgs(verifier.address);

      expect(await eventTicket.authorizedVerifiers(verifier.address)).to.be.false;
    });

    it("Non-owner cannot remove a verifier", async function () {
      await eventTicket.connect(owner).addVerifier(verifier.address);

      await expect(
        eventTicket.connect(addr1).removeVerifier(verifier.address)
      ).to.be.revertedWithCustomError(eventTicket, "OwnableUnauthorizedAccount")
        .withArgs(addr1.address);
    });

    it("Verifier cannot call markAsUsed after being removed", async function () {
      await eventTicket.connect(owner).addVerifier(verifier.address);
      await eventTicket.connect(owner).removeVerifier(verifier.address);

      await expect(
        eventTicket.connect(verifier).markAsUsed(tokenId)
      ).to.be.revertedWith("Not authorized: must be owner or verifier");
    });
  });

  describe("Organizer Verifier Authorization Invariant", function () {
    const eventName = "Hackathon 2026";
    let eventDate;
    const tierNames = ["Standard", "VIP"];
    let prices;
    const maxSupply = [100, 20];
    const resaleCapPercent = 110;
    const royaltyPercent = 5;
    let eventId = 1;
    let tokenId = 1;
    let verifier;
    let verifier2;
    let unauthorized;

    beforeEach(async function () {
      [, addr1, addr2, verifier, unauthorized, verifier2] = await ethers.getSigners();
      eventDate = Math.floor(Date.now() / 1000) + 86400;
      prices = [ethers.parseEther("0.05"), ethers.parseEther("0.1")];

      await eventTicket.connect(owner).createEvent(
        eventName,
        eventDate,
        tierNames,
        prices,
        maxSupply,
        resaleCapPercent,
        royaltyPercent
      );

      // Mint ticket 1 to addr1
      await eventTicket.connect(addr1).mintTicket(eventId, 0, { value: prices[0] });
    });

    it("1. The event organizer is initially recognized as an authorized verifier", async function () {
      expect(await eventTicket.authorizedVerifiers(owner.address)).to.be.true;
      expect(await eventTicket.organizer()).to.equal(owner.address);
    });

    it("2. An authorized administrator attempts to remove the organizer: the operation reverts", async function () {
      await expect(
        eventTicket.connect(owner).removeVerifier(owner.address)
      ).to.be.revertedWith("Cannot remove organizer as verifier");

      // Verify authorization status is completely intact
      expect(await eventTicket.authorizedVerifiers(owner.address)).to.be.true;
    });

    it("3. The organizer remains authorized after other verifiers are added", async function () {
      await eventTicket.connect(owner).addVerifier(verifier.address);
      await eventTicket.connect(owner).addVerifier(verifier2.address);

      expect(await eventTicket.authorizedVerifiers(verifier.address)).to.be.true;
      expect(await eventTicket.authorizedVerifiers(verifier2.address)).to.be.true;
      expect(await eventTicket.authorizedVerifiers(owner.address)).to.be.true;
    });

    it("4. Removing a non-organizer verifier succeeds when the caller has permission", async function () {
      await eventTicket.connect(owner).addVerifier(verifier.address);
      expect(await eventTicket.authorizedVerifiers(verifier.address)).to.be.true;

      await expect(eventTicket.connect(owner).removeVerifier(verifier.address))
        .to.emit(eventTicket, "VerifierRemoved")
        .withArgs(verifier.address);

      expect(await eventTicket.authorizedVerifiers(verifier.address)).to.be.false;
    });

    it("5. An unauthorized wallet cannot remove another verifier or the organizer", async function () {
      await eventTicket.connect(owner).addVerifier(verifier.address);

      await expect(
        eventTicket.connect(unauthorized).removeVerifier(verifier.address)
      ).to.be.revertedWithCustomError(eventTicket, "OwnableUnauthorizedAccount")
        .withArgs(unauthorized.address);

      await expect(
        eventTicket.connect(unauthorized).removeVerifier(owner.address)
      ).to.be.revertedWithCustomError(eventTicket, "OwnableUnauthorizedAccount")
        .withArgs(unauthorized.address);
    });

    it("6. The organizer remains authorized after another verifier is removed", async function () {
      await eventTicket.connect(owner).addVerifier(verifier.address);
      await eventTicket.connect(owner).removeVerifier(verifier.address);

      expect(await eventTicket.authorizedVerifiers(owner.address)).to.be.true;
      await expect(eventTicket.connect(owner).markAsUsed(tokenId))
        .to.emit(eventTicket, "TicketUsed")
        .withArgs(tokenId, eventId, owner.address);

      const details = await eventTicket.getTicketDetails(tokenId);
      expect(details.used).to.be.true;
    });

    it("7. Attempting to enter or scan a ticket ID/hash does not alter organizer authorization", async function () {
      // Validate ticket
      expect(await eventTicket.isValidForEvent(tokenId)).to.be.true;
      const details = await eventTicket.getTicketDetails(tokenId);
      expect(details.used).to.be.false;

      // Non-existent ticket query
      expect(await eventTicket.isValidForEvent(99999)).to.be.false;

      // Checking in ticket
      await eventTicket.connect(owner).markAsUsed(tokenId);

      // Organizer verifier status is completely unaltered
      expect(await eventTicket.authorizedVerifiers(owner.address)).to.be.true;
      expect(await eventTicket.organizer()).to.equal(owner.address);
    });

    it("8. Verifier changes for one event do not affect another event", async function () {
      // Create second event within the same contract
      const event2Date = Math.floor(Date.now() / 1000) + 172800;
      await eventTicket.connect(owner).createEvent(
        "Music Fest",
        event2Date,
        ["General"],
        [ethers.parseEther("0.08")],
        [50],
        120,
        10
      );
      const eventId2 = 2;

      // Mint ticket 2 for Event 2 to addr2
      await eventTicket.connect(addr2).mintTicket(eventId2, 0, { value: ethers.parseEther("0.08") });
      const tokenId2 = 2;

      // Add and remove verifier
      await eventTicket.connect(owner).addVerifier(verifier.address);
      await eventTicket.connect(owner).removeVerifier(verifier.address);

      // Organizer checks in ticket 1 for Event 1
      await eventTicket.connect(owner).markAsUsed(tokenId);
      expect(await eventTicket.isValidForEvent(tokenId)).to.be.false;

      // Ticket 2 for Event 2 remains completely unaffected and valid
      expect(await eventTicket.isValidForEvent(tokenId2)).to.be.true;
      const ticket2Details = await eventTicket.getTicketDetails(tokenId2);
      expect(ticket2Details.used).to.be.false;
      expect(ticket2Details.eventId).to.equal(eventId2);

      // Organizer can also check in Event 2's ticket
      await expect(eventTicket.connect(owner).markAsUsed(tokenId2))
        .to.emit(eventTicket, "TicketUsed")
        .withArgs(tokenId2, eventId2, owner.address);

      // Also verify separate contract deployments are completely isolated
      const EventTicketFactory = await ethers.getContractFactory("EventTicket");
      const eventTicketB = await EventTicketFactory.deploy(addr1.address);
      await eventTicketB.waitForDeployment();

      expect(await eventTicketB.authorizedVerifiers(addr1.address)).to.be.true;
      expect(await eventTicketB.authorizedVerifiers(owner.address)).to.be.false;

      // Verifier changes on contract A do not impact contract B
      await eventTicket.connect(owner).addVerifier(verifier.address);
      expect(await eventTicket.authorizedVerifiers(verifier.address)).to.be.true;
      expect(await eventTicketB.authorizedVerifiers(verifier.address)).to.be.false;
    });

    it("9. Ticket validation and check-in continue to work", async function () {
      await eventTicket.connect(owner).addVerifier(verifier.address);

      expect(await eventTicket.isValidForEvent(tokenId)).to.be.true;

      await expect(eventTicket.connect(verifier).markAsUsed(tokenId))
        .to.emit(eventTicket, "TicketUsed")
        .withArgs(tokenId, eventId, verifier.address);

      expect(await eventTicket.isValidForEvent(tokenId)).to.be.false;

      await expect(
        eventTicket.connect(verifier).markAsUsed(tokenId)
      ).to.be.revertedWith("Ticket has already been used");
    });
  });
  describe("Security hardening", function () {
    let prices;
    const tierNames = ["General"];
    const maxSupply = [10];

    beforeEach(async function () {
      [owner, addr1, addr2] = await ethers.getSigners();
      prices = [ethers.parseEther("0.1")];
    });

    const create = (cap = 110, royalty = 5) =>
      eventTicket.connect(owner).createEvent(
        "Hardening Fest",
        Math.floor(Date.now() / 1000) + 86400,
        tierNames,
        prices,
        maxSupply,
        cap,
        royalty
      );

    it("rejects a royalty above 100%", async function () {
      await expect(create(110, 101)).to.be.revertedWith("Royalty percent cannot exceed 100");
    });

    it("accepts a royalty of exactly 100%", async function () {
      await expect(create(110, 100)).to.not.be.reverted;
    });

    it("rejects a resale cap below 100%", async function () {
      await expect(create(99, 5)).to.be.revertedWith("Resale cap percent must be at least 100");
    });

    it("blocks direct transferFrom so the resale cap cannot be bypassed", async function () {
      await create();
      await eventTicket.connect(addr1).mintTicket(1, 0, { value: prices[0] });
      await expect(
        eventTicket.connect(addr1).transferFrom(addr1.address, addr2.address, 1)
      ).to.be.revertedWith("Direct transfers disabled: use the resale marketplace");
      await expect(
        eventTicket.connect(addr1)["safeTransferFrom(address,address,uint256)"](addr1.address, addr2.address, 1)
      ).to.be.revertedWith("Direct transfers disabled: use the resale marketplace");
      expect(await eventTicket.ownerOf(1)).to.equal(addr1.address);
    });

    it("still allows buying through the marketplace and updates ownership", async function () {
      await create();
      await eventTicket.connect(addr1).mintTicket(1, 0, { value: prices[0] });
      const listPrice = ethers.parseEther("0.11");
      await eventTicket.connect(addr1).listForResale(1, listPrice);
      await eventTicket.connect(addr2).buyResale(1, { value: listPrice });
      expect(await eventTicket.ownerOf(1)).to.equal(addr2.address);
      const listing = await eventTicket.getResaleListing(1);
      expect(listing.isListed).to.equal(false);
    });

    it("pays seller and organizer correctly on a marketplace sale", async function () {
      await create(110, 10);
      await eventTicket.connect(addr1).mintTicket(1, 0, { value: prices[0] });
      const listPrice = ethers.parseEther("0.11");
      await eventTicket.connect(addr1).listForResale(1, listPrice);

      const sellerBefore = await ethers.provider.getBalance(addr1.address);
      const ownerBefore = await ethers.provider.getBalance(owner.address);
      await eventTicket.connect(addr2).buyResale(1, { value: listPrice });

      expect(await ethers.provider.getBalance(addr1.address)).to.equal(sellerBefore + ethers.parseEther("0.099"));
      expect(await ethers.provider.getBalance(owner.address)).to.equal(ownerBefore + ethers.parseEther("0.011"));
    });

    it("does not allow listing a ticket that has already been used", async function () {
      await create();
      await eventTicket.connect(addr1).mintTicket(1, 0, { value: prices[0] });
      await eventTicket.connect(owner).markAsUsed(1);
      await expect(
        eventTicket.connect(addr1).listForResale(1, ethers.parseEther("0.1"))
      ).to.be.revertedWith("Ticket has already been used");
    });

    it("does not allow buying a listed ticket that was checked in after listing", async function () {
      await create();
      await eventTicket.connect(addr1).mintTicket(1, 0, { value: prices[0] });
      await eventTicket.connect(addr1).listForResale(1, ethers.parseEther("0.1"));
      await eventTicket.connect(owner).markAsUsed(1);
      await expect(
        eventTicket.connect(addr2).buyResale(1, { value: ethers.parseEther("0.1") })
      ).to.be.revertedWith("Ticket has already been used");
    });

    it("owner cannot check in the same ticket twice", async function () {
      await create();
      await eventTicket.connect(addr1).mintTicket(1, 0, { value: prices[0] });
      await eventTicket.connect(owner).markAsUsed(1);
      expect((await eventTicket.getTicketDetails(1)).used).to.equal(true);
      expect(await eventTicket.isValidForEvent(1)).to.equal(false);
      await expect(eventTicket.connect(owner).markAsUsed(1))
        .to.be.revertedWith("Ticket has already been used");
    });

    it("authorized verifier cannot check in a ticket twice, and unauthorized wallets cannot check in", async function () {
      await create();
      await eventTicket.connect(addr1).mintTicket(1, 0, { value: prices[0] });

      // addr2 is not yet a verifier
      await expect(eventTicket.connect(addr2).markAsUsed(1))
        .to.be.revertedWith("Not authorized: must be owner or verifier");

      await eventTicket.connect(owner).addVerifier(addr2.address);
      await expect(eventTicket.connect(addr2).markAsUsed(1))
        .to.emit(eventTicket, "TicketUsed")
        .withArgs(1, 1, addr2.address);

      // second scan by the verifier, and by the owner, both rejected
      await expect(eventTicket.connect(addr2).markAsUsed(1))
        .to.be.revertedWith("Ticket has already been used");
      await expect(eventTicket.connect(owner).markAsUsed(1))
        .to.be.revertedWith("Ticket has already been used");
    });

    it("still lets the owner cancel a listing after the change", async function () {
      await create();
      await eventTicket.connect(addr1).mintTicket(1, 0, { value: prices[0] });
      await eventTicket.connect(addr1).listForResale(1, ethers.parseEther("0.1"));
      await eventTicket.connect(addr1).cancelResaleListing(1);
      expect((await eventTicket.getResaleListing(1)).isListed).to.equal(false);
    });
  });
});
