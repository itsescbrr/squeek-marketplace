// Squeek Market — chain + collection configuration.
// The marketplace is curated: only collections allowlisted on-chain (via CONFIG.MARKET)
// can be listed. CONFIG.COLLECTIONS drives the frontend directory + display names.
window.CONFIG = {
  CHAIN_ID: 11155111,
  CHAIN_HEX: '0xaa36a7',
  CHAIN_NAME: 'Sepolia',
  NATIVE: 'ETH',
  // read-only RPC (eth_call; injected wallet is authoritative for writes)
  RPC: 'https://ethereum-sepolia-rpc.publicnode.com',
  BLOCK_SCOUT_API: 'https://eth-sepolia.blockscout.com/api/v2',
  // curated marketplace contract (v3, multi-collection + on-chain allowlist)
  MARKET: '0xC36acc24A588d244247825045f48F00B9D379dAD',
  FEE_BPS: 0, // 0% marketplace fee
  // bounded indexing window (market v3 deploys from this block)
  MARKET_START_BLOCK: 12074000,
  // curated collection directory. Each entry needs `address` (must also be allowlisted
  // on-chain) + a display `name`. `api` marks the collection that has a project indexer.
  COLLECTIONS: [
    {
      address: '0xC4C7982657f00509548F3a3a41db7FA439a6856B',
      name: 'Squeek',
      short: 'Squeek',
      api: 'https://api.squeekchain.com',
      docs: 'https://docs.squeekchain.com/developers/nft/',
      maxTokenId: 8888,
      slug: 'squeek',
    },
  ],
  EXPLORER_TX: (h) => 'https://sepolia.etherscan.io/tx/' + h,
  EXPLORER_ADDR: (a) => 'https://sepolia.etherscan.io/address/' + a,
  EXPLORER_NFT: (nft, id) => 'https://sepolia.etherscan.io/nft/' + nft + '/' + id,
  // feedback form
  FEEDBACK_TYPES: [
    { id: 'bug', label: 'Bug Report', hint: 'error or broken feature' },
    { id: 'feature', label: 'Feature Request', hint: 'new feature ideas' },
    { id: 'uiux', label: 'UI/UX Feedback', hint: 'look and user experience' },
    { id: 'general', label: 'General Feedback', hint: 'criticism and suggestions' },
  ],
  FEEDBACK_URL: '/api/feedback', // same-origin serverless fn → Telegram bot
};

window.NFT_ABI = [
  'function ownerOf(uint256) view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function tokenURI(uint256) view returns (string)',
  'function royaltyInfo(uint256,uint256) view returns (address,uint256)',
  'function setApprovalForAll(address,bool)',
  'function isApprovedForAll(address,address) view returns (bool)',
  'function supportsInterface(bytes4) view returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

window.MARKET_ABI = [
  'function owner() view returns (address)',
  'function allowedCollections(address) view returns (bool)',
  'function collections() view returns (address[])',
  'function allowedCount() view returns (uint256)',
  'function addCollection(address)',
  'function removeCollection(address)',
  'function transferOwnership(address)',
  'function listings(bytes32) view returns (address nft, address seller, uint256 price, bool active)',
  'function offers(bytes32) view returns (address offerer, uint256 price, uint256 expiry, bool active)',
  'function list(address,uint256,uint256)',
  'function buy(address,uint256) payable',
  'function cancel(address,uint256)',
  'function makeOffer(address,uint256,uint256) payable',
  'function cancelOffer(address,uint256)',
  'function acceptOffer(address,uint256,address)',
  'function listedCount() view returns (uint256)',
  'function listedKeys() view returns (address[], uint256[])',
  'function getListing(address,uint256) view returns (address seller, uint256 price, bool active)',
  'function getOffer(address,uint256) view returns (address offerer, uint256 price, uint256 expiry, bool active)',
  'function getListings(address[],uint256[]) view returns (uint256[], address[], bool[])',
  'event CollectionAdded(address indexed nft)',
  'event CollectionRemoved(address indexed nft)',
  'event Listed(address indexed nft, address indexed seller, uint256 indexed tokenId, uint256 price)',
  'event Sold(address indexed nft, address indexed seller, address indexed buyer, uint256 tokenId, uint256 price, uint256 royalty, address royaltyReceiver)',
  'event Cancelled(address indexed nft, address indexed seller, uint256 indexed tokenId)',
  'event OfferMade(address indexed nft, address indexed offerer, uint256 indexed tokenId, uint256 price, uint256 expiry)',
  'event OfferCancelled(address indexed nft, address indexed offerer, uint256 indexed tokenId)',
  'event OfferAccepted(address indexed nft, address indexed seller, address indexed offerer, uint256 tokenId, uint256 price, uint256 royalty, address royaltyReceiver)',
];