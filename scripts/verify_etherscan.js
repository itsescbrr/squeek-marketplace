// Verify SqueekMarketplace on Etherscan Sepolia via the Etherscan V2 API.
// Reads ETHERSCAN_API_KEY from the environment (never hardcoded/committed).
const fs = require('fs');
const path = require('path');

const ADDR = '0xC36acc24A588d244247825045f48F00B9D379dAD';
const KEY = process.env.ETHERSCAN_API_KEY;
const src = fs.readFileSync(path.join(__dirname, '../contracts/SqueekMarketplace.sol'), 'utf8');

async function main() {
  if (!KEY) { console.error('no ETHERSCAN_API_KEY in env'); process.exit(1); }
  // V2: chainid + module + action in the URL query; the rest in the form body.
  const url = 'https://api.etherscan.io/v2/api?chainid=11155111&module=contract&action=verifysourcecode';
  const body = new URLSearchParams({
    apikey: KEY,
    contractaddress: ADDR,
    sourceCode: src,
    codeformat: 'solidity-single-file',
    contractname: 'SqueekMarketplace',
    compilerversion: 'v0.8.24+commit.e11b9ed9',
    optimizationUsed: '1',
    runs: '200',
    evmVersion: 'shanghai',
    licenseType: '3',
  });
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j = await r.json();
  console.log('submit:', JSON.stringify(j));
  if (String(j.status) === '1') {
    const guid = j.result;
    console.log('GUID:', guid);
    for (let i = 0; i < 20; i++) {
      await new Promise((res) => setTimeout(res, 6000));
      const cr = await fetch(`https://api.etherscan.io/v2/api?chainid=11155111&module=contract&action=checkverifystatus&guid=${guid}&apikey=${KEY}`);
      const cj = await cr.json();
      const st = cj.result || '';
      console.log(`poll ${i + 1}: ${st}`);
      if (st.includes('Pass') || st.includes('Fail')) break;
    }
  }
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });