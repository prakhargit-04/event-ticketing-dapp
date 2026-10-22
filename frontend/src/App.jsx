import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { QRCodeCanvas } from 'qrcode.react'
import { Scanner } from '@yudiel/react-qr-scanner'
import eventTicketArtifact from './EventTicket.json'
import { resolveContractAddress } from "./config.js"
import { parseTicketQr, parseManualTicketInput } from "./ticketPayload.js"
import { isUserRejection } from "./walletErrors.js"
import RoleLanding from './RoleLanding'
import './App.css'

// VITE_CONTRACT_ADDRESS is required (.env locally, Environment Variables on Vercel).
// There is no fallback address: a missing or invalid value blocks wallet connection.
const { address: CONTRACT_ADDRESS, error: CONTRACT_CONFIG_ERROR } = resolveContractAddress({
  envAddress: import.meta.env.VITE_CONTRACT_ADDRESS,
})
const SEPOLIA_HEX_CHAIN_ID = "0xaa36a7"
const SEPOLIA_CHAIN_ID_BIGINT = 11155111n

function App() {
  const [account, setAccount] = useState("")
  const [contract, setContract] = useState(null)
  const [events, setEvents] = useState([])
  const [myTickets, setMyTickets] = useState([])
  const [resaleMarket, setResaleMarket] = useState([])
  const [activeTab, setActiveTab] = useState("browse") // "browse" | "tickets" | "organizer" | "verify"
  const [selectedRole, setSelectedRole] = useState(null) // null | 'attendee' | 'organizer' | 'verifier'

  // Loading states
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [status, setStatus] = useState(
    CONTRACT_CONFIG_ERROR ? { type: 'error', text: CONTRACT_CONFIG_ERROR } : null
  ) // { type: 'success'|'error'|'info', text: '' }

  // Organizer Form state
  const [eventName, setEventName] = useState("")
  const [eventDate, setEventDate] = useState("")
  const [tier1Name, setTier1Name] = useState("General")
  const [tier1Price, setTier1Price] = useState("0.01")
  const [tier1MaxSupply, setTier1MaxSupply] = useState("100")
  const [tier2Name, setTier2Name] = useState("VIP")
  const [tier2Price, setTier2Price] = useState("0.05")
  const [tier2MaxSupply, setTier2MaxSupply] = useState("20")
  const [resaleCap, setResaleCap] = useState("110")
  const [royalty, setRoyalty] = useState("5")

  // Resale Modal state
  const [resaleModalTokenId, setResaleModalTokenId] = useState(null)
  const [resaleModalMaxPrice, setResaleModalMaxPrice] = useState("0")
  const [resaleInputPrice, setResaleInputPrice] = useState("")

  // Verify/Scanner state
  const [isVerifierAuthorized, setIsVerifierAuthorized] = useState(null)
  const [scanResult, setScanResult] = useState(null)
  const [scanError, setScanError] = useState(null)
  const [verifyMode, setVerifyMode] = useState("camera") // "camera" | "manual"
  const [manualTokenInput, setManualTokenInput] = useState("")

  // Verifier Management state
  const [contractOwner, setContractOwner] = useState("")
  const [verifierInputAddress, setVerifierInputAddress] = useState("")

  // Auto-connect wallet and listen to live MetaMask events
  useEffect(() => {
    if (!window.ethereum) return

    const handleAccounts = (accounts) => {
      if (accounts && accounts.length > 0) {
        setAccount(accounts[0])
        setSelectedRole(null)
      } else {
        setAccount("")
        setContract(null)
        setEvents([])
        setMyTickets([])
        setResaleMarket([])
        setContractOwner("")
        setSelectedRole(null)
      }
    }

    const handleChain = () => {
      window.location.reload()
    }

    // Check currently active account on mount
    window.ethereum
      .request({ method: "eth_accounts" })
      .then(handleAccounts)
      .catch((err) => console.error("Error checking initial accounts:", err))

    // Listen to live accounts and network changes
    window.ethereum.on("accountsChanged", handleAccounts)
    window.ethereum.on("chainChanged", handleChain)

    return () => {
      if (window.ethereum?.removeListener) {
        window.ethereum.removeListener("accountsChanged", handleAccounts)
        window.ethereum.removeListener("chainChanged", handleChain)
      }
    }
  }, [])

  // Whenever account changes, re-initialize contract for the active account
  useEffect(() => {
    if (account) {
      initContract()
    }
  }, [account])

  const requestAccountChange = async () => {
    if (!window.ethereum) {
      alert("MetaMask is not installed.")
      return
    }
    try {
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      })
      const accounts = await window.ethereum.request({ method: "eth_accounts" })
      if (accounts && accounts.length > 0) {
        setAccount(accounts[0])
        setSelectedRole(null)
      }
    } catch (err) {
      console.error("User cancelled permission request or error:", err)
      // Only fall back to a plain connect for unsupported-method errors, not when the user said no
      if (!isUserRejection(err)) connectWallet()
    }
  }

  const initContract = async () => {
    try {
      if (CONTRACT_CONFIG_ERROR) {
        setStatus({ type: "error", text: CONTRACT_CONFIG_ERROR })
        return false
      }
      const provider = new ethers.BrowserProvider(window.ethereum)
      const network = await provider.getNetwork()

      if (network.chainId !== SEPOLIA_CHAIN_ID_BIGINT) {
        setContract(null)
        setEvents([])
        setMyTickets([])
        setResaleMarket([])
        setContractOwner("")
        setStatus({
          type: "error",
          text: "Wrong Network: Please switch your wallet network to Sepolia Test Network."
        })
        return false
      }

      const code = await provider.getCode(CONTRACT_ADDRESS)
      if (code === "0x") {
        setContract(null)
        setStatus({
          type: "error",
          text: "No contract found at the configured address on Sepolia. Check VITE_CONTRACT_ADDRESS."
        })
        return false
      }

      const signer = await provider.getSigner()
      const ticketContract = new ethers.Contract(
        CONTRACT_ADDRESS,
        eventTicketArtifact.abi,
        signer
      )
      setContract(ticketContract)
      setStatus(null)

      // Fetch owner / organizer address
      let ownerAddr = await ticketContract.owner()
      try {
        if (typeof ticketContract.organizer === "function") {
          const org = await ticketContract.organizer()
          if (org && org !== ethers.ZeroAddress) {
            ownerAddr = org
          }
        }
      } catch {
        // fallback to owner
      }
      setContractOwner(ownerAddr)

      return true
    } catch (err) {
      console.error("Failed to initialize contract:", err)
      return false
    }
  }

  const checkVerifierRole = useCallback(async () => {
    try {
      const ownerAddress = await contract.owner()
      const isVerifier = await contract.authorizedVerifiers(account)
      setIsVerifierAuthorized(ownerAddress.toLowerCase() === account.toLowerCase() || isVerifier)
    } catch (err) {
      console.error("Error checking verifier role:", err)
      setIsVerifierAuthorized(false)
    }
  }, [contract, account])

  const switchNetwork = async () => {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_HEX_CHAIN_ID }],
      })
      return true
    } catch (err) {
      console.error("Failed to switch network:", err)
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: SEPOLIA_HEX_CHAIN_ID,
                chainName: "Sepolia Test Network",
                nativeCurrency: {
                  name: "Sepolia Ether",
                  symbol: "SEP",
                  decimals: 18,
                },
                rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
                blockExplorerUrls: ["https://sepolia.etherscan.io"],
              },
            ],
          })
          return true
        } catch (addError) {
          console.error("Failed to add Sepolia network:", addError)
          setStatus({ type: "error", text: "Failed to add Sepolia Network to wallet." })
        }
      } else {
        setStatus({ type: "error", text: "Failed to switch network: " + err.message })
      }
      return false
    }
  }

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("MetaMask is not installed. Please install it to use this dashboard.")
      return null
    }
    if (CONTRACT_CONFIG_ERROR) {
      setStatus({ type: "error", text: CONTRACT_CONFIG_ERROR })
      return null
    }
    setLoading(true)
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" })

      const provider = new ethers.BrowserProvider(window.ethereum)
      const network = await provider.getNetwork()

      let initialized = false
      if (network.chainId !== SEPOLIA_CHAIN_ID_BIGINT) {
        initialized = await switchNetwork()
      } else {
        initialized = true
      }

      if (initialized) {
        const code = await provider.getCode(CONTRACT_ADDRESS)
        if (code === "0x") {
          setStatus({
            type: "error",
            text: "No contract found at the configured address on Sepolia. Check VITE_CONTRACT_ADDRESS."
          })
          return null
        }
        const signer = await provider.getSigner()
        const ticketContract = new ethers.Contract(
          CONTRACT_ADDRESS,
          eventTicketArtifact.abi,
          signer
        )
        let ownerAddr = await ticketContract.owner()
        try {
          if (typeof ticketContract.organizer === "function") {
            const org = await ticketContract.organizer()
            if (org && org !== ethers.ZeroAddress) {
              ownerAddr = org
            }
          }
        } catch {
          // fallback to owner
        }

        setAccount(accounts[0])
        setContract(ticketContract)
        setContractOwner(ownerAddr)
        setStatus(null)

        return { account: accounts[0], contract: ticketContract, owner: ownerAddr }
      }
      return null
    } catch (err) {
      console.error("Error connecting wallet:", err)
      setStatus({ type: "error", text: "Connection failed: " + err.message })
      return null
    } finally {
      setLoading(false)
    }
  }

  const refreshData = useCallback(async () => {
    if (!contract || !account) return
    setLoading(true)
    try {
      // 1. Fetch events
      const nextId = await contract.nextEventId()
      const totalEvents = Number(nextId) - 1
      // Fetch every event in parallel instead of one network round-trip at a time
      const fetchedEvents = await Promise.all(
        Array.from({ length: totalEvents }, (_, idx) => idx + 1).map(async (i) => {
          const [eventMeta, tierInfo, userMintCount] = await Promise.all([
            contract.events(i),
            contract.getEventTiers(i),
            contract.walletEventMintCount(i, account),
          ])

          const tiers = []
          for (let j = 0; j < tierInfo.tierNames.length; j++) {
            tiers.push({
              name: tierInfo.tierNames[j],
              price: ethers.formatEther(tierInfo.prices[j]),
              maxSupply: Number(tierInfo.maxSupply[j]),
              mintedSupply: Number(tierInfo.mintedSupply[j])
            })
          }

          return {
            id: i,
            name: eventMeta.name,
            date: new Date(Number(eventMeta.date) * 1000).toLocaleString(),
            resaleCapPercent: Number(eventMeta.resaleCapPercent),
            royaltyPercent: Number(eventMeta.royaltyPercent),
            userMintCount: Number(userMintCount),
            tiers
          }
        })
      )
      setEvents(fetchedEvents.reverse())

      // 2. Fetch User Tickets and Resale Listings (Loop-and-check approach)
      const nextToken = await contract.nextTokenId()
      const totalTokens = Number(nextToken) - 1
      const userOwned = []
      const listedTickets = []

      const promises = []
      for (let i = 1; i <= totalTokens; i++) {
        promises.push(
          (async () => {
            try {
              const owner = await contract.ownerOf(i)
              const details = await contract.getTicketDetails(i)
              const resaleListing = await contract.resaleListings(i)

              const matchingEvent = fetchedEvents.find(e => e.id === Number(details.eventId))
              const eventName = matchingEvent ? matchingEvent.name : `Event #${details.eventId}`
              const tierName = matchingEvent && matchingEvent.tiers[Number(details.tier)]
                ? matchingEvent.tiers[Number(details.tier)].name
                : `Tier #${details.tier}`
              const originalPrice = matchingEvent && matchingEvent.tiers[Number(details.tier)]
                ? matchingEvent.tiers[Number(details.tier)].price
                : "0"

              const ticketObj = {
                tokenId: i,
                eventId: Number(details.eventId),
                eventName,
                tier: Number(details.tier),
                tierName,
                used: details.used,
                originalPrice,
                isListed: resaleListing.isListed,
                resalePrice: ethers.formatEther(resaleListing.price),
                resaleSeller: resaleListing.seller,
                resaleCapPercent: matchingEvent ? matchingEvent.resaleCapPercent : 100
              }

              if (owner.toLowerCase() === account.toLowerCase()) {
                userOwned.push(ticketObj)
              }

              if (resaleListing.isListed && !details.used) {
                listedTickets.push({
                  ...ticketObj,
                  currentOwner: owner
                })
              }
            } catch {
              // Token does not exist (burned or unminted)
            }
          })()
        )
      }
      await Promise.all(promises)
      setMyTickets(userOwned.sort((a, b) => b.tokenId - a.tokenId))
      setResaleMarket(listedTickets.sort((a, b) => b.tokenId - a.tokenId))

    } catch (err) {
      console.error("Error refreshing data:", err)
    } finally {
      setLoading(false)
    }
  }, [contract, account])

  // Refresh all data when contract is ready or account changes
  useEffect(() => {
    if (contract && account) {
      refreshData()
    }
  }, [contract, account, refreshData])

  // Check verifier role status when the active tab is switched to "verify"
  useEffect(() => {
    if (activeTab === "verify" && contract && account) {
      checkVerifierRole()
    }
  }, [activeTab, contract, account, checkVerifierRole])

  const handleCreateEvent = async (e) => {
    e.preventDefault()
    if (!contract) return
    if (!eventName || !eventDate) {
      alert("Please fill in event name and date.")
      return
    }

    setActionLoading(true)
    setStatus(null)

    try {
      const dateTimestamp = Math.floor(new Date(eventDate).getTime() / 1000)
      const tierNames = [tier1Name, tier2Name]
      const prices = [
        ethers.parseEther(tier1Price),
        ethers.parseEther(tier2Price)
      ]
      const maxSupplies = [
        BigInt(tier1MaxSupply),
        BigInt(tier2MaxSupply)
      ]
      const resaleCapPercent = BigInt(resaleCap)
      const royaltyPercent = BigInt(royalty)

      const tx = await contract.createEvent(
        eventName,
        dateTimestamp,
        tierNames,
        prices,
        maxSupplies,
        resaleCapPercent,
        royaltyPercent
      )

      setStatus({ type: "info", text: "Transaction submitted! Waiting for confirmation..." })
      await tx.wait()

      setStatus({ type: "success", text: `Event "${eventName}" created successfully!` })
      setEventName("")
      setEventDate("")
      await refreshData()
    } catch (err) {
      console.error("Error creating event:", err)
      let errMsg = err.reason || err.message
      if (err.code === "ACTION_REJECTED") {
        errMsg = "Transaction was rejected in MetaMask."
      } else if (err.message.includes("OwnableUnauthorizedAccount")) {
        errMsg = "Only the contract owner is authorized to create events."
      }
      setStatus({ type: "error", text: "Transaction failed: " + errMsg })
    } finally {
      setActionLoading(false)
    }
  }

  const handleBuyTicket = async (eventId, tierIndex, price, userMintCount) => {
    if (!contract) {
      alert("Please connect your wallet first.")
      return
    }

    if (userMintCount >= 4) {
      alert("Purchase Limit Exceeded: You can buy a maximum of 4 tickets per event per wallet.")
      return
    }

    setActionLoading(true)
    setStatus(null)

    try {
      const tx = await contract.mintTicket(eventId, tierIndex, {
        value: ethers.parseEther(price)
      })

      setStatus({ type: "info", text: "Minting ticket... waiting for blockchain confirmation..." })
      await tx.wait()

      setStatus({ type: "success", text: "Ticket minted successfully!" })
      await refreshData()
    } catch (err) {
      console.error("Error minting ticket:", err)
      let errMsg = err.reason || err.message
      if (err.code === "ACTION_REJECTED") {
        errMsg = "Transaction was rejected in MetaMask."
      } else if (err.message.includes("insufficient funds")) {
        errMsg = "Insufficient funds in wallet to complete this purchase."
      }
      setStatus({ type: "error", text: "Minting failed: " + errMsg })
    } finally {
      setActionLoading(false)
    }
  }

  const openResaleModal = (tokenId, originalPrice, resaleCapPercent) => {
    const max = (Number(originalPrice) * resaleCapPercent) / 100
    setResaleModalTokenId(tokenId)
    setResaleModalMaxPrice(max.toFixed(4))
    setResaleInputPrice(max.toFixed(4))
  }

  const handleListForResale = async (e) => {
    e.preventDefault()
    if (!contract || !resaleModalTokenId) return

    if (Number(resaleInputPrice) > Number(resaleModalMaxPrice)) {
      alert(`Invalid Resale Price: Price exceeds the event's resale cap of ${resaleModalMaxPrice} ETH.`)
      return
    }

    setActionLoading(true)
    setStatus(null)
    setResaleModalTokenId(null)

    try {
      const tx = await contract.listForResale(
        resaleModalTokenId,
        ethers.parseEther(resaleInputPrice)
      )

      setStatus({ type: "info", text: "Listing ticket for resale..." })
      await tx.wait()

      setStatus({ type: "success", text: `Ticket #${resaleModalTokenId} successfully listed for ${resaleInputPrice} ETH!` })
      await refreshData()
    } catch (err) {
      console.error("Error listing resale:", err)
      let errMsg = err.reason || err.message
      if (err.code === "ACTION_REJECTED") {
        errMsg = "Transaction was rejected in MetaMask."
      }
      setStatus({ type: "error", text: "Listing failed: " + errMsg })
    } finally {
      setActionLoading(false)
    }
  }

  const handleCancelResale = async (tokenId) => {
    if (!contract) return
    setActionLoading(true)
    setStatus(null)

    try {
      const tx = await contract.cancelResaleListing(tokenId)
      setStatus({ type: "info", text: "Canceling resale listing..." })
      await tx.wait()

      setStatus({ type: "success", text: `Resale listing for Ticket #${tokenId} has been canceled.` })
      await refreshData()
    } catch (err) {
      console.error("Error canceling resale:", err)
      let errMsg = err.reason || err.message
      if (err.code === "ACTION_REJECTED") {
        errMsg = "Transaction was rejected in MetaMask."
      }
      setStatus({ type: "error", text: "Cancellation failed: " + errMsg })
    } finally {
      setActionLoading(false)
    }
  }

  const handleBuyResale = async (tokenId, price) => {
    if (!contract) {
      alert("Please connect your wallet first.")
      return
    }
    setActionLoading(true)
    setStatus(null)

    try {
      const tx = await contract.buyResale(tokenId, {
        value: ethers.parseEther(price)
      })

      setStatus({ type: "info", text: "Buying resale ticket... waiting for confirmation..." })
      await tx.wait()

      setStatus({ type: "success", text: `Successfully purchased resale Ticket #${tokenId} for ${price} ETH!` })
      await refreshData()
    } catch (err) {
      console.error("Error buying resale:", err)
      let errMsg = err.reason || err.message
      if (err.code === "ACTION_REJECTED") {
        errMsg = "Transaction was rejected in MetaMask."
      } else if (err.message.includes("insufficient funds")) {
        errMsg = "Insufficient funds in wallet to complete this purchase."
      }
      setStatus({ type: "error", text: "Purchase failed: " + errMsg })
    } finally {
      setActionLoading(false)
    }
  }

  const verifyTokenById = async (tokenId) => {
    if (!Number.isSafeInteger(tokenId) || tokenId < 1) {
      setScanError("Please enter a valid numeric Ticket ID.")
      return
    }

    if (actionLoading) return
    setScanError(null)
    setActionLoading(true)

    try {
      const isValid = await contract.isValidForEvent(tokenId)

      if (!isValid) {
        try {
          const details = await contract.getTicketDetails(tokenId)
          if (details.used) {
            setScanResult({ status: 'used', tokenId })
          } else {
            setScanResult({ status: 'invalid', message: `Ticket #${tokenId} has invalid details or event has passed.` })
          }
        } catch {
          setScanResult({ status: 'invalid', message: `Ticket #${tokenId} does not exist on blockchain.` })
        }
        return
      }

      const details = await contract.getTicketDetails(tokenId)
      const eventId = Number(details.eventId)
      const tier = Number(details.tier)

      const eventMeta = await contract.events(eventId)
      const tierInfo = await contract.getEventTiers(eventId)

      setScanResult({
        status: 'valid',
        tokenId,
        eventName: eventMeta.name,
        tierName: tierInfo.tierNames[tier] || `Tier #${tier}`
      })

    } catch (err) {
      console.error("Verification processing error:", err)
      setScanError("Failed to verify ticket: " + (err.reason || err.message))
    } finally {
      setActionLoading(false)
    }
  }

  const handleScan = async (detectedCodes) => {
    if (!detectedCodes || detectedCodes.length === 0 || actionLoading || scanResult) return

    const rawData = detectedCodes[0].rawValue
    try {
      // Strict: must be a TRUSTIX QR for THIS contract with a valid token id
      const tokenId = parseTicketQr(rawData, CONTRACT_ADDRESS)
      await verifyTokenById(tokenId)
    } catch (err) {
      setScanError("Invalid QR code: " + err.message)
    }
  }

  const handleManualVerifySubmit = async (e) => {
    e.preventDefault()
    if (!manualTokenInput.trim()) return
    try {
      const tokenId = parseManualTicketInput(manualTokenInput, CONTRACT_ADDRESS)
      await verifyTokenById(tokenId)
    } catch (err) {
      setScanError(err.message)
    }
  }

  const handleMarkAsUsed = async (tokenId) => {
    if (!contract) return
    setActionLoading(true)
    setStatus(null)

    try {
      const tx = await contract.markAsUsed(tokenId)
      setStatus({ type: "info", text: "Submitting check-in transaction..." })
      await tx.wait()

      setStatus({ type: "success", text: `Ticket #${tokenId} successfully checked in!` })
      setScanResult(prev => prev ? { ...prev, status: 'checked_in' } : null)
    } catch (err) {
      console.error("Error checking in ticket:", err)
      let errMsg = err.reason || err.message
      if (err.code === "ACTION_REJECTED") {
        errMsg = "Transaction was rejected in MetaMask."
      }
      setStatus({ type: "error", text: "Check-in failed: " + errMsg })
    } finally {
      setActionLoading(false)
    }
  }

  const resetScanner = () => {
    setScanResult(null)
    setScanError(null)
    setStatus(null)
  }

  const handleAddVerifier = async () => {
    if (!contract || !verifierInputAddress) return
    const targetAddress = verifierInputAddress.trim()
    if (!ethers.isAddress(targetAddress)) {
      alert("Please enter a valid Ethereum address.")
      return
    }
    setActionLoading(true)
    setStatus(null)
    try {
      const tx = await contract.addVerifier(targetAddress)
      setStatus({ type: "info", text: "Adding verifier... waiting for confirmation..." })
      await tx.wait()
      setStatus({ type: "success", text: `Verifier ${targetAddress} successfully added!` })
      setVerifierInputAddress("")
    } catch (err) {
      console.error("Error adding verifier:", err)
      let errMsg = err.reason || err.shortMessage || err.message
      if (err.code === "ACTION_REJECTED") {
        errMsg = "Transaction was rejected in MetaMask."
      }
      setStatus({ type: "error", text: "Failed to add verifier: " + errMsg })
    } finally {
      setActionLoading(false)
    }
  }

  const handleRemoveVerifier = async () => {
    if (!contract || !verifierInputAddress) return
    const targetAddress = verifierInputAddress.trim()
    if (!ethers.isAddress(targetAddress)) {
      alert("Please enter a valid Ethereum address.")
      return
    }
    if (contractOwner && targetAddress.toLowerCase() === contractOwner.toLowerCase()) {
      setStatus({
        type: "error",
        text: "Cannot remove organizer as verifier: The event organizer is a permanent verifier."
      })
      return
    }
    setActionLoading(true)
    setStatus(null)
    try {
      const tx = await contract.removeVerifier(targetAddress)
      setStatus({ type: "info", text: "Removing verifier... waiting for confirmation..." })
      await tx.wait()
      setStatus({ type: "success", text: `Verifier ${targetAddress} successfully removed!` })
      setVerifierInputAddress("")
    } catch (err) {
      console.error("Error removing verifier:", err)
      let errMsg = err.reason || err.shortMessage || err.message
      if (err.code === "ACTION_REJECTED") {
        errMsg = "Transaction was rejected in MetaMask."
      } else if (errMsg && (errMsg.includes("Cannot remove organizer as verifier") || errMsg.includes("Cannot remove organizer"))) {
        errMsg = "The event organizer is a permanent verifier and cannot be removed."
      }
      setStatus({ type: "error", text: "Failed to remove verifier: " + errMsg })
    } finally {
      setActionLoading(false)
    }
  }

  const handleFormSubmit = async (e) => {
    e.preventDefault()
    if (!account) {
      await connectWallet()
      return
    }
    if (!contract) {
      await switchNetwork()
      return
    }
    await handleCreateEvent(e)
  }

  if (!selectedRole) {
    return (
      <RoleLanding
        account={account}
        contract={contract}
        contractOwner={contractOwner}
        connectWallet={connectWallet}
        onSwitchAccount={requestAccountChange}
        onSelectRole={(role) => {
          setSelectedRole(role);
          if (role === 'attendee') setActiveTab('browse');
          else if (role === 'organizer') setActiveTab('organizer');
          else if (role === 'verifier') setActiveTab('verify');
        }}
        isConnecting={loading}
      />
    )
  }

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '1.5rem', minHeight: '100vh', position: 'relative', zIndex: 10 }}>
      {/* Header */}
      <header className="app-header glass-panel" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem' }}>
        <div className="app-title-group">
          <div className="app-icon">T</div>
          <div>
            <h2 className="brand-logo-text">
              TRUST<span className="brand-accent">IX</span>
            </h2>
            <span className="brand-tagline">Secure Web3 Ticketing</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        {account && contract && selectedRole && (
          <div className="nav-tabs">
            {selectedRole === 'attendee' && (
              <>
                <button
                  className={`nav-tab ${activeTab === 'browse' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('browse'); resetScanner(); }}
                >
                  Browse Events
                </button>
                <button
                  className={`nav-tab ${activeTab === 'tickets' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('tickets'); resetScanner(); }}
                >
                  My Tickets
                </button>
              </>
            )}
            {selectedRole === 'organizer' && (
              <button
                className={`nav-tab ${activeTab === 'organizer' ? 'active' : ''}`}
                onClick={() => { setActiveTab('organizer'); resetScanner(); }}
              >
                Organizer Dashboard
              </button>
            )}
            {selectedRole === 'verifier' && (
              <button
                className={`nav-tab ${activeTab === 'verify' ? 'active' : ''}`}
                onClick={() => { setActiveTab('verify'); resetScanner(); }}
              >
                Verify Passes
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {selectedRole && (
            <button
              className="btn-connect"
              onClick={() => setSelectedRole(null)}
              style={{
                background: 'rgba(255,255,255,0.05)',
                color: '#94a3b8',
                boxShadow: 'none',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '0.4rem 1.25rem',
                fontSize: '0.8rem',
                marginRight: '0.5rem'
              }}
            >
              ⇄ Switch Role
            </button>
          )}
          {account ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                Connected: <span className="accent-text">{account.substring(0, 6)}...{account.substring(account.length - 4)}</span>
              </span>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: contract ? '#10b981' : '#ef4444' }}></div>
            </div>
          ) : (
            <button className="btn-connect" onClick={connectWallet} disabled={loading}>
              {loading ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      {/* Global Status Banner */}
      {status && (
        <div className={`status-msg ${status.type === 'success' ? 'status-success' : status.type === 'error' ? 'status-error' : 'status-success'}`} style={{ borderColor: status.type === 'info' ? '#818cf8' : undefined, color: status.type === 'info' ? '#e0e7ff' : undefined, background: status.type === 'info' ? 'rgba(99,102,241,0.1)' : undefined, marginBottom: '1.5rem' }}>
          {status.text}
        </div>
      )}

      {/* Main Content Area */}
      {account && !contract ? (
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', textAlign: 'center' }}>
          <h2 style={{ color: '#f87171', marginBottom: '0.5rem' }}>Wrong Network Detected</h2>
          <p style={{ color: '#64748b', maxWidth: '400px', marginBottom: '1.5rem', fontSize: '0.95rem' }}>Your wallet is currently connected to an unsupported network. Please switch to Sepolia Testnet to proceed.</p>
          <button className="btn-connect" onClick={switchNetwork}>Switch to Sepolia Network</button>
        </div>
      ) : (
        /* Tabs Render */
        <>
          {/* TAB 1: BROWSE EVENTS & RESALE MARKETPLACE */}
          {activeTab === 'browse' && selectedRole === 'attendee' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div>
                  <h2 style={{ margin: 0 }}>On-Chain Events</h2>
                  <p style={{ color: '#64748b', margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>Browse active events and mint secure ticket passes.</p>
                </div>
                <button className="btn-connect" onClick={refreshData} style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8', boxShadow: 'none', padding: '0.5rem 1rem', fontSize: '0.85rem' }} disabled={loading}>
                  {loading ? "Refreshing..." : "↻ Refresh List"}
                </button>
              </div>

              {events.length === 0 ? (
                <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', borderStyle: 'dashed' }}>
                  <span style={{ color: '#64748b' }}>No events are currently scheduled. Check back later!</span>
                </div>
              ) : (
                <div className="event-grid">
                  {events.map((event) => (
                    <div key={event.id} className="event-card glass-panel" style={{ background: 'rgba(20, 26, 40, 0.4)' }}>
                      <div className="event-header">
                        <div>
                          <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{event.name}</h3>
                          <div className="event-date">📅 {event.date}</div>
                        </div>
                        <span style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontSize: '0.75rem', fontWeight: 'bold', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                          ID: #{event.id}
                        </span>
                      </div>
                      <div className="event-meta">
                        <div>🔄 Resale Cap: {event.resaleCapPercent}%</div>
                        <div>💰 Creator Royalty: {event.royaltyPercent}%</div>
                        <div className="buy-badge-limit">Limit: {event.userMintCount}/4</div>
                      </div>

                      <div className="tier-badge-container" style={{ marginTop: '1rem' }}>
                        {event.tiers.map((tier, idx) => {
                          const isSoldOut = tier.mintedSupply >= tier.maxSupply
                          const isLimitReached = event.userMintCount >= 4
                          return (
                            <div key={idx} className="tier-item" style={{ padding: '0.75rem 1rem', alignItems: 'center' }}>
                              <div>
                                <span className="tier-name" style={{ fontSize: '0.95rem' }}>{tier.name}</span>
                                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.15rem' }}>
                                  Supply: {tier.mintedSupply}/{tier.maxSupply}
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <span style={{ fontWeight: 'bold', color: '#e2e8f0' }}>{tier.price} ETH</span>
                                <button
                                  className="btn-connect"
                                  onClick={() => handleBuyTicket(event.id, idx, tier.price, event.userMintCount)}
                                  disabled={actionLoading || isSoldOut || isLimitReached}
                                  style={{
                                    padding: '0.4rem 0.85rem',
                                    fontSize: '0.8rem',
                                    background: isSoldOut ? '#27272a' : isLimitReached ? '#3f3f46' : undefined,
                                    boxShadow: (isSoldOut || isLimitReached) ? 'none' : undefined,
                                    cursor: (isSoldOut || isLimitReached) ? 'not-allowed' : 'pointer'
                                  }}
                                >
                                  {isSoldOut ? "Sold Out" : isLimitReached ? "Limit Hit" : "Buy Ticket"}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* SECONDARY RESALE MARKETPLACE */}
              <div style={{ marginTop: '3rem' }}>
                <h2>Secondary Resale Marketplace</h2>
                <p style={{ color: '#64748b', margin: '0.25rem 0 1.5rem 0', fontSize: '0.9rem' }}>Buy authentic tickets resold directly by other verified ticket holders.</p>

                {resaleMarket.length === 0 ? (
                  <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', borderStyle: 'dashed' }}>
                    <span style={{ color: '#64748b' }}>No tickets are currently listed for resale.</span>
                  </div>
                ) : (
                  <div className="event-grid">
                    {resaleMarket.map((ticket) => {
                      const isSellerSelf = ticket.resaleSeller.toLowerCase() === account.toLowerCase()
                      return (
                        <div key={ticket.tokenId} className="event-card glass-panel" style={{ background: 'rgba(245, 158, 11, 0.02)', borderColor: 'rgba(245, 158, 11, 0.15)' }}>
                          <div className="event-header">
                            <div>
                              <h3 style={{ margin: 0, fontSize: '1.15rem' }}>{ticket.eventName}</h3>
                              <span style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: '500' }}>
                                {ticket.tierName} Ticket #{ticket.tokenId}
                              </span>
                            </div>
                            <span className="badge badge-listed">Listed</span>
                          </div>

                          <div style={{ marginTop: '1rem', background: 'rgba(15,23,42,0.4)', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                              <span style={{ color: '#64748b' }}>Seller:</span>
                              <span className="accent-text">
                                {isSellerSelf ? "You (Self)" : `${ticket.resaleSeller.substring(0, 6)}...${ticket.resaleSeller.substring(ticket.resaleSeller.length - 4)}`}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.4rem' }}>
                              <span style={{ color: '#64748b' }}>Original Price:</span>
                              <span>{ticket.originalPrice} ETH</span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem' }}>
                            <div>
                              <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block' }}>Resale Price:</span>
                              <strong style={{ fontSize: '1.2rem', color: '#f59e0b' }}>{ticket.resalePrice} ETH</strong>
                            </div>

                            {isSellerSelf ? (
                              <button
                                className="btn-connect"
                                onClick={() => handleCancelResale(ticket.tokenId)}
                                disabled={actionLoading}
                                style={{ background: '#ef4444', color: 'white', padding: '0.5rem 1rem', fontSize: '0.85rem', boxShadow: 'none' }}
                              >
                                Cancel Listing
                              </button>
                            ) : (
                              <button
                                className="btn-connect"
                                onClick={() => handleBuyResale(ticket.tokenId, ticket.resalePrice)}
                                disabled={actionLoading}
                                style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: 'white', padding: '0.5rem 1rem', fontSize: '0.85rem', boxShadow: '0 4px 12px rgba(245,158,11,0.2)' }}
                              >
                                Buy Resale Ticket
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: MY TICKETS WALLET */}
          {activeTab === 'tickets' && selectedRole === 'attendee' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div>
                  <h2 style={{ margin: 0 }}>My Ticket Pass Wallet</h2>
                  <p style={{ color: '#64748b', margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>Securely store and list your verified event NFT ticket passes.</p>
                </div>
                <button className="btn-connect" onClick={refreshData} style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8', boxShadow: 'none', padding: '0.5rem 1rem', fontSize: '0.85rem' }} disabled={loading}>
                  {loading ? "Refreshing..." : "↻ Refresh Wallet"}
                </button>
              </div>

              {myTickets.length === 0 ? (
                <div className="glass-panel" style={{ padding: '4rem', textAlign: 'center', borderStyle: 'dashed' }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', color: '#94a3b8' }}>Wallet is empty</h3>
                  <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>You do not own any event tickets. Browse events to purchase a ticket pass!</p>
                </div>
              ) : (
                <div className="ticket-grid">
                  {myTickets.map((ticket) => {
                    const qrPayload = JSON.stringify({
                      contractAddress: CONTRACT_ADDRESS,
                      tokenId: ticket.tokenId
                    })

                    return (
                      <div key={ticket.tokenId} className="ticket-card">
                        <div style={{ position: 'absolute', left: '-10px', top: '50%', transform: 'translateY(-50%)', width: '20px', height: '20px', borderRadius: '50%', background: '#080c14', borderRight: '1px solid rgba(255,255,255,0.05)' }}></div>
                        <div style={{ position: 'absolute', right: '-10px', top: '50%', transform: 'translateY(-50%)', width: '20px', height: '20px', borderRadius: '50%', background: '#080c14', borderLeft: '1px solid rgba(255,255,255,0.05)' }}></div>

                        <div className="ticket-body">
                          <div className="ticket-info">
                            <span className="badge badge-active" style={{ background: ticket.used ? 'rgba(148,163,184,0.1)' : ticket.isListed ? 'rgba(245,158,11,0.1)' : undefined, color: ticket.used ? '#94a3b8' : ticket.isListed ? '#f59e0b' : undefined, borderColor: ticket.used ? 'rgba(148,163,184,0.2)' : ticket.isListed ? 'rgba(245,158,11,0.2)' : undefined, marginBottom: '0.75rem' }}>
                              {ticket.used ? "Used / Checked-in" : ticket.isListed ? "Resale Listed" : "Active Ticket"}
                            </span>

                            <h3 style={{ fontSize: '1.2rem', marginBottom: '0.25rem', letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>
                              {ticket.eventName}
                            </h3>
                            <span style={{ fontSize: '0.8rem', color: '#818cf8', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>
                              {ticket.tierName} • ID #{ticket.tokenId}
                            </span>

                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                              {ticket.used ? (
                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Pass Inactive</span>
                              ) : ticket.isListed ? (
                                <div style={{ width: '100%' }}>
                                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Price: {ticket.resalePrice} ETH</div>
                                  <button
                                    className="btn-connect"
                                    onClick={() => handleCancelResale(ticket.tokenId)}
                                    disabled={actionLoading}
                                    style={{ background: '#ef4444', color: 'white', padding: '0.35rem 0.75rem', fontSize: '0.75rem', boxShadow: 'none' }}
                                  >
                                    Cancel Listing
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="btn-connect"
                                  onClick={() => openResaleModal(ticket.tokenId, ticket.originalPrice, ticket.resaleCapPercent)}
                                  disabled={actionLoading}
                                  style={{ background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.1)', padding: '0.35rem 0.75rem', fontSize: '0.75rem', boxShadow: 'none' }}
                                >
                                  List for Resale
                                </button>
                              )}
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                            <div className="qr-container" style={{ opacity: ticket.used ? 0.3 : 1 }}>
                              <QRCodeCanvas
                                value={qrPayload}
                                size={90}
                                level={"M"}
                                fgColor={"#080c14"}
                              />
                            </div>
                            <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 'bold' }}>SCAN PASS</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ORGANIZER DASHBOARD */}
          {activeTab === 'organizer' && selectedRole === 'organizer' && (
            <div className="dashboard-grid">
              {/* Left Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* Create Event Form */}
                <section className="form-section glass-panel">
                  <h2>Create New Event</h2>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '-0.5rem', marginBottom: '1.5rem' }}>
                    Note: Event creation is restricted to the smart contract owner.
                  </p>

                  <form onSubmit={handleFormSubmit}>
                    <div className="form-group">
                      <label>Event Name</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="e.g., Blockchain Summit 2026"
                        value={eventName}
                        onChange={(e) => setEventName(e.target.value)}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Event Date & Time</label>
                      <input
                        type="datetime-local"
                        className="form-control"
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        required
                      />
                    </div>

                    {/* Tier Headers */}
                    <div className="tier-headers">
                      <div>Tier Name</div>
                      <div>Price (ETH)</div>
                      <div>Supply</div>
                    </div>

                    {/* Tier 1 */}
                    <div className="tier-row">
                      <input
                        type="text"
                        className="form-control"
                        value={tier1Name}
                        onChange={(e) => setTier1Name(e.target.value)}
                        required
                      />
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        className="form-control"
                        value={tier1Price}
                        onChange={(e) => setTier1Price(e.target.value)}
                        required
                      />
                      <input
                        type="number"
                        min="1"
                        className="form-control"
                        value={tier1MaxSupply}
                        onChange={(e) => setTier1MaxSupply(e.target.value)}
                        required
                      />
                    </div>

                    {/* Tier 2 */}
                    <div className="tier-row">
                      <input
                        type="text"
                        className="form-control"
                        value={tier2Name}
                        onChange={(e) => setTier2Name(e.target.value)}
                        required
                      />
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        className="form-control"
                        value={tier2Price}
                        onChange={(e) => setTier2Price(e.target.value)}
                        required
                      />
                      <input
                        type="number"
                        min="1"
                        className="form-control"
                        value={tier2MaxSupply}
                        onChange={(e) => setTier2MaxSupply(e.target.value)}
                        required
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.25rem' }}>
                      <div className="form-group">
                        <label>Resale Cap (%)</label>
                        <input
                          type="number"
                          min="100"
                          className="form-control"
                          value={resaleCap}
                          onChange={(e) => setResaleCap(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Creator Royalty (%)</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          className="form-control"
                          value={royalty}
                          onChange={(e) => setRoyalty(e.target.value)}
                          required
                        />
                      </div>
                    </div>

                    <button type="submit" className="btn-primary" disabled={actionLoading}>
                      {actionLoading ? (
                        <>
                          <span className="spinner"></span>
                          Processing Transaction...
                        </>
                      ) : (
                        "Create Event"
                      )}
                    </button>
                  </form>
                </section>

                {/* Verifier Management (only visible to owner) */}
                {account.toLowerCase() === contractOwner.toLowerCase() && (() => {
                  const isOrganizerInput = Boolean(
                    contractOwner &&
                    verifierInputAddress.trim() &&
                    verifierInputAddress.trim().toLowerCase() === contractOwner.toLowerCase()
                  )
                  return (
                    <section className="form-section glass-panel">
                      <h2>Verifier Management</h2>
                      <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '-0.5rem', marginBottom: '1.25rem' }}>
                        Add or remove authorized wallet addresses that can verify ticket entries.
                      </p>

                      {/* Organizer Permanent Verifier Status */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.85rem 1rem',
                          background: 'rgba(16, 185, 129, 0.08)',
                          border: '1px solid rgba(16, 185, 129, 0.25)',
                          borderRadius: '10px',
                          marginBottom: '1.25rem',
                          flexWrap: 'wrap',
                          gap: '0.5rem',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 'bold',
                              color: '#10b981',
                              letterSpacing: '0.05em',
                              textTransform: 'uppercase',
                              marginBottom: '0.25rem',
                            }}
                          >
                            Organizer · Permanent Verifier
                          </div>
                          <div
                            style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: '0.82rem',
                              color: '#e2e8f0',
                              wordBreak: 'break-all',
                            }}
                          >
                            {contractOwner}
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: '600',
                            background: 'rgba(16, 185, 129, 0.2)',
                            color: '#34d399',
                            padding: '0.25rem 0.6rem',
                            borderRadius: '6px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Permanent Verifier
                        </span>
                      </div>

                      <div className="form-group">
                        <label>Verifier Address</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="e.g. 0x..."
                          value={verifierInputAddress}
                          onChange={(e) => setVerifierInputAddress(e.target.value)}
                        />
                      </div>

                      {isOrganizerInput && (
                        <p style={{ fontSize: '0.82rem', color: '#f59e0b', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                          ⚠️ The event organizer is a permanent verifier and cannot be removed.
                        </p>
                      )}

                      <div style={{ display: 'flex', gap: '1rem' }}>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={handleAddVerifier}
                          disabled={actionLoading}
                          style={{ flex: 1, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: 'none' }}
                        >
                          Add Verifier
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={handleRemoveVerifier}
                          disabled={actionLoading || isOrganizerInput}
                          title={isOrganizerInput ? "The event organizer is a permanent verifier and cannot be removed." : "Remove verifier"}
                          style={{
                            flex: 1,
                            background: isOrganizerInput ? 'rgba(239, 68, 68, 0.35)' : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                            boxShadow: 'none',
                            cursor: isOrganizerInput ? 'not-allowed' : 'pointer',
                            opacity: isOrganizerInput ? 0.6 : 1,
                          }}
                        >
                          Remove Verifier
                        </button>
                      </div>
                    </section>
                  )
                })()}
              </div>

              {/* Right Column: Events List */}
              <section className="list-section glass-panel">
                <h2>Created Events</h2>
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '-0.5rem', marginBottom: '1.5rem' }}>
                  List of all events configured on-chain for the smart contract.
                </p>

                {events.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '12px' }}>
                    <span style={{ color: '#64748b', fontSize: '0.9rem' }}>No events created yet.</span>
                  </div>
                ) : (
                  <div className="events-container">
                    {events.map((event) => (
                      <div key={event.id} className="event-card">
                        <div className="event-header">
                          <div>
                            <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.1rem' }}>{event.name}</h3>
                            <div className="event-date">📅 {event.date}</div>
                          </div>
                          <span style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontSize: '0.75rem', fontWeight: 'bold', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                            ID: #{event.id}
                          </span>
                        </div>
                        <div className="event-meta">
                          <div>🔄 Resale Cap: {event.resaleCapPercent}%</div>
                          <div>💰 Royalty: {event.royaltyPercent}%</div>
                        </div>
                        <div className="tier-badge-container">
                          {event.tiers.map((tier, idx) => (
                            <div key={idx} className="tier-item">
                              <span className="tier-name">{tier.name}</span>
                              <span className="tier-details">
                                <strong>{tier.price} ETH</strong> | Supply: {tier.mintedSupply}/{tier.maxSupply}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB 4: ENTRY VERIFICATION */}
          {activeTab === 'verify' && selectedRole === 'verifier' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h2 style={{ margin: 0 }}>Entry Verification</h2>
                  <p style={{ color: '#64748b', margin: '0.25rem 0 0 0', fontSize: '0.9rem' }}>
                    Scan ticket QR codes or enter Ticket Token ID to verify passes and admit attendees.
                  </p>
                </div>

                {/* Verification Mode Switcher */}
                <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.04)', padding: '4px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <button
                    onClick={() => { setVerifyMode("manual"); resetScanner(); }}
                    style={{
                      padding: '0.45rem 1rem',
                      borderRadius: '8px',
                      border: 'none',
                      fontSize: '0.82rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      background: verifyMode === 'manual' ? '#00eefc' : 'transparent',
                      color: verifyMode === 'manual' ? '#00363a' : '#94a3b8',
                      boxShadow: verifyMode === 'manual' ? '0 0 12px rgba(0,238,252,0.4)' : 'none'
                    }}
                  >
                    ⌨ Manual Ticket ID
                  </button>
                  <button
                    onClick={() => { setVerifyMode("camera"); resetScanner(); }}
                    style={{
                      padding: '0.45rem 1rem',
                      borderRadius: '8px',
                      border: 'none',
                      fontSize: '0.82rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      background: verifyMode === 'camera' ? '#00eefc' : 'transparent',
                      color: verifyMode === 'camera' ? '#00363a' : '#94a3b8',
                      boxShadow: verifyMode === 'camera' ? '0 0 12px rgba(0,238,252,0.4)' : 'none'
                    }}
                  >
                    📷 Camera Scanner
                  </button>
                </div>
              </div>

              {isVerifierAuthorized === null ? (
                <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
                  <span className="spinner"></span> Checking gate staff authorization...
                </div>
              ) : !isVerifierAuthorized ? (
                <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
                  <h3 style={{ color: '#ef4444', margin: '0 0 0.5rem 0' }}>Access Denied</h3>
                  <p style={{ color: '#94a3b8', margin: 0 }}>
                    Your connected wallet address is not registered as an authorized verifier for this contract.
                  </p>
                </div>
              ) : (
                <div style={{ maxWidth: '480px', margin: '0 auto' }}>
                  {!scanResult && !scanError ? (
                    <div>
                      {verifyMode === 'camera' ? (
                        <div className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center' }}>
                          <h3 style={{ marginBottom: '0.5rem' }}>Camera Active</h3>
                          <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '1rem' }}>
                            Point camera at ticket QR code. If camera is not connecting, switch to Manual ID entry.
                          </p>
                          <div style={{ borderRadius: '12px', overflow: 'hidden', border: '2px solid rgba(0,238,252,0.3)', background: '#000', position: 'relative', minHeight: '280px' }}>
                            <Scanner
                              constraints={{
                                facingMode: { ideal: "environment" },
                                width: { ideal: 1280 },
                                height: { ideal: 720 },
                              }}
                              onScan={handleScan}
                              onError={(err) => {
                                console.error("Camera error:", err)
                                const message =
                                  err instanceof Error
                                    ? err.message
                                    : typeof err === "string"
                                      ? err
                                      : JSON.stringify(err)
                                setScanError(
                                  "Camera connection issue: " +
                                    (message || "Camera could not start. Check browser permissions and close other apps using the camera.")
                                )
                              }}
                            />
                          </div>
                          <button
                            onClick={() => setVerifyMode("manual")}
                            style={{
                              marginTop: '1rem',
                              background: 'rgba(255,255,255,0.05)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              color: '#94a3b8',
                              padding: '0.5rem 1rem',
                              borderRadius: '10px',
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              width: '100%'
                            }}
                          >
                            Camera not connecting? Switch to Manual ID
                          </button>
                        </div>
                      ) : (
                        <div className="glass-panel" style={{ padding: '2rem' }}>
                          <h3 style={{ marginBottom: '0.5rem', textAlign: 'center' }}>Manual Pass Verification</h3>
                          <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1.5rem', textAlign: 'center' }}>
                            Enter the attendee's Ticket Token ID or paste QR payload.
                          </p>
                          <form onSubmit={handleManualVerifySubmit}>
                            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                              <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.5rem' }}>
                                Ticket Token ID / QR Data
                              </label>
                              <input
                                type="text"
                                className="form-control"
                                placeholder="e.g. 0, 1, 2 or full QR json"
                                value={manualTokenInput}
                                onChange={(e) => setManualTokenInput(e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '0.75rem 1rem',
                                  background: 'rgba(15, 23, 42, 0.6)',
                                  border: '1px solid rgba(255,255,255,0.15)',
                                  borderRadius: '10px',
                                  color: '#fff',
                                  fontSize: '0.95rem',
                                  fontFamily: "'JetBrains Mono', monospace"
                                }}
                                required
                              />
                            </div>
                            <button
                              type="submit"
                              className="btn-primary"
                              disabled={actionLoading || !manualTokenInput.trim()}
                              style={{
                                width: '100%',
                                padding: '0.85rem',
                                background: 'linear-gradient(to right, #7df4ff, #00eefc, #00c5d2)',
                                color: '#00363a',
                                fontWeight: 'bold',
                                border: 'none',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                boxShadow: '0 4px 18px rgba(0,238,252,0.35)'
                              }}
                            >
                              {actionLoading ? "Verifying on blockchain..." : "Verify & Check-in Ticket"}
                            </button>
                          </form>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
                      {scanResult?.status === 'valid' && (
                        <div>
                          <div style={{ fontSize: '4rem', color: '#10b981', lineHeight: 1 }}>✓</div>
                          <h2 style={{ color: '#10b981', marginTop: '1rem' }}>Valid Ticket — Admit</h2>
                          <div style={{ background: 'rgba(15, 23, 42, 0.4)', padding: '1.25rem', borderRadius: '12px', margin: '1.5rem 0', textAlign: 'left', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>{scanResult.eventName}</div>
                            <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>Tier: {scanResult.tierName}</div>
                            <div style={{ fontSize: '0.9rem', color: '#64748b' }}>Token ID: #{scanResult.tokenId}</div>
                          </div>
                          <button
                            className="btn-primary"
                            onClick={() => handleMarkAsUsed(scanResult.tokenId)}
                            disabled={actionLoading}
                            style={{ width: '100%', padding: '0.85rem', background: '#10b981', color: 'white', fontWeight: 'bold', border: 'none', borderRadius: '10px', cursor: 'pointer' }}
                          >
                            {actionLoading ? "Processing check-in..." : "Confirm & Mark as Used"}
                          </button>
                        </div>
                      )}

                      {scanResult?.status === 'checked_in' && (
                        <div>
                          <div style={{ fontSize: '4rem', color: '#3b82f6', lineHeight: 1 }}>✓</div>
                          <h2 style={{ color: '#3b82f6', marginTop: '1rem' }}>Checked In</h2>
                          <p style={{ color: '#94a3b8', margin: '1rem 0 1.5rem 0' }}>Ticket #{scanResult.tokenId} has been successfully validated and marked used.</p>
                          <button className="btn-primary" onClick={resetScanner} style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', cursor: 'pointer' }}>Verify Next Ticket</button>
                        </div>
                      )}

                      {scanResult?.status === 'used' && (
                        <div>
                          <div style={{ fontSize: '4rem', color: '#ef4444', lineHeight: 1 }}>✗</div>
                          <h2 style={{ color: '#ef4444', marginTop: '1rem' }}>Already Checked In</h2>
                          <p style={{ color: '#94a3b8', margin: '1rem 0 1.5rem 0' }}>This ticket (Token ID #{scanResult.tokenId}) has already been used for entry.</p>
                          <button className="btn-primary" onClick={resetScanner} style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', cursor: 'pointer' }}>Verify Next Ticket</button>
                        </div>
                      )}

                      {scanResult?.status === 'invalid' && (
                        <div>
                          <div style={{ fontSize: '4rem', color: '#ef4444', lineHeight: 1 }}>✗</div>
                          <h2 style={{ color: '#ef4444', marginTop: '1rem' }}>Invalid Ticket</h2>
                          <p style={{ color: '#94a3b8', margin: '1rem 0 1.5rem 0' }}>{scanResult.message}</p>
                          <button className="btn-primary" onClick={resetScanner} style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', cursor: 'pointer' }}>Try Next Ticket</button>
                        </div>
                      )}

                      {scanError && (
                        <div>
                          <div style={{ fontSize: '4rem', color: '#ef4444', lineHeight: 1 }}>⚠</div>
                          <h2 style={{ color: '#ef4444', marginTop: '1rem' }}>Verification Notice</h2>
                          <p style={{ color: '#f87171', margin: '1rem 0 1.5rem 0' }}>{scanError}</p>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn-primary" onClick={() => { setVerifyMode("manual"); resetScanner(); }} style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', cursor: 'pointer' }}>
                              Use Manual ID
                            </button>
                            <button className="btn-connect" onClick={resetScanner} style={{ flex: 1, padding: '0.75rem', borderRadius: '10px', cursor: 'pointer' }}>
                              Retry
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Resale Price Listing Modal */}
      {resaleModalTokenId && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ background: '#0f172a' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>List Ticket #{resaleModalTokenId} for Resale</h2>
            <p style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Set a price in ETH. The secondary price cap for this event is <span className="accent-text" style={{ fontWeight: 'bold' }}>{resaleModalMaxPrice} ETH</span>.
            </p>

            <form onSubmit={handleListForResale}>
              <div className="form-group">
                <label>Resale Price (ETH)</label>
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  max={resaleModalMaxPrice}
                  className="form-control"
                  value={resaleInputPrice}
                  onChange={(e) => setResaleInputPrice(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button
                  type="button"
                  className="btn-connect"
                  onClick={() => setResaleModalTokenId(null)}
                  style={{ flex: 1, background: 'rgba(255,255,255,0.05)', color: '#94a3b8', boxShadow: 'none' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ flex: 2, padding: '0.7rem 1rem' }}
                >
                  Confirm List
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App;
