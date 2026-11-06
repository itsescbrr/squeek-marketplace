// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC721 {
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

interface IERC2981 {
    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address receiver, uint256 amount);
}

/// @notice Curated escrow marketplace for the Squeekchain NFT ecosystem.
///         A collection must be allowlisted by the owner before its NFTs can be listed.
///         Fixed-price listings escrow the NFT; offers escrow ETH; atomic swap on settle.
///         0% marketplace fee; creator royalty honored via EIP-2981.
contract SqueekMarketplace {
    struct Listing {
        address nft;
        address seller;
        uint256 price;
        bool active;
    }

    struct Offer {
        address offerer;
        uint256 price;
        uint256 expiry;
        bool active;
    }

    struct Key {
        address nft;
        uint256 tokenId;
    }

    address public owner;

    // Allowlist: only these collections may be listed.
    mapping(address => bool) public allowedCollections;
    address[] private _collections;

    // Listings + offers, keyed by keccak256(nft, tokenId).
    mapping(bytes32 => Listing) public listings;
    mapping(bytes32 => Offer) public offers;

    // Enumerable listing keys so the UI can browse every active listing.
    Key[] private _listingKeys;
    mapping(bytes32 => uint256) private _listingIndex; // key -> index + 1

    event CollectionAdded(address indexed nft);
    event CollectionRemoved(address indexed nft);
    event Listed(address indexed nft, address indexed seller, uint256 indexed tokenId, uint256 price);
    event Sold(address indexed nft, address indexed seller, address indexed buyer, uint256 tokenId, uint256 price, uint256 royalty, address royaltyReceiver);
    event Cancelled(address indexed nft, address indexed seller, uint256 indexed tokenId);
    event OfferMade(address indexed nft, address indexed offerer, uint256 indexed tokenId, uint256 price, uint256 expiry);
    event OfferCancelled(address indexed nft, address indexed offerer, uint256 indexed tokenId);
    event OfferAccepted(address indexed nft, address indexed seller, address indexed offerer, uint256 tokenId, uint256 price, uint256 royalty, address royaltyReceiver);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    // ---------- Collection allowlist ----------

    function addCollection(address nft) external onlyOwner {
        require(nft != address(0), "zero nft");
        require(!allowedCollections[nft], "already allowed");
        allowedCollections[nft] = true;
        _collections.push(nft);
        emit CollectionAdded(nft);
    }

    function removeCollection(address nft) external onlyOwner {
        require(allowedCollections[nft], "not allowed");
        allowedCollections[nft] = false;
        emit CollectionRemoved(nft);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        owner = newOwner;
    }

    function collections() external view returns (address[] memory) {
        return _collections;
    }

    function allowedCount() external view returns (uint256) {
        return _collections.length;
    }

    // ---------- Listings ----------

    function list(address nft, uint256 tokenId, uint256 price) external {
        require(allowedCollections[nft], "not allowed");
        require(IERC721(nft).ownerOf(tokenId) == msg.sender, "not owner");
        require(price > 0, "price zero");
        bytes32 k = _key(nft, tokenId);
        require(!listings[k].active, "already listed");
        IERC721(nft).transferFrom(msg.sender, address(this), tokenId);
        listings[k] = Listing(nft, msg.sender, price, true);
        _pushKey(nft, tokenId);
        emit Listed(nft, msg.sender, tokenId, price);
    }

    function buy(address nft, uint256 tokenId) external payable nonReentrant {
        bytes32 k = _key(nft, tokenId);
        Listing storage l = listings[k];
        require(l.active, "not listed");
        require(msg.sender != l.seller, "cannot buy own");
        require(msg.value == l.price, "wrong value");
        l.active = false;
        _removeKey(k);

        (address rr, uint256 royalty) = _royalty(nft, tokenId, l.price);
        IERC721(nft).transferFrom(address(this), msg.sender, tokenId);
        _pay(l.seller, l.price - royalty);
        if (royalty > 0) _pay(rr, royalty);
        emit Sold(nft, l.seller, msg.sender, tokenId, l.price, royalty, rr);
    }

    function cancel(address nft, uint256 tokenId) external {
        bytes32 k = _key(nft, tokenId);
        Listing storage l = listings[k];
        require(l.active, "not listed");
        require(l.seller == msg.sender, "not seller");
        l.active = false;
        _removeKey(k);
        IERC721(nft).transferFrom(address(this), msg.sender, tokenId);
        emit Cancelled(nft, msg.sender, tokenId);
    }

    // ---------- Offers ----------

    function makeOffer(address nft, uint256 tokenId, uint256 expiry) external payable nonReentrant {
        require(allowedCollections[nft], "not allowed");
        require(msg.value > 0, "offer zero");
        require(expiry > block.timestamp, "expired");
        bytes32 k = _key(nft, tokenId);
        Offer storage o = offers[k];
        if (o.active) {
            require(o.expiry <= block.timestamp, "offer exists");
            uint256 owed = o.price;
            o.active = false;
            _pay(o.offerer, owed);
            emit OfferCancelled(nft, o.offerer, tokenId);
        }
        offers[k] = Offer(msg.sender, msg.value, expiry, true);
        emit OfferMade(nft, msg.sender, tokenId, msg.value, expiry);
    }

    function cancelOffer(address nft, uint256 tokenId) external nonReentrant {
        bytes32 k = _key(nft, tokenId);
        Offer storage o = offers[k];
        require(o.active, "no offer");
        require(o.offerer == msg.sender, "not offerer");
        o.active = false;
        _pay(msg.sender, o.price);
        emit OfferCancelled(nft, msg.sender, tokenId);
    }

    function acceptOffer(address nft, uint256 tokenId, address offerer) external nonReentrant {
        bytes32 k = _key(nft, tokenId);
        Offer storage o = offers[k];
        require(o.active, "no offer");
        require(o.offerer == offerer, "wrong offerer");
        require(o.expiry > block.timestamp, "offer expired");
        require(IERC721(nft).ownerOf(tokenId) == msg.sender, "not owner");
        o.active = false;

        (address rr, uint256 royalty) = _royalty(nft, tokenId, o.price);
        IERC721(nft).transferFrom(msg.sender, offerer, tokenId);
        _pay(msg.sender, o.price - royalty);
        if (royalty > 0) _pay(rr, royalty);
        emit OfferAccepted(nft, msg.sender, offerer, tokenId, o.price, royalty, rr);
    }

    // ---------- Views ----------

    function listedCount() external view returns (uint256) {
        return _listingKeys.length;
    }

    function listedKeys() external view returns (address[] memory nfts, uint256[] memory tokenIds) {
        uint256 n = _listingKeys.length;
        nfts = new address[](n);
        tokenIds = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            nfts[i] = _listingKeys[i].nft;
            tokenIds[i] = _listingKeys[i].tokenId;
        }
    }

    function getListing(address nft, uint256 tokenId)
        external
        view
        returns (address seller, uint256 price, bool active)
    {
        Listing storage l = listings[_key(nft, tokenId)];
        return (l.seller, l.price, l.active);
    }

    function getOffer(address nft, uint256 tokenId)
        external
        view
        returns (address offerer, uint256 price, uint256 expiry, bool active)
    {
        Offer storage o = offers[_key(nft, tokenId)];
        return (o.offerer, o.price, o.expiry, o.active);
    }

    function getListings(address[] calldata nfts, uint256[] calldata tokenIds)
        external
        view
        returns (uint256[] memory prices, address[] memory sellers, bool[] memory active)
    {
        uint256 n = nfts.length;
        require(n == tokenIds.length, "len");
        prices = new uint256[](n);
        sellers = new address[](n);
        active = new bool[](n);
        for (uint256 i = 0; i < n; i++) {
            Listing storage l = listings[_key(nfts[i], tokenIds[i])];
            prices[i] = l.price;
            sellers[i] = l.seller;
            active[i] = l.active;
        }
    }

    // ---------- Internal ----------

    function _key(address nft, uint256 tokenId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(nft, tokenId));
    }

    function _pushKey(address nft, uint256 tokenId) internal {
        bytes32 k = _key(nft, tokenId);
        _listingKeys.push(Key(nft, tokenId));
        _listingIndex[k] = _listingKeys.length; // 1-indexed
    }

    function _removeKey(bytes32 k) internal {
        uint256 idx = _listingIndex[k];
        if (idx == 0) return;
        uint256 last = _listingKeys.length - 1;
        if (idx - 1 != last) {
            Key memory moved = _listingKeys[last];
            _listingKeys[idx - 1] = moved;
            _listingIndex[_key(moved.nft, moved.tokenId)] = idx;
        }
        _listingKeys.pop();
        delete _listingIndex[k];
    }

    function _royalty(address nft, uint256 tokenId, uint256 salePrice) internal view returns (address receiver, uint256 amount) {
        try IERC2981(nft).royaltyInfo(tokenId, salePrice) returns (address recv, uint256 amt) {
            if (recv != address(0) && amt > 0) {
                if (amt > salePrice) amt = salePrice;
                return (recv, amt);
            }
        } catch {}
        return (address(0), 0);
    }

    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{ value: amount }("");
        require(ok, "pay failed");
    }

    bool private _locked;
}