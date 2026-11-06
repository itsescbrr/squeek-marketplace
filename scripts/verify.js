// Verify the deployed SqueekMarketplace via Sourcify (no API key needed).
const solc = require('solc');
const fs = require('fs');
const path = require('path');

const ADDR = '0xC36acc24A588d244247825045f48F00B9D379dAD';
const CHAIN = '11155111';
const src = fs.readFileSync(path.join(__dirname, '../contracts/SqueekMarketplace.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'SqueekMarketplace.sol': { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const contract = output.contracts['SqueekMarketplace.sol']['SqueekMarketplace'];
const metadata = contract.metadata;
const deployed = '0x' + contract.evm.deployedBytecode.object;

console.log('compiler:', solc.version(), '| deployed bytecode bytes:', (deployed.length - 2) / 2);
if (output.errors) for (const e of output.errors) if (e.severity === 'error') console.error('ERR', e.formattedMessage);

(async () => {
  // Sourcify v2 verify: submit metadata + sources.
  const body = {
    address: ADDR,
    chain: CHAIN,
    stdJsonInput: input,
    metadata: JSON.parse(metadata),
    compilerVersion: '0.8.24+commit.e11b9ed9',
    contractIdentifier: 'SqueekMarketplace.sol:SqueekMarketplace',
  };
  try {
    const r = await fetch(`https://sourcify.dev/server/v2/verify/${CHAIN}/${ADDR}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const status = r.status;
    const text = await r.text();
    console.log('Sourcify HTTP', status);
    console.log('response:', text.slice(0, 2000));
  } catch (e) {
    console.error('fetch error:', e.message);
  }
})();