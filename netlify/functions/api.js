// Netlify function - handles all API routes
// Adapted from Cloudflare Worker h3-api

// In-memory store (per cold start). For persistence, use Netlify KV or external DB.
let feesCache = null;
let supportMessages = [];

function getFees() {
  if (!feesCache) {
    feesCache = {
      "ethereum": {"e":0,"sw":0,"fh":1,"fm":1,"eg":2.99},
      "bnb": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0.79},
      "tron": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0.99},
      "solana": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0.79},
      "bitcoin": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0},
      "xrp": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0},
      "litecoin": {"e":0,"sw":0,"fh":1,"fm":1,"eg":0},
      "polygon": {"e":0,"sw":0,"fh":1,"fm":1,"eg":2.99},
      "arbitrum": {"e":0,"sw":0,"fh":1,"fm":1,"eg":2.99},
      "optimism": {"e":0,"sw":0,"fh":1,"fm":1,"eg":2.99},
      "avalanche": {"e":0,"sw":0,"fh":1,"fm":1,"eg":2.99},
      "base": {"e":0,"sw":0,"fh":1,"fm":1,"eg":2.99}
    };
  }
  return feesCache;
}

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

// EVM chain RPC mapping
var CHAIN_RPC = {
  ethereum: 'https://eth.llamarpc.com',
  bnb: 'https://bsc-dataseed.binance.org',
  polygon: 'https://polygon-rpc.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  optimism: 'https://mainnet.optimism.io',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
  base: 'https://mainnet.base.org'
};

var CHAIN_EXPLORER = {
  ethereum: 'https://api.etherscan.io',
  bnb: 'https://api.bscscan.com',
  polygon: 'https://api.polygonscan.com',
  arbitrum: 'https://api.arbiscan.io',
  optimism: 'https://api-optimistic.etherscan.io',
  avalanche: 'https://api.snowtrace.io',
  base: 'https://api.basescan.org'
};

async function handleRequest(request, url, path) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // Health check
  if (path === '/health') {
    return jsonResponse({ status: 'ok', version: '3.0.0', platform: 'netlify' });
  }

  // Fee config
  if (path === '/fee_config.json') {
    return jsonResponse(getFees());
  }

  // Save fees (admin)
  if (path === '/save-fees' && request.method === 'POST') {
    try {
      feesCache = await request.json();
      return jsonResponse({ success: true });
    } catch(e) { return jsonResponse({ success: false, error: 'Invalid data' }, 400); }
  }

  // Support contact form
  if (path === '/support' && request.method === 'POST') {
    try {
      var data = await request.json();
      var msg = {
        name: (data.name || '').substring(0, 100),
        email: (data.email || '').substring(0, 200),
        message: (data.message || '').substring(0, 2000),
        timestamp: Date.now()
      };
      supportMessages.push(msg);
      return jsonResponse({ success: true });
    } catch(e) { return jsonResponse({ success: false, error: 'Invalid data' }, 400); }
  }

  // Get support messages (admin)
  if (path === '/support-messages') {
    return jsonResponse(supportMessages);
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
    
    var baseUrl = CHAIN_EXPLORER[chain];
    if (!baseUrl) return jsonResponse({ error: 'Unsupported chain' }, 400);
    
    var apiUrl = baseUrl + '/api?module=account&action=' + action + '&address=' + address + '&apikey=' + API_KEYS.etherscan;
    var resp = await fetch(apiUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'H3-Wallet/1.0' } });
    return new Response(await resp.text(), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  // Token balance (EVM)
  if (path === '/token-balance') {
    var chain = url.searchParams.get('chain');
    var address = url.searchParams.get('address');
    var contract = url.searchParams.get('contract');
    if (!chain || !address || !contract) return jsonResponse({ error: 'Missing params' }, 400);
    
    var baseUrl = CHAIN_EXPLORER[chain];
    if (!baseUrl) return jsonResponse({ error: 'Unsupported chain' }, 400);
    
    var apiUrl = baseUrl + '/api?module=account&action=tokenbalance&contractaddress=' + contract + '&address=' + address + '&apikey=' + API_KEYS.etherscan;
    var resp = await fetch(apiUrl, { headers: { 'Accept': 'application/json', 'User-Agent': 'H3-Wallet/1.0' } });
    var d = await resp.json();
    if (d.status === '1' && d.result) {
      // Find decimals for token
      var tokenDecimals = 18;
      if (contract.toLowerCase() === '0xdac17f958d2ee523a2206206994597c13d831ec7') tokenDecimals = 6; // USDT ETH
      if (contract.toLowerCase() === '0x55d398326f99059ff775485246999027b3197955') tokenDecimals = 18; // USDT BNB
      return jsonResponse({ success: true, balance: parseFloat(d.result) / Math.pow(10, tokenDecimals) });
    }
    return jsonResponse({ success: false, balance: 0 });
  }

  // Gas price
  if (path === '/gas') {
    var chain = url.searchParams.get('chain');
    var type = url.searchParams.get('type');
    if (!chain) return jsonResponse({ error: 'Missing chain' }, 400);
    
    var rpc = CHAIN_RPC[chain];
    if (!rpc) return jsonResponse({ error: 'Unsupported chain' }, 400);
    
    var resp = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] })
    });
    var d = await resp.json();
    var gasPrice = d.result ? parseInt(d.result, 16) / 1e9 : 0;
    return jsonResponse({ success: true, gasPrice: gasPrice });
  }

  // Solana balance
  if (path === '/solana-balance') {
    var address = url.searchParams.get('address');
    if (!address) return jsonResponse({ error: 'Missing address' }, 400);
    try {
      var resp = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] })
      });
      var d = await resp.json();
      var balance = (d.result && d.result.value) ? d.result.value / 1e9 : 0;
      return jsonResponse({ success: true, balance: balance });
    } catch(e) { return jsonResponse({ success: false, balance: 0 }); }
  }

  // SPL balances
  if (path === '/spl-balances') {
    var address = url.searchParams.get('address');
    if (!address) return jsonResponse({ error: 'Missing address' }, 400);
    try {
      var resp = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
          params: [address, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]
        })
      });
      var d = await resp.json();
      var tokens = [];
      if (d.result && d.result.value) {
        d.result.value.forEach(function(t) {
          tokens.push({
            mint: t.account.data.parsed.info.mint,
            balance: t.account.data.parsed.info.tokenAmount.uiAmount
          });
        });
      }
      return jsonResponse({ success: true, tokens: tokens });
    } catch(e) { return jsonResponse({ success: false, tokens: [] }); }
  }

  // Litecoin balance
  if (path === '/litecoin-balance') {
    var address = url.searchParams.get('address');
    if (!address) return jsonResponse({ error: 'Missing address' }, 400);
    try {
      var resp = await fetch('https://litecoinspace.org/api/address/' + address + '/utxo');
      var utxos = await resp.json();
      var balance = utxos.reduce(function(sum, u) { return sum + u.value; }, 0) / 1e8;
      return jsonResponse({ success: true, balance: balance });
    } catch(e) { return jsonResponse({ success: false, balance: 0 }); }
  }

  // XRP balance
  if (path === '/xrp-balance') {
    var address = url.searchParams.get('address');
    if (!address) return jsonResponse({ error: 'Missing address' }, 400);
    try {
      var resp = await fetch('https://xrplcluster.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'account_info', params: [{ account: address, ledger_index: 'validated' }] })
      });
      var d = await resp.json();
      var balance = d.result && d.result.account_data ? parseFloat(d.result.account_data.Balance) / 1e6 : 0;
      return jsonResponse({ success: true, balance: balance });
    } catch(e) { return jsonResponse({ success: false, balance: 0 }); }
  }

  // Easy Gas (EVM) - simplified placeholder
  if (path === '/easy-gas' && request.method === 'POST') {
    return jsonResponse({ success: false, error: 'Easy Gas requires relayer keys - configure via env vars' });
  }

  // Easy Gas Tron
  if (path === '/easy-gas-tron' && request.method === 'POST') {
    return jsonResponse({ success: false, error: 'Easy Gas Tron requires relayer keys - configure via env vars' });
  }

  // Easy Gas Solana
  if (path === '/easy-gas-solana' && request.method === 'POST') {
    return jsonResponse({ success: false, error: 'Easy Gas Solana requires relayer keys - configure via env vars' });
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

export default async function handler(req) {
  var url = new URL(req.url);
  // Netlify functions get the full URL, we need to extract the path after /api/
  var path = url.pathname.replace(/^\/api/, '') || '/';
  return await handleRequest(req, url, path);
}

export const config = {
  path: "/api/*"
};
