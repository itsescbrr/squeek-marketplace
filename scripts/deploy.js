const { decryptWallets, findWallet } = require('/home/ubuntu/.escobar/tools/wallet-loader');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const NFTA = '0xC4C7982657f00509548F3a3a41db7FA439a6856B';
const bytecode = fs.readFileSync(path.join(__dirname, '../build/SqueekMarketplace.bin'), 'utf8').trim();
const abi = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/SqueekMarketplace.abi.json'), 'utf8'));

async function main() {
  const key = process.env.RPC_URL_ETHEREUM.split('g.alchemy.com/v2/')[1];
  const rpcUrl = `https://eth-sepolia.g.alchemy.com/v2/${key}`;

  const w1 = findWallet(decryptWallets(), 'W1');
  const provider = new ethers.JsonRpcProvider(rpcUrl, 11155111);
  const signer = w1.wallet.connect(provider);

  const bal = await provider.getBalance(w1.address);
  console.log('deploy from:', w1.address, '| gas:', ethers.formatEther(bal), 'ETH');

  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const tx = await factory.deploy();
  console.log('deploy tx:', tx.deploymentTransaction().hash);
  const contract = await tx.waitForDeployment();
  const addr = await contract.getAddress();

  // allowlist the Squeek NFT collection
  const addTx = await contract.addCollection(NFTA);
  await addTx.wait();
  console.log('allowlisted:', NFTA);

  console.log('DEPLOYED_ADDRESS=' + addr);
  fs.writeFileSync(path.join(__dirname, '../build/deployed-address.txt'), addr + '\n');
  console.log('saved to build/deployed-address.txt');
}

main().catch((e) => { console.error('ERR:', e.shortMessage || e.message); process.exit(1); });