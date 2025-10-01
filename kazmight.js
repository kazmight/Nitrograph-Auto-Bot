import 'dotenv/config';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper as axiosCookieJarSupport } from 'axios-cookiejar-support';
import { ethers } from 'ethers';
import readline from 'readline';
import chalk from 'chalk';


const AUTH_API = 'https://api-web.nitrograph.com/api';
const BASE_API = 'https://community.nitrograph.com/api';
const REF_CODE = 'Y8UUD9HU'; 
const CHAIN_ID = 200024;

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
];
const pickUA = () => UA_LIST[Math.floor(Math.random() * UA_LIST.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


const colors = {
  primary: "#00ff00",
  secondary: "#ffff00",
  info: "#3498db",
  warning: "#f39c12",
  error: "#e74c3c",
  success: "#2ecc71",
  text: "#ffffff",
  background: "#1a1a1a",
  purple: "#9b59b6",
  cyan: "#00ffff",
  pink: "#ff69b4",
  orange: "#ff8c00",
};

const colorize = {
  primary: (msg) => chalk.hex(colors.primary)(msg),
  secondary: (msg) => chalk.hex(colors.secondary)(msg),
  info: (msg) => chalk.hex(colors.info)(msg),
  warning: (msg) => chalk.hex(colors.warning)(msg),
  error: (msg) => chalk.hex(colors.error)(msg),
  success: (msg) => chalk.hex(colors.success)(msg),
  text: (msg) => chalk.hex(colors.text)(msg),
  purple: (msg) => chalk.hex(colors.purple)(msg),
  cyan: (msg) => chalk.hex(colors.cyan)(msg),
  pink: (msg) => chalk.hex(colors.pink)(msg),
  orange: (msg) => chalk.hex(colors.orange)(msg),
  badge: (label, value, color = 'info') =>
    `${chalk.bgHex(colors.background).hex(colors.text)(` ${label} `)} ${chalk.hex(colors[color] || colors.info)(value)}`
};


function formatHMS(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function readKeysFromEnv() {
  const raw = process.env.PRIVATE_KEYS || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function maskAddress(addr) {
  return `${addr.slice(0, 6)}******${addr.slice(-6)}`;
}

function buildClient() {
  const jar = new CookieJar();
  const client = axios.create({
    timeout: 60_000,
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://community.nitrograph.com',
      'Referer': 'https://community.nitrograph.com/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'User-Agent': pickUA()
    },
    validateStatus: (s) => s >= 200 && s < 300
  });
  axiosCookieJarSupport(client);
  client.defaults.jar = jar;
  client.defaults.withCredentials = true;
  return client;
}

async function withRetry(fn, { retries = 5, delayMs = 1500, label = '' } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) {
        console.log(colorize.warning(`[RETRY] ${label || 'request'} attempt ${i + 1}/${retries} failed: ${e?.message || e}`));
        await sleep(delayMs);
      }
    }
  }
  console.log(colorize.error(`[ERROR] ${label || 'request failed'}: ${lastErr?.message || lastErr}`));
  return null;
}


function buildSiweMessage(address, nonce) {
  const issuedAt = new Date().toISOString();
  return (
    `community.nitrograph.com wants you to sign in with your Ethereum account:\n` +
    `${address}\n\n` +
    `Sign in to Nitrograph using your wallet\n\n` +
    `URI: https://community.nitrograph.com\n` +
    `Version: 1\n` +
    `Chain ID: ${CHAIN_ID}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}`
  );
}

async function authNonce(client, address, baseHeaders) {
  return withRetry(async () => {
    const { data } = await client.get(`${AUTH_API}/auth/nonce`, { headers: baseHeaders });
    return data;
  }, { label: 'fetch nonce' });
}

async function authVerify(client, wallet, address, nonce, baseHeaders, store) {
  return withRetry(async () => {
    const message = buildSiweMessage(address, nonce);
    const signature = await wallet.signMessage(message);
    const payload = { message, signature };

    const { data, headers } = await client.post(`${AUTH_API}/auth/verify`, payload, {
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/json'
      }
    });

    const setCookies = headers['set-cookie'] || [];
    const cookieStr = setCookies.map(c => c.split(';')[0]).join('; ');
    store.session_v1 = cookieStr || '';

    const sessionV4Payload = {
      token: data.token,
      userId: data.tokenData?.userId,
      snagUserId: data.tokenData?.snagUserId,
      address: data.address,
      chainId: data.tokenData?.chainId,
      expiresAt: data.expiresAt,
      newAccount: data.tokenData?.newAccount,
      refreshToken: data.refreshToken
    };
    store.session_v4 = `@nitrograph/session-v4=${encodeURIComponent(JSON.stringify(sessionV4Payload))}`;

    store.access_token = data.token;
    store.refresh_token = data.refreshToken;

    return data;
  }, { label: 'verify/login' });
}

async function verifyReferral(client, baseHeaders, store) {
  return withRetry(async () => {
    const { data } = await client.post(
      `${BASE_API}/referrals/verify`,
      { referralCode: REF_CODE },
      {
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/json',
          'Cookie': [store.session_v1, store.session_v4].filter(Boolean).join('; ')
        }
      }
    );
    return data;
  }, { label: 'verify referral' });
}

async function fetchUserData(client, baseHeaders, store) {
  return withRetry(async () => {
    const { data } = await client.get(`${AUTH_API}/users/me`, {
      headers: {
        ...baseHeaders,
        'Authorization': `Bearer ${store.access_token}`,
        'Cookie': store.session_v1 || ''
      }
    });
    return data;
  }, { label: 'fetch user data' });
}

async function claimCredits(client, baseHeaders, store) {
  return withRetry(async () => {
    const { data } = await client.post(`${AUTH_API}/credits/claim`, null, {
      headers: {
        ...baseHeaders,
        'Authorization': `Bearer ${store.access_token}`,
        'Content-Length': '0',
        'Cookie': store.session_v1 || ''
      }
    });
  return data;
  }, { label: 'claim credits' });
}

async function getLoyaltyRules(client, baseHeaders, store, type = 'DAILY_CLAIM') {
  return withRetry(async () => {
    const { data } = await client.get(`${BASE_API}/loyalties/rules?type=${encodeURIComponent(type)}`, {
      headers: {
        ...baseHeaders,
        'Cookie': [store.session_v1, store.session_v4].filter(Boolean).join('; ')
      }
    });
    return data;
  }, { label: 'get loyalty rules' });
}

async function claimLoyalties(client, baseHeaders, store, ruleId) {
  return withRetry(async () => {
    const { data } = await client.post(`${BASE_API}/loyalties/rules`, { ruleIds: [ruleId] }, {
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/json',
        'Cookie': [store.session_v1, store.session_v4].filter(Boolean).join('; ')
      }
    });
    return data;
  }, { label: `claim loyalty ${ruleId}` });
}


async function processAccount(client, pkRaw) {
  let wallet;
  try {
    wallet = new ethers.Wallet(pkRaw);
  } catch (e) {
    console.log(colorize.error(`[ERROR] Invalid private key: ${e.message}`));
    return;
  }
  const address = await wallet.getAddress();
  const short = maskAddress(address);

  const baseHeaders = {
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'User-Agent': pickUA(),
  };

  console.log(colorize.cyan(`\n========== [ ${short} ] ==========`));

  const nonceRes = await authNonce(client, address, baseHeaders);
  if (!nonceRes?.nonce) {
    console.log(colorize.error('[LOGIN] Failed to fetch nonce'));
    return;
  }

  const store = { session_v1: '', session_v4: '', access_token: '', refresh_token: '' };
  const loginRes = await authVerify(client, wallet, address, nonceRes.nonce, baseHeaders, store);
  if (!loginRes?.token) {
    console.log(colorize.error('[LOGIN] Failed to verify/login'));
    return;
  }
  console.log(colorize.success('[LOGIN] Success'));

  await verifyReferral(client, baseHeaders, store);

  const user = await fetchUserData(client, baseHeaders, store);
  if (!user?.data) {
    console.log(colorize.error('[USER] Failed to fetch profile'));
    return;
  }

  const points = user.data.points ?? 0;
  const credits = user.data.credits ?? 0;
  const mining = user.data.miningDetails ?? {};
  console.log(`${colorize.badge('USER', 'PROFILE', 'purple')} ${colorize.info(`Points: ${points} XP`)} ${chalk.gray('|')} ${colorize.secondary(`Credits: ${credits} $NITRO`)}`);

  const poolAmount = mining.claimPoolAmount ?? 0;
  const lastClaimMs = mining.lastClaimAtTimestampMs ?? null;
  const nextClaimMs = mining.lastClaimAtTimestampMs ?? null;

  if (poolAmount > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (!lastClaimMs || (nextClaimMs && nextClaimMs < nowSec)) {
      const claim = await claimCredits(client, baseHeaders, store);
      if (claim?.claimedAmount != null) {
        console.log(colorize.success(`[MINING] Claimed ${claim.claimedAmount} $NITRO`));
      } else {
        console.log(colorize.warning('[MINING] Claim attempt returned no amount'));
      }
    } else {
      const ts = nextClaimMs / 1000;
      const iso = new Date(ts * 1000).toISOString();
      console.log(colorize.warning(`[MINING] Not time yet. Next claim at ${iso}`));
    }
  } else {
    console.log(colorize.orange('[MINING] No available credits to claim'));
  }

  const rules = await getLoyaltyRules(client, baseHeaders, store, 'DAILY_CLAIM');
  if (Array.isArray(rules) && rules.length) {
    for (const r of rules) {
      if (!r?.id) continue;
      const res = await claimLoyalties(client, baseHeaders, store, r.id);
      if (res?.message) {
        console.log(colorize.success(`[CHECK-IN] ${res.message}`));
      }
    }
  }
}


async function countdown(seconds) {
  
  while (seconds > 0) {
    const line =
      colorize.cyan('[WAIT] ') +
      colorize.info(formatHMS(seconds)) +
      chalk.gray('  |  ') +
      colorize.text('All accounts processed...');
    process.stdout.write(`\r${line}`);
    await sleep(1000);
    seconds -= 1;
  }
  process.stdout.write('\n');
}


function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function showMenu() {
  console.log(chalk.bgHex(colors.background).hex(colors.text)('\n=== Nitro Graph Auto Bot ==='));
  console.log(colorize.primary('1) Start'));
  console.log(colorize.pink('2) Exit'));
  const choice = await ask(colorize.secondary('Choose [1/2]: '));
  return (choice || '').trim();
}


async function runContinuous() {
  const keys = readKeysFromEnv();
  if (!keys.length) {
    console.log(colorize.error('No private keys found. Please set PRIVATE_KEYS in your .env'));
    process.exit(1);
  }
  console.log(colorize.badge('ACCOUNTS', String(keys.length), 'cyan'));

  const client = buildClient();

  
  while (true) {
    for (const pk of keys) {
      if (!pk) continue;
      await processAccount(client, pk);
    }
    console.log(colorize.purple('────────────────────────────────────────────────────────────────────────'));
    await countdown(24 * 60 * 60);
  }
}

async function main() {
  while (true) {
    const choice = await showMenu();
    if (choice === '1') {
      await runContinuous(); 
      break;
    } else if (choice === '2') {
      console.log(colorize.info('Bye!'));
      process.exit(0);
    } else {
      console.log(colorize.warning('Invalid choice. Please select 1 or 2.'));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n' + colorize.error('[EXIT] Nitro Graph Auto Bot'));
  process.exit(0);
});

main().catch((e) => {
  console.error(colorize.error(`Fatal error: ${e?.message || e}`));
  process.exit(1);
});
