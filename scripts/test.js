const fs = require('fs');
const path = require('path');
const solc = require('solc');
const { ethers } = require('ethers');
const ganache = require('ganache');

async function main() {
  const src = {
    'MockSqueekNFT.sol': { content: fs.readFileSync(path.join(__dirname, '../contracts/mocks/MockSqueekNFT.sol'), 'utf8') },
    'SqueekMarketplace.sol': { content: fs.readFileSync(path.join(__dirname, '../contracts/SqueekMarketplace.sol'), 'utf8') },
  };
  const input = {
    language: 'Solidity',
    sources: src,
    settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }, optimizer: { enabled: true, runs: 200 } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const mk = out.contracts['MockSqueekNFT.sol']['MockSqueekNFT'];
  const mp = out.contracts['SqueekMarketplace.sol']['SqueekMarketplace'];
  if (!mk || !mp) { console.error('compile errors'); process.exit(1); }

  const gprov = ganache.provider({ logging: { quiet: true }, wallet: { mnemonic: 'test test test test test test test test test test test junk', totalAccounts: 5 } });
  const eth = new ethers.BrowserProvider(gprov);
  const accounts = await eth.send('eth_accounts', []);
  const seller = await eth.getSigner(accounts[0]);
  const buyer = await eth.getSigner(accounts[1]);
  const royalty = await eth.getSigner(accounts[2]);

  let pass = 0, fail = 0;
  const ok = (c, n) => { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n); } };
  const reverts = async (p, n) => {
    try {
      const tx = await p;
      await tx.wait();
      fail++; console.log('  FAIL (no revert)', n);
    }
    catch { pass++; console.log('  PASS (reverts)', n); }
  };

  const mockF = new ethers.ContractFactory(mk.abi, '0x' + mk.evm.bytecode.object, seller);
  const mock = await mockF.deploy(royalty.address, 500);
  await mock.waitForDeployment();
  const mockAddr = await mock.getAddress();

  // a second collection that is NOT allowlisted (negative test)
  const rogue = await (await mockF.deploy(royalty.address, 500)).waitForDeployment();
  const rogueAddr = await rogue.getAddress();

  const mpF = new ethers.ContractFactory(mp.abi, '0x' + mp.evm.bytecode.object, seller);
  const market = await mpF.deploy();
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();

  await (await market.addCollection(mockAddr)).wait();

  for (const t of [1, 2, 3, 4, 5, 6, 7, 8]) await (await mock.mint(seller.address, t)).wait();
  await (await mock.setApprovalForAll(marketAddr, true)).wait();

  const E = (n) => ethers.parseEther(n);
  const now = (s) => Math.floor(Date.now() / 1000) + s;
  const bal = async (a) => BigInt(await eth.send('eth_getBalance', [a, 'latest']));
  const o = async (t) => (await mock.ownerOf(t)).toLowerCase();
  const key = (nft, tokenId) => ethers.keccak256(ethers.solidityPacked(['address', 'uint256'], [nft, tokenId]));

  console.log('--- happy paths ---');
  await (await market.list(mockAddr, 1, E('1'))).wait();
  ok((await o(1)) === marketAddr.toLowerCase(), 'list escrows NFT');
  ok((await market.listedCount()) === 1n, 'listedCount 1');
  const [nfts0, ids0] = await market.listedKeys();
  ok(nfts0[0].toLowerCase() === mockAddr.toLowerCase() && ids0[0] === 1n, 'listedKeys returns (nft, tokenId)');
  const s0 = await bal(seller.address), r0 = await bal(royalty.address);
  await (await market.connect(buyer).buy(mockAddr, 1, { value: E('1') })).wait();
  const roy = E('1') * 500n / 10000n;
  ok((await o(1)) === buyer.address.toLowerCase(), 'buy moves NFT to buyer');
  ok((await bal(royalty.address)) - r0 === roy, 'buy pays 5% royalty');
  ok((await bal(seller.address)) - s0 === E('1') - roy, 'buy pays seller 95%');

  await (await market.list(mockAddr, 2, E('2'))).wait();
  await (await market.cancel(mockAddr, 2)).wait();
  ok((await o(2)) === seller.address.toLowerCase(), 'cancel returns NFT');

  const mkBal0 = await bal(marketAddr);
  await (await market.connect(buyer).makeOffer(mockAddr, 3, now(3600), { value: E('0.5') })).wait();
  ok((await market.getOffer(mockAddr, 3)).active === true, 'offer active');
  ok((await bal(marketAddr)) - mkBal0 === E('0.5'), 'offer escrows ETH');
  const r1 = await bal(royalty.address);
  await (await market.acceptOffer(mockAddr, 3, buyer.address)).wait();
  const roff = E('0.5') * 500n / 10000n;
  ok((await o(3)) === buyer.address.toLowerCase(), 'accept moves NFT to offerer');
  ok((await bal(royalty.address)) - r1 === roff, 'accept pays 5% royalty');

  await (await market.connect(buyer).makeOffer(mockAddr, 4, now(3600), { value: E('0.2') })).wait();
  await (await market.connect(buyer).cancelOffer(mockAddr, 4)).wait();
  ok((await market.getOffer(mockAddr, 4)).active === false, 'cancelOffer deactivates');

  console.log('--- allowlist ---');
  await (await rogue.mint(seller.address, 77)).wait();
  await (await rogue.setApprovalForAll(marketAddr, true)).wait();
  await reverts(market.list(rogueAddr, 77, E('1')), 'list non-allowlisted collection reverts');

  console.log('--- adversarial ---');
  await reverts(market.connect(buyer).list(mockAddr, 5, E('1')), 'list by non-owner');
  await (await market.list(mockAddr, 5, E('1'))).wait();
  await reverts(market.list(mockAddr, 5, E('1')), 'duplicate list');
  await reverts(market.list(mockAddr, 6, 0), 'list price 0');
  await reverts(market.connect(buyer).buy(mockAddr, 5, { value: E('0.5') }), 'buy wrong value');
  await reverts(market.buy(mockAddr, 5, { value: E('1') }), 'buy own listing');
  await market.cancel(mockAddr, 5);
  await reverts(market.connect(buyer).buy(mockAddr, 99, { value: E('1') }), 'buy non-listed');
  await reverts(market.connect(buyer).cancel(mockAddr, 6), 'cancel non-seller');
  await reverts(market.connect(buyer).makeOffer(mockAddr, 6, now(3600), { value: 0 }), 'offer value 0');
  await reverts(market.connect(buyer).makeOffer(mockAddr, 6, now(-10), { value: E('0.1') }), 'offer past expiry');
  await (await market.connect(buyer).makeOffer(mockAddr, 6, now(3600), { value: E('0.1') })).wait();
  await reverts(market.connect(royalty).makeOffer(mockAddr, 6, now(3600), { value: E('0.2') }), 'offer over active');
  await reverts(market.acceptOffer(mockAddr, 6, royalty.address), 'accept wrong offerer');
  await reverts(market.connect(royalty).acceptOffer(mockAddr, 6, buyer.address), 'accept non-owner');
  await reverts(market.connect(royalty).cancelOffer(mockAddr, 6), 'cancelOffer non-offerer');
  await (await market.connect(buyer).makeOffer(mockAddr, 7, now(120), { value: E('0.1') })).wait();
  await eth.send('evm_increaseTime', [240]);
  await eth.send('evm_mine', []);
  await reverts(market.acceptOffer(mockAddr, 7, buyer.address), 'accept expired offer');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('TEST ERR:', e.shortMessage || e); process.exit(1); });