// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal ERC-721 + EIP-2981 mock for local tests.
contract MockSqueekNFT {
    mapping(uint256 => address) public _owner;
    mapping(uint256 => address) public _approved;
    mapping(address => mapping(address => bool)) public _operatorApprovals;
    address public royaltyReceiver;
    uint96 public royaltyBps;

    constructor(address _receiver, uint96 _bps) {
        royaltyReceiver = _receiver;
        royaltyBps = _bps;
    }

    function mint(address to, uint256 tokenId) external {
        require(_owner[tokenId] == address(0), "exists");
        _owner[tokenId] = to;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = _owner[tokenId];
        require(o != address(0), "nonexistent");
        return o;
    }

    function approve(address to, uint256 tokenId) external {
        require(_owner[tokenId] == msg.sender, "not owner");
        _approved[tokenId] = to;
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        address o = _owner[tokenId];
        require(o == from, "not owner");
        require(
            msg.sender == from || msg.sender == _approved[tokenId] || _operatorApprovals[from][msg.sender],
            "not approved"
        );
        _owner[tokenId] = to;
        delete _approved[tokenId];
    }

    function royaltyInfo(uint256, uint256 salePrice) external view returns (address receiver, uint256 amount) {
        return (royaltyReceiver, (salePrice * uint256(royaltyBps)) / 10000);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x2a55205a || id == 0x80ac58cd || id == 0x01ffc9a7;
    }
}