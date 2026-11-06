const solc = require('solc');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../contracts/SqueekMarketplace.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'SqueekMarketplace.sol': { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors) {
  const errs = output.errors.filter(e => e.severity === 'error');
  if (errs.length) {
    console.error('COMPILE ERRORS:');
    for (const e of errs) console.error(' -', e.formattedMessage);
    process.exit(1);
  }
  const warns = output.errors.filter(e => e.severity === 'warning');
  if (warns.length) console.error('warnings:', warns.length);
}

const c = output.contracts['SqueekMarketplace.sol']['SqueekMarketplace'];
const abi = c.abi;
const bytecode = '0x' + c.evm.bytecode.object;

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'SqueekMarketplace.abi.json'), JSON.stringify(abi, null, 2));
fs.writeFileSync(path.join(outDir, 'SqueekMarketplace.bin'), bytecode);

console.log('COMPILED OK');
console.log('  ABI:', JSON.stringify(abi).length, 'chars');
console.log('  bytecode:', (bytecode.length - 2) / 2, 'bytes');
console.log('  functions:', abi.filter(x => x.type === 'function').map(f => f.name).join(', '));