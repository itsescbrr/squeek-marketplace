const fs = require('fs');
const path = require('path');
const solc = require('solc');
const { ethers } = require('ethers');
const ganache = require('ganache');

(async () => {
  const src = {
    'MockSqueekNFT.sol': { content: fs.readFileSync(path.join(__dirname, '../contracts/mocks/MockSqueekNFT.sol'), 'utf8') },
    'SqueekMarketplace.sol': { content: fs.readFileSync(path.join(__dirname, '../contracts/SqueekMarketplace.sol'), 'utf8') },
  };
  const input = { language: 'Solidity', sources: src, settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const mk = out.contracts['MockSqueekNFT.sol']['MockSqueekNFT'];
  const mp = out.contracts['SqueekMarketplace.sol']['SqueekMarketplace'];

  const gprov = ganache.provider({ logging: { quiet: true }, wallet: { mnemonic: 'test test test test test test test test test test test junk', totalAccounts: 5 } });
  const eth = new ethers.BrowserProvider(gprov);
  const accounts = await eth.send('eth_accounts', []);
  const seller = await eth.getSigner(accounts[0]);
  const buyer = await eth.getSigner(accounts[1]);
  const royalty = await eth.getSigner(accounts[2]);

  const mkF = new ethers.ContractFactory(mk.abi, '0x' + mk.evm.bytecode.object, seller);
  const mock = await mkF.deploy(royalty.address, 500);
  await mock.waitForDeployment();
  const mpF = new ethers.ContractFactory(mp.abi, '0x' + mp.evm.bytecode.object, seller);
  const market = await mpF.deploy(await mock.getAddress());
  await market.waitForDeployment();
  const maddr = await market.getAddress();

  await (await mock.mint(seller.address, 1)).wait();
  await (await mock.setApprovalForAll(maddr, true)).wait();

  const ri = await mock.royaltyInfo(1, ethers.parseEther('1'));
  console.log('royaltyInfo(1, 1 ETH) = receiver:', ri[0], 'amount:', ethers.formatEther(ri[1]), 'ETH');
  console.log('expected royalty addr:', royalty.address);

  await (await market.list(1, ethers.parseEther('1'))).wait();

  const before = {};
  for (const [n, a] of [['market', maddr], ['seller', seller.address], ['royalty', royalty.address], ['buyer', buyer.address]]) {
    before[n] = await eth.getBalance(a);
    console.log('before', n, '=', ethers.formatEther(before[n]), 'ETH');
  }

  await (await market.connect(buyer).buy(1, { value: ethers.parseEther('1') })).wait();

  console.log('--- after buy ---');
  for (const [n, a] of [['market', maddr], ['seller', seller.address], ['royalty', royalty.address], ['buyer', buyer.address]]) {
    const af = await eth.getBalance(a);
    const delta = af - before[n];
    console.log('after', n, '=', ethers.formatEther(af), 'ETH | delta', ethers.formatEther(delta), 'ETH');
  }
  process.exit(0);
})().catch((e) => { console.error('DBG ERR:', e.shortMessage || e); process.exit(1); });