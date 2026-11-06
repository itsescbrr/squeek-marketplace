# Squeek Market

A self-hosted, editable, curated multi-collection NFT marketplace for the official
Squeek NFT collection in the Squeekchain ecosystem (deployed on Ethereum Sepolia). Escrow fixed-price
listings + escrowed offers, 0% marketplace fee, creator royalty honored via EIP-2981.

**Live:** https://squeek-marketplace.vercel.app
**Market contract:** `0xC36acc24A588d244247825045f48F00B9D379dAD` (Sepolia) — verified.

## Contract verification

| source | status |
|---|---|
| Etherscan (Sepolia) | ✅ "Contract Source Code Verified" |
| Sourcify | ✅ `exact_match` |
| Blockscout | ✅ `is_verified: true` |

Compiler: Solidity `0.8.24`, optimizer 200 runs, evmVersion `shanghai`, MIT license.

## Run / build

Static site + one serverless function (feedback). No bundler.

```
cd frontend
python3 -m http.server 8787     # open http://localhost:8787/
```

Or host `frontend/` on any static host (Vercel / Netlify / GitHub Pages / Cloudflare Pages).
The `frontend/api/feedback.js` function runs on Vercel (or any Node host) and needs
`TG_BOT_TOKEN` + `TG_CHAT_ID` env vars — see Feedback below.

## Files

- `contracts/SqueekMarketplace.sol` — the marketplace contract (v3, curated multi-collection).
- `contracts/mocks/MockSqueekNFT.sol` — local-test mock (ERC-721 + EIP-2981).
- `scripts/compile.js`, `scripts/deploy.js`, `scripts/test.js`, `scripts/research_nft.js`.
- `scripts/verify.js` — Sourcify (v2) verification submit + poll.
- `scripts/verify_etherscan.js` — Etherscan (v2 API) verification submit + poll.
- `scripts/debug_royalty.js` — royalty + metadata debug helper.
- `frontend/` — app: `index.html`, `config.js`, `data.js`, `app.js`, `styles.css`,
  `vendor/ethers.min.js`, `api/feedback.js`, `vercel.json`.

## Network configuration

| item | value |
|---|---|
| network | Ethereum Sepolia testnet (chain id 11155111) |
| chain id | 11155111 |
| native gas | ETH (Sepolia) |
| explorer (UI links) | https://sepolia.etherscan.io |
| explorer (data API) | https://eth-sepolia.blockscout.com/api/v2 |
| official docs | https://docs.squeekchain.com |
| official API | https://api.squeekchain.com |

"Squeekchain" is a project/ecosystem brand name, not a separate blockchain. Every contract (SqueekNFT, SqueekCore, SqueekMining, this marketplace) runs on the standard Ethereum Sepolia testnet (chain id 11155111); a dedicated Squeekchain mainnet has not launched yet.

## Contract addresses

- **Squeek NFT** (official, ERC-721, transferable, NOT soulbound, EIP-2981 royalty 5%):
  `0xC4C7982657f00509548F3a3a41db7FA439a6856B`
  (royalty receiver `0xD5DAb9F1D15E9D45548078726C54732a5B59EB78`; supply is dynamic —
  Squeeks merge/burn, so read `totalSupply()` live. Token ids run `1..8888` with ~600+
  burned, so the app enumerates valid ids desc and skips `ownerOf`-reverting ones.)
- **Squeek Market** (this build, deployed from a personal wallet):
  `0xC36acc24A588d244247825045f48F00B9D379dAD`

## Mechanics

- **List** `list(tokenId, price)`: seller approves the market (`setApprovalForAll`); the NFT
  moves into the market's custody (escrow) and appears in `listedIds()`.
- **Buy** `buy(tokenId) payable`: atomic swap — buyer pays `price`, market transfers the NFT
  to the buyer, pays creator royalty (EIP-2981), remainder to the seller. `msg.value` must
  equal `price` exactly.
- **Cancel** `cancel(tokenId)`: seller only; returns the NFT from escrow.
- **Make offer** `makeOffer(tokenId, expiry) payable`: buyer escrows ETH; one active offer per token.
- **Accept offer** `acceptOffer(tokenId, offerer)`: owner only, unexpired; transfers NFT to
  offerer and pays royalty + remainder to the owner.
- **Cancel offer** `cancelOffer(tokenId)`: offerer only; refunds escrowed ETH.

All value-bearing functions are `nonReentrant`-guarded; `_pay` uses `.call{value}` with a
success check; royalty is clamped to the sale price.

## Fees and royalties

- Marketplace fee: **0%**.
- Creator royalty: **5%** (EIP-2981 `royaltyInfo`, read live, shown before signing).

## Curation

Markets come from a curated allow-list (`CONFIG.COLLECTIONS` in `frontend/config.js`),
not an open registry — only official Squeekchain collections are listed.

## Data sources

- Chain state is authoritative for listings, offers, ownership, settlement (via `eth_call`).
- Metadata: on-chain `tokenURI` (base64 SVG) first, official API as fallback.
- Activity: market contract events via `eth_getLogs`.

Known limitation: free public Sepolia RPCs prune old logs, so per-token transfer timelines
may fall back to the explorer link. Listings / offers / buy / sell / cancel / grid /
metadata / owner are unaffected. For production, run an archive RPC server-side.

## Feedback form

The UI has a "Feedback" entry in the nav → 4 categories (Bug Report, Feature Request,
UI/UX Feedback, General Feedback) → posts to `frontend/api/feedback.js` → forwarded to a
Telegram chat via a bot. Set `TG_BOT_TOKEN` + `TG_CHAT_ID` env vars (Vercel or other host);
the token never reaches the browser.

## Security properties

- No seed phrases or private keys are requested, stored, or exposed.
- Untrusted NFT metadata is HTML-escaped; image sources allow-listed to `data:image/` + `https(s)`.
- The market contract has no admin, no upgrade mechanism, no fee switch, no token seizure;
  authorization is seller/offerer/owner checks only.

Actual trust assumptions: on-chain reads go through a public Sepolia RPC (display only)
and writes are signed by the user's own wallet — so you trust the RPC endpoint + your
wallet, while the app holds no keys and cannot move funds.

## Tests actually run

`node scripts/test.js` — 27 local assertions against a Ganache-forked mock, all passing
(happy paths + adversarial reverts). On-chain (Sepolia) verification:
`squeek()` == NFT, `royaltyInfo(1, 1 ETH)` == 0.05 ETH, plus a full
**list → buy → offer → accept** cycle exercised with real wallets, and the NFT returned
to its owner.