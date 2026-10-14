// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// We import standard ERC721 and Ownable contracts from OpenZeppelin.
// ERC721 provides all the standard NFT logic (transfer, approval, metadata, etc.).
// Ownable provides basic access control, allowing us to restrict certain functions (like event creation) to the owner.
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC721Utils} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Utils.sol";

/**
 * @title EventTicket
 * @dev A smart contract for creating events and minting event tickets as ERC721 NFTs.
 */
contract EventTicket is ERC721, Ownable, ReentrancyGuard {

    // Struct representing an Event stored on-chain
    struct Event {
        string name;                   // Name of the event
        uint256 date;                  // Date/timestamp of the event
        string[] tierNames;            // Names of the different ticket tiers (e.g., "General", "VIP")
        uint256[] prices;              // Price for each ticket tier in wei (1 ether = 10^18 wei)
        uint256[] maxSupply;           // Maximum number of tickets available for each tier
        uint256[] mintedSupply;        // Number of tickets currently minted for each tier
        uint256 resaleCapPercent;      // Resale price cap percentage (e.g., 110 for 110%)
        uint256 royaltyPercent;        // Creator royalty percentage for secondary sales (e.g., 10 for 10%)
    }

    // Struct representing a Ticket NFT's metadata
    struct Ticket {
        uint256 eventId;               // The ID of the event this ticket belongs to
        uint256 tier;                  // The tier index of this ticket
        bool used;                     // Whether this ticket has been used/validated (default false)
    }

    // Counter for unique event IDs (starts at 1)
    uint256 public nextEventId = 1;

    // Counter for unique NFT token IDs (starts at 1)
    uint256 public nextTokenId = 1;

    // Mapping from event ID to Event details
    mapping(uint256 => Event) public events;

    // Mapping from NFT tokenId to Ticket details
    mapping(uint256 => Ticket) public tickets;

    // Mapping to track the number of tickets minted by a specific address for a specific event
    // Structure: eventId => (walletAddress => mintCount)
    mapping(uint256 => mapping(address => uint256)) public walletEventMintCount;

    // Struct representing a Resale Listing
    struct ResaleListing {
        bool isListed;
        uint256 price;
        address seller;
    }

    // Mapping from NFT tokenId to ResaleListing details
    mapping(uint256 => ResaleListing) public resaleListings;

    // Mapping to track authorized verifiers (gate staff)
    mapping(address => bool) public authorizedVerifiers;

    // True only while buyResale is moving a ticket. Every other transfer path
    // (transferFrom / safeTransferFrom) is blocked so the resale price cap and
    // organizer royalty cannot be bypassed by selling a ticket off-platform.
    bool private _marketplaceTransfer;

    // Events emitted during contract actions to allow external tools (like frontends) to listen for updates
    event EventCreated(
        uint256 indexed eventId,
        string name,
        uint256 date,
        uint256 resaleCapPercent,
        uint256 royaltyPercent
    );

    event TicketMinted(
        address indexed buyer,
        uint256 indexed eventId,
        uint256 indexed tokenId,
        uint256 tier
    );

    event ResaleListed(uint256 indexed tokenId, uint256 price, address indexed seller);
    event ResaleCancelled(uint256 indexed tokenId, address indexed seller);
    event ResaleBought(
        uint256 indexed tokenId,
        uint256 price,
        address indexed buyer,
        address indexed seller
    );

    event VerifierAdded(address indexed verifier);
    event VerifierRemoved(address indexed verifier);
    event TicketUsed(uint256 indexed tokenId, uint256 indexed eventId, address indexed scannedBy);

    // Modifier that restricts access to only the contract owner or an authorized verifier
    modifier onlyVerifierOrOwner() {
        require(
            msg.sender == owner() || authorizedVerifiers[msg.sender],
            "Not authorized: must be owner or verifier"
        );
        _;
    }

    /**
     * @dev Constructor that initializes the ERC721 name and symbol, and sets the initial owner.
     * @param initialOwner The address of the initial contract owner.
     */
    constructor(address initialOwner) 
        ERC721("EventTicket", "EVT") 
        Ownable(initialOwner) 
    {}

    /**
     * @notice Creates a new event. Only callable by the contract owner.
     * @param name Name of the event.
     * @param date Timestamp/date of the event.
     * @param tierNames Dynamic array of ticket tier names.
     * @param prices Dynamic array of ticket prices for each tier (in wei).
     * @param maxSupply Dynamic array of max supply for each tier.
     * @param resaleCapPercent Price cap percentage for reselling tickets.
     * @param royaltyPercent Royalty percentage for secondary sales.
     * @return The ID of the newly created event.
     */
    function createEvent(
        string memory name,
        uint256 date,
        string[] memory tierNames,
        uint256[] memory prices,
        uint256[] memory maxSupply,
        uint256 resaleCapPercent,
        uint256 royaltyPercent
    ) external onlyOwner returns (uint256) {
        // Validation: Verify that the array lengths for tierNames, prices, and maxSupply match.
        // This ensures every tier has a corresponding price and maximum supply limit.
        require(
            tierNames.length == prices.length && prices.length == maxSupply.length,
            "Array lengths for tierNames, prices, and maxSupply must match"
        );

        // Validation: Ensure there is at least one ticket tier specified.
        require(tierNames.length > 0, "At least one ticket tier must be provided");

        // Validation: a royalty above 100% would underflow the seller payout in buyResale
        // and make every resale of this event revert.
        require(royaltyPercent <= 100, "Royalty percent cannot exceed 100");

        // Validation: a cap below 100% would force sellers to take a loss; a zero cap blocks resale.
        require(resaleCapPercent >= 100, "Resale cap percent must be at least 100");

        // Grab the ID for this new event
        uint256 eventId = nextEventId;
        nextEventId++;

        // Store the event data in our state mapping.
        // We initialize a new mintedSupply array of the same length with 0s.
        events[eventId] = Event({
            name: name,
            date: date,
            tierNames: tierNames,
            prices: prices,
            maxSupply: maxSupply,
            mintedSupply: new uint256[](tierNames.length),
            resaleCapPercent: resaleCapPercent,
            royaltyPercent: royaltyPercent
        });

        // Emit an event to signal to external clients that a new event was created
        emit EventCreated(eventId, name, date, resaleCapPercent, royaltyPercent);

        return eventId;
    }

    /**
     * @notice Mints a ticket NFT for a specific event and tier. Payable function.
     * @param eventId The ID of the event.
     * @param tier The index of the ticket tier.
     * @return The token ID of the minted ticket NFT.
     */
    function mintTicket(uint256 eventId, uint256 tier) external payable nonReentrant returns (uint256) {
        // Validation: Ensure the eventId refers to an event that has actually been created.
        // (Since nextEventId starts at 1 and increases, any valid eventId must be less than nextEventId)
        require(eventId > 0 && eventId < nextEventId, "Event does not exist");

        // Reference the event stored in state
        Event storage myEvent = events[eventId];

        // Validation: Ensure the requested tier index is valid.
        // It must be within the bounds of the event's tiers array.
        require(tier < myEvent.tierNames.length, "Invalid tier index");

        // Validation: Check that the supply of tickets for this specific tier is not exhausted.
        require(
            myEvent.mintedSupply[tier] < myEvent.maxSupply[tier],
            "Tier supply has been exhausted"
        );

        // Validation: Check the per-wallet mint limit.
        // A single wallet/address is allowed to mint at most 4 tickets per event.
        require(
            walletEventMintCount[eventId][msg.sender] < 4,
            "Exceeds maximum limit of 4 tickets per event per wallet"
        );

        // Validation: Ensure the buyer sent enough Ether to cover the ticket price.
        require(msg.value == myEvent.prices[tier], "Incorrect payment amount sent");

        // Unique token ID for the new ticket NFT
        uint256 tokenId = nextTokenId;
        nextTokenId++;

        // Update the contract state before performing the mint (protects against reentrancy)
        myEvent.mintedSupply[tier]++;
        walletEventMintCount[eventId][msg.sender]++;

        // Map the new token ID to its ticket details
        tickets[tokenId] = Ticket({
            eventId: eventId,
            tier: tier,
            used: false
        });

        // Call the parent ERC721 implementation's _safeMint function.
        // This handles the safe ownership assignment and minting of the NFT.
        _safeMint(msg.sender, tokenId);

        // Emit an event to signal to external clients that a ticket was minted
        emit TicketMinted(msg.sender, eventId, tokenId, tier);

        return tokenId;
    }

    /**
     * @notice Helper view function to retrieve the details of event ticket tiers.
     * @param eventId The ID of the event.
     * @return tierNames The names of the tiers.
     * @return prices The prices of each tier.
     * @return maxSupply The max supply of each tier.
     * @return mintedSupply The current minted supply of each tier.
     */
    function getEventTiers(uint256 eventId)
        external
        view
        returns (
            string[] memory tierNames,
            uint256[] memory prices,
            uint256[] memory maxSupply,
            uint256[] memory mintedSupply
        )
    {
        require(eventId > 0 && eventId < nextEventId, "Event does not exist");
        Event storage myEvent = events[eventId];
        return (
            myEvent.tierNames,
            myEvent.prices,
            myEvent.maxSupply,
            myEvent.mintedSupply
        );
    }

    /**
     * @notice Allows the contract owner to withdraw all accumulated ether funds from the contract.
     */
    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds available to withdraw");
        
        // Transfer all funds to the owner
        (bool success, ) = owner().call{value: balance}("");
        require(success, "Withdrawal transfer failed");
    }

    /**
     * @notice Lists a ticket NFT for resale. Callable only by the current owner of the ticket.
     * @param tokenId The ID of the ticket NFT to list.
     * @param price The listing price in wei.
     */
    function listForResale(uint256 tokenId, uint256 price) external {
        require(ownerOf(tokenId) == msg.sender, "Not the ticket owner");
        
        Ticket storage ticket = tickets[tokenId];
        require(!ticket.used, "Ticket has already been used");

        Event storage myEvent = events[ticket.eventId];
        
        uint256 originalPrice = myEvent.prices[ticket.tier];
        uint256 maxPrice = (originalPrice * myEvent.resaleCapPercent) / 100;
        require(price <= maxPrice, "Price exceeds resale cap");

        resaleListings[tokenId] = ResaleListing({
            isListed: true,
            price: price,
            seller: msg.sender
        });

        emit ResaleListed(tokenId, price, msg.sender);
    }

    /**
     * @notice Cancels an active resale listing. Callable only by the current owner of the ticket.
     * @param tokenId The ID of the ticket NFT.
     */
    function cancelResaleListing(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "Not the ticket owner");
        require(resaleListings[tokenId].isListed, "Ticket not listed for resale");

        delete resaleListings[tokenId];

        emit ResaleCancelled(tokenId, msg.sender);
    }

    /**
     * @notice Buys a ticket listed for resale. Payable function.
     * @param tokenId The ID of the ticket NFT.
     */
    function buyResale(uint256 tokenId) external payable nonReentrant {
        ResaleListing memory listing = resaleListings[tokenId];
        require(listing.isListed, "Ticket not listed for resale");
        require(msg.value == listing.price, "Incorrect payment amount sent");
        require(ownerOf(tokenId) == listing.seller, "Seller no longer owns ticket");

        Ticket storage ticket = tickets[tokenId];
        require(!ticket.used, "Ticket has already been used");
        Event storage myEvent = events[ticket.eventId];

        uint256 royaltyAmount = (listing.price * myEvent.royaltyPercent) / 100;
        uint256 sellerAmount = listing.price - royaltyAmount;

        // Effects: clear the listing and move the NFT before any ETH leaves the contract.
        delete resaleListings[tokenId];

        _marketplaceTransfer = true;
        _transfer(listing.seller, msg.sender, tokenId);
        _marketplaceTransfer = false;

        // Interactions: pay the organizer royalty, then the seller.
        if (royaltyAmount > 0) {
            (bool royaltySuccess, ) = owner().call{value: royaltyAmount}("");
            require(royaltySuccess, "Royalty transfer failed");
        }

        if (sellerAmount > 0) {
            (bool sellerSuccess, ) = listing.seller.call{value: sellerAmount}("");
            require(sellerSuccess, "Seller transfer failed");
        }

        // Keep ERC721 "safe" semantics: contract buyers must be able to receive tickets.
        ERC721Utils.checkOnERC721Received(msg.sender, listing.seller, msg.sender, tokenId, "");

        emit ResaleBought(tokenId, listing.price, msg.sender, listing.seller);
    }

    /**
     * @notice Returns the resale listing details for a ticket NFT.
     * @param tokenId The ID of the ticket NFT.
     * @return isListed Whether the ticket is listed for resale.
     * @return price The listing price.
     * @return seller The address of the seller.
     */
    function getResaleListing(uint256 tokenId)
        external
        view
        returns (
            bool isListed,
            uint256 price,
            address seller
        )
    {
        ResaleListing memory listing = resaleListings[tokenId];
        return (listing.isListed, listing.price, listing.seller);
    }

    /**
     * @notice Adds an address to the authorized verifiers list. Only callable by the contract owner.
     * @param verifier The address of the verifier to add.
     */
    function addVerifier(address verifier) external onlyOwner {
        require(verifier != address(0), "Invalid verifier address");
        authorizedVerifiers[verifier] = true;
        emit VerifierAdded(verifier);
    }

    /**
     * @notice Removes an address from the authorized verifiers list. Only callable by the contract owner.
     * @param verifier The address of the verifier to remove.
     */
    function removeVerifier(address verifier) external onlyOwner {
        require(authorizedVerifiers[verifier], "Address is not an authorized verifier");
        authorizedVerifiers[verifier] = false;
        emit VerifierRemoved(verifier);
    }

    /**
     * @notice Marks a ticket as used/validated. Only callable by the owner or authorized verifiers.
     * @param tokenId The ID of the ticket NFT to mark as used.
     */
    function markAsUsed(uint256 tokenId) external onlyVerifierOrOwner {
        // Validation: Verify the ticket has been minted (exists) by checking ownership
        address owner = ownerOf(tokenId); // reverts if non-existent
        require(owner != address(0), "Ticket does not exist");

        Ticket storage ticket = tickets[tokenId];
        require(!ticket.used, "Ticket has already been used");

        ticket.used = true;

        emit TicketUsed(tokenId, ticket.eventId, msg.sender);
    }

    /**
     * @notice Checks if a ticket is valid (i.e. exists and is not used).
     * @param tokenId The ID of the ticket NFT.
     * @return True if the ticket exists and has not been used, false otherwise.
     */
    function isValidForEvent(uint256 tokenId) external view returns (bool) {
        address owner = _ownerOf(tokenId);
        if (owner == address(0)) {
            return false;
        }
        return !tickets[tokenId].used;
    }

    /**
     * @notice Returns the details of a ticket, useful for gate staff validation apps.
     * @param tokenId The ID of the ticket NFT.
     * @return eventId The ID of the event this ticket belongs to.
     * @return tier The ticket tier index.
     * @return used Whether the ticket is used.
     * @return currentOwner The address of the ticket owner.
     */
    function getTicketDetails(uint256 tokenId)
        external
        view
        returns (
            uint256 eventId,
            uint256 tier,
            bool used,
            address currentOwner
        )
    {
        address owner = ownerOf(tokenId); // reverts if token doesn't exist
        Ticket storage ticket = tickets[tokenId];
        return (ticket.eventId, ticket.tier, ticket.used, owner);
    }

    /**
     * @dev Overrides ERC721's _update to
     *  1. block direct transfers: tickets can only be minted or moved through buyResale, so the
     *     resale price cap and royalty always apply, and
     *  2. clear any resale listing when a ticket changes hands.
     */
    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address from = _ownerOf(tokenId);

        if (from != address(0)) {
            require(
                _marketplaceTransfer,
                "Direct transfers disabled: use the resale marketplace"
            );
        }

        address previousOwner = super._update(to, tokenId, auth);

        if (previousOwner != address(0) && resaleListings[tokenId].isListed) {
            delete resaleListings[tokenId];
        }

        return previousOwner;
    }
}
