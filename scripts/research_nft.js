const fs = require('fs');
const { ethers } = require('../node_modules/ethers');

const env = fs.readFileSync(process.env.HOME + '/.escobar/.env', 'utf8');
const get = (k) => { const m = env.match(new RegExp('^'+k+'=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null; };

const NFT = '0xC4C7982657f00509548F3a3a41db7FA439a6856B';

const candidates = (() => {
  const eth = get('RPC_URL_ETHEREUM');
  const key = eth ? eth.split('g.alchemy.com/v2/')[1] : null;
  const sepolia = key ? `https://eth-sepolia.g.alchemy.com/v2/${key}` : null;
  return [sepolia, get('RPC_URL_SEPOLIA')].filter(Boolean);
})();

(async () => {
  let provider = null;
  for (const url of candidates) {
    try {
      const p = new ethers.JsonRpcProvider(url);
      const net = await p.getNetwork();
      const id = Number(net.chainId);
      const label = id===11155111?'SEPOLIA':id===1?'MAINNET':id===8453?'BASE':'other';
      console.log(`RPC chainId=${id} (${label})`);
      if (id === 11155111) { provider = p; break; }
    } catch(e) { console.log('rpc fail:', e.shortMessage || e.message); }
  }
  if (!provider) { console.log('NO SEPOLIA RPC FOUND'); process.exit(1); }

  const nft = new ethers.Contract(NFT, [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function totalSupply() view returns (uint256)',
    'function ownerOf(uint256) view returns (address)',
    'function tokenURI(uint256) view returns (string)',
    'function supportsInterface(bytes4) view returns (bool)',
    'function royaltyInfo(uint256,uint256) view returns (address,uint256)',
  ], provider);

  console.log('name:', await nft.name());
  console.log('symbol:', await nft.symbol());
  console.log('totalSupply:', (await nft.totalSupply()).toString());

  const EIP2981 = '0x2a55205a';
  let supports2981 = false;
  try { supports2981 = await nft.supportsInterface(EIP2981); } catch(e) { supports2981 = false; }
  console.log('supportsInterface(EIP-2981 royalty):', supports2981);

  try {
    const [recv, amt] = await nft.royaltyInfo(1, ethers.parseEther('1'));
    console.log('royaltyInfo(1, 1 ETH) -> receiver', recv, '| amount', amt.toString(), `(${ethers.formatEther(amt)} ETH)`);
  } catch(e) { console.log('royaltyInfo reverts:', e.shortMessage || e.message); }

  try { console.log('tokenURI(1):', await nft.tokenURI(1)); } catch(e) { console.log('tokenURI(1) err:', e.shortMessage || e.message); }
  try { console.log('ownerOf(1):', await nft.ownerOf(1)); } catch(e) { console.log('ownerOf(1) err:', e.shortMessage || e.message); }
})();