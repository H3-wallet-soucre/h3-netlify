// Netlify function - handles all API routes
// Uses Netlify Blobs for persistent storage

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

var API_KEYS = {
  etherscan: process.env.ETHERSCAN_KEY || 'ZZ3YPRCAKFFX37R8P9B258MZWCNXMGAE2X',
  changenow: process.env.CHANGENOW_KEY || 'e3c6b3c6fadade49f5b646d8b547b164c4bbc09ee1430211a0485eb6d3edd4ba'
};

var CHAIN_EXPLORER = {
  ethereum: { url: 'https://api.etherscan.io', chainid: '1' },
  bnb: { url: 'https://api.bscscan.com', chainid: '56' },
  polygon: { url: 'https://api.polygonscan.com', chainid: '137' },
  arbitrum: { url: 'https://api.arbiscan.io', chainid: '42161' },
  optimism: { url: 'https://api-optimistic.etherscan.io', chainid: '10' },
  avalanche: { url: 'https://api.snowtrace.io', chainid: '43114' },
  base: { url: 'https://api.basescan.org', chainid: '8453' }
};
var CHAIN_RPC = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  bnb: 'https://bsc-dataseed.binance.org/',
  polygon: 'https://polygon-rpc.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  optimism: 'https://mainnet.optimism.io',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
  base: 'https://mainnet.base.org'
};

async function getFees(store) {
  var stored = await store.get('fee_config', { type: 'json' });
  if (stored) return stored;
  var defaults = {
    "ethereum": {"e":0,"sw":0,"fh":1,"fm":1,"eg":2.99},
    "bnb": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0.79},
    "tron": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0.99},
    "solana": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0.79},
    "bitcoin": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0},
    "xrp": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0},
    "litecoin": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0},
    "polygon": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0.79},
    "arbitrum": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0.79},
    "optimism": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0.79},
    "avalanche": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0.79},
    "base": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0.79}
  };
  await store.setJSON('fee_config', defaults);
  return defaults;
}

async function getMessages(store) {
  var stored = await store.get('support_messages', { type: 'json' });
  return stored || [];
}

async function handleRequest(req, url, path, store) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // Health check
  if (path === '/health') {
    return jsonResponse({ status: 'ok', version: '3.0.0', platform: 'netlify' });
  }

  // Fee config (persistent)
  if (path === '/fee_config.json') {
    var fees = await getFees(store);
    return jsonResponse(fees);
  }

  // Save fees (admin) - persistent
  if (path === '/save-fees' && req.method === 'POST') {
    try {
      var fees = await req.json();
      await store.setJSON('fee_config', fees);
      return jsonResponse({ success: true });
    } catch(e) { return jsonResponse({ success: false, error: 'Invalid data' }, 400); }
  }

  // Support contact form - persistent
  if (path === '/support' && req.method === 'POST') {
    try {
      var data = await req.json();
      var msg = {
        name: (data.name || '').substring(0, 100),
        email: (data.email || '').substring(0, 200),
        message: (data.message || '').substring(0, 2000),
        timestamp: Date.now()
      };
      var msgs = await getMessages(store);
      msgs.push(msg);
      await store.setJSON('support_messages', msgs);
      return jsonResponse({ success: true });
    } catch(e) { return jsonResponse({ success: false, error: 'Invalid data' }, 400); }
  }

  // Get support messages (admin) - persistent
  if (path === '/support-messages') {
    var msgs = await getMessages(store);
    return jsonResponse(msgs);
  }

  // Prices (CoinGecko)
  if (path === '/prices') {
    try {
      var resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,tron,polygon,matic-network,avalanche-2,optimism,litecoin,ripple,base,usd-coin,tether&vs_currencies=usd', {
        headers: { 'Accept': 'application/json', 'User-Agent': 'H3-Wallet/1.0' }
      });
      return new Response(await resp.text(), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30' } });
    } catch(e) { return jsonResponse({ error: 'Price fetch failed' }, 500); }
  }

  // Explorer (EVM balance)
  if (path === '/explorer') {
    var chain = url.searchParams.get('chain');
    var action = url.searchParams.get('action');
    var address = url.searchParams.get('address');
    if (!chain || !address) return jsonResponse({ error: 'Missing params' }, 400);
    var rpcUrl = CHAIN_RPC[chain];
    if (!rpcUrl) return jsonResponse({ error: 'Unsupported chain' }, 400);
    if (action === 'balance') {
      var rpcResp = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }) });
      var rpcData = await rpcResp.json();
      return jsonResponse({ status: '1', message: 'OK', result: rpcData.result });
    }
    return jsonResponse({ error: 'Action not supported' }, 400);
  }

  // Token balance (EVM)
  if (path === '/token-balance') {
    var chain = url.searchParams.get('chain');
    var address = url.searchParams.get('address');
    var contract = url.searchParams.get('contract');
    if (!chain || !address || !contract) return jsonResponse({ error: 'Missing params' }, 400);
    var rpcUrl = CHAIN_RPC[chain];
    if (!rpcUrl) return jsonResponse({ error: 'Unsupported chain' }, 400);
    var paddedAddr = address.toLowerCase().replace('0x', '').padStart(64, '0');
    var callData = '0x70a08231' + paddedAddr;
    var rpcResp = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: contract, data: callData }, 'latest'], id: 1 }) });
    var rpcData = await rpcResp.json();
    var balHex = rpcData.result || '0x0';
    if (balHex && balHex !== '0x') {
      var tokenDecimals = 18;
      if (contract.toLowerCase() === '0xdac17f958d2ee523a2206206994597c13d831ec7') tokenDecimals = 6;
      if (contract.toLowerCase() === '0x55d398326f99059ff775485246999027b3197955') tokenDecimals = 18;
      return jsonResponse({ success: true, balance: parseInt(balHex, 16) / Math.pow(10, tokenDecimals) });
    }
    return jsonResponse({ success: false, balance: 0 });
  }

  // Gas price
  if (path === '/gas') {
    var chain = url.searchParams.get('chain');
    var rpc = CHAIN_RPC[chain];
    if (!rpc) return jsonResponse({ error: 'Unsupported chain' }, 400);
    var resp = await fetch(rpc, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] })
    });
    var d = await resp.json();
    return jsonResponse({ success: true, gasPrice: d.result ? parseInt(d.result, 16) / 1e9 : 0 });
  }

  // Solana balance
  if (path === '/solana-balance') {
    var address = url.searchParams.get('address');
    if (!address) return jsonResponse({ error: 'Missing address' }, 400);
    try {
      var resp = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] })
      });
      var d = await resp.json();
      return jsonResponse({ success: true, balance: (d.result && d.result.value) ? d.result.value / 1e9 : 0 });
    } catch(e) { return jsonResponse({ success: false, balance: 0 }); }
  }

  // SPL balances
  if (path === '/spl-balances') {
    var address = url.searchParams.get('address');
    if (!address) return jsonResponse({ error: 'Missing address' }, 400);
    try {
      var resp = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [address, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }] })
      });
      var d = await resp.json();
      var tokens = [];
      if (d.result && d.result.value) {
        d.result.value.forEach(function(t) { tokens.push({ mint: t.account.data.parsed.info.mint, balance: t.account.data.parsed.info.tokenAmount.uiAmount }); });
      }
      return jsonResponse({ success: true, tokens: tokens });
    } catch(e) { return jsonResponse({ success: false, tokens: [] }); }
  }

  // Litecoin balance
  if (path === '/litecoin-balance') {
    var address = url.searchParams.get('address');
    try {
      var resp = await fetch('https://litecoinspace.org/api/address/' + address + '/utxo');
      var utxos = await resp.json();
      return jsonResponse({ success: true, balance: utxos.reduce(function(s,u){return s+u.value},0) / 1e8 });
    } catch(e) { return jsonResponse({ success: false, balance: 0 }); }
  }

  // XRP balance
  if (path === '/xrp-balance') {
    var address = url.searchParams.get('address');
    try {
      var resp = await fetch('https://xrplcluster.com', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'account_info', params: [{ account: address, ledger_index: 'validated' }] })
      });
      var d = await resp.json();
      return jsonResponse({ success: true, balance: d.result && d.result.account_data ? parseFloat(d.result.account_data.Balance) / 1e6 : 0 });
    } catch(e) { return jsonResponse({ success: false, balance: 0 }); }
  }

  // Delegate TRX to Energy (admin)
  if (path === '/delegate-trx-energy' && req.method === 'POST') {
    try {
      var TronWeb = (await import('tronweb')).default;
      var pk = process.env.TRON_PRIVATE_KEY;
      if (!pk) return jsonResponse({ error: 'No TRON private key configured' }, 500);
      var tw = new TronWeb({ fullHost: 'https://api.trongrid.io', privateKey: pk });
      var addr = tw.address.fromPrivateKey(pk);
      var balance = await tw.trx.getBalance(addr);
      var balanceTrx = Math.floor(balance / 1e6);
      // Keep 100 TRX for fees, delegate the rest
      var toDelegate = Math.max(0, balanceTrx - 100);
      if (toDelegate < 1) return jsonResponse({ error: 'Not enough TRX. Balance: ' + balanceTrx + ' TRX (min 101 needed)' });
      var result = await tw.transactionBuilder.freezeBalanceV2(toDelegate * 1e6, 'ENERGY', addr);
      var signed = await tw.trx.sign(result, pk);
      var broadcast = await tw.trx.sendRawTransaction(signed);
      return jsonResponse({ success: true, delegated: toDelegate + ' TRX', txid: broadcast.txid, balance: balanceTrx });
    } catch(e) { return jsonResponse({ error: 'Delegation failed: ' + e.message }, 500); }
  }

  // Get TRX balance + energy info (admin)
  if (path === '/tron-relayer-info') {
    try {
      var TronWeb2 = (await import('tronweb')).default;
      var pk2 = process.env.TRON_PRIVATE_KEY;
      if (!pk2) return jsonResponse({ error: 'No TRON private key' }, 500);
      var tw2 = new TronWeb2({ fullHost: 'https://api.trongrid.io' });
      var addr2 = tw2.address.fromPrivateKey(pk2);
      var bal = await tw2.trx.getBalance(addr2);
      var resources = await tw2.trx.getAccountResources(addr2);
      return jsonResponse({
        address: addr2,
        balanceTrx: Math.floor(bal / 1e6),
        energyLimit: resources.EnergyLimit || 0,
        energyUsed: resources.EnergyUsed || 0,
        netLimit: resources.NetLimit || 0
      });
    } catch(e) { return jsonResponse({ error: e.message }, 500); }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

export default async function handler(req, context) {
  var url = new URL(req.url);
  var path = url.pathname.replace(/^\/api/, '') || '/';
  var store = context.platformContext?.blobs?.defaultStore;
  return await handleRequest(req, url, path, store);
}

export const config = { path: "/api/*" };
