// Resolves a SHEIN shared-cart link to its items.
//
// A share link goes through three hops before anything is visible:
//   1. onelink.shein.com/<a>/<b>?shc=…  (HTML page with a JS bouncer)
//   2. api-shein.shein.com/h5/sharejump/appjump?…  (tries the app deeplink, then the m-site)
//   3. m.shein.com/cart/share/landing?group_id=…  (PWA shell, loads items over XHR)
// The items themselves come from one POST to the cart BFF, which only asks for the
// armorUuid cookie that any m.shein.com page sets. The desktop bouncer sends you to
// the homepage instead, so on a laptop the cart is invisible unless you go to hop 3 yourself.

const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

const MSITE_DEFAULT = 'm.shein.com';
const BFF_PATH = '/bff-api/order/cart/share/landing?_ver=1.1.8&_lang=en';
const CART_TTL_MS = 60 * 1000;

// A cart shared from the global site is only visible on a few of SHEIN's regional sites,
// and the global one is geo-routed at the CDN, so from most of the world it answers with
// a redirect to a regional site that cannot see the cart. These can. au answers in
// English, ar in Arabic, mx in Spanish; the price is whatever that site charges.
const FALLBACK_SITES = ['m.shein.com/au', 'm.shein.com/ar', 'm.shein.com.mx'];

// One retry for the kind of failure that has nothing to do with the link: a dropped
// connection, a DNS hiccup. HTTP errors are not retried, they mean something.
async function fetchOnce(url, init) {
  try {
    return await fetch(url, init);
  } catch (first) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      return await fetch(url, init);
    } catch {
      throw new ShareLinkError(`Could not reach ${new URL(url).hostname}: ${first.message}`, 'network', 502);
    }
  }
}

// Country code -> mobile site host, as the share bouncer maps them.
const SITE_MAP = [
  ['m.shein.com/us', ['us']],
  ['m.shein.com.mx', ['mx']],
  ['m.shein.com/es', ['es']],
  ['m.shein.com/it', ['it']],
  ['m.shein.com/fr', ['fr']],
  ['m.shein.com/de', ['de', 'at', 'lu']],
  ['m.shein.in', ['in']],
  ['m.shein.tw', ['tw']],
  ['m.shein.co.uk', ['gb']],
  ['m.shein.com/au', ['au']],
  ['m.shein.com/ru', ['ru', 'by', 'kz']],
  ['m.shein.com/ar', ['sa', 'kw', 'ae', 'qa', 'om', 'bh']],
  ['m.shein.com.vn', ['vn']],
  ['m.shein.com.hk', ['hk']],
  ['m.shein.com/th', ['th']],
  ['m.shein.com/il', ['il']],
  ['m.shein.com/ca', ['ca']],
  ['m.shein.se', ['se']],
  ['m.shein.com/eur', ['be', 'bg', 'cz', 'dk', 'ee', 'fi', 'gr', 'hu', 'lv', 'lt', 'ro', 'sk', 'si', 'ie', 'cy', 'mt', 'hr']],
  ['m.shein.com/cl', ['cl']],
  ['m.shein.com/ma', ['ma']],
  ['m.shein.com/br', ['br']],
  ['m.shein.com/za', ['za']],
  ['m.shein.com/sg', ['sg']],
];

export class ShareLinkError extends Error {
  constructor(message, code = 'bad_link', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function msiteHost(localCountry) {
  const cc = String(localCountry || 'other').toLowerCase();
  for (const [host, codes] of SITE_MAP) if (codes.includes(cc)) return host;
  return MSITE_DEFAULT;
}

export function siteOrder(localCountry, preferred) {
  return [...new Set([preferred, msiteHost(localCountry), ...FALLBACK_SITES].filter(Boolean))];
}

export function landingUrl({ groupId, shc, localCountry, urlFrom }, site) {
  const q = new URLSearchParams();
  if (shc) q.set('shc', shc);
  q.set('group_id', groupId);
  q.set('local_country', localCountry || 'OTHER');
  if (urlFrom) q.set('url_from', urlFrom);
  q.set('cart_share', '1');
  return `https://${site || msiteHost(localCountry)}/cart/share/landing?${q}`;
}

// ---------- input parsing ----------

const URL_RE = /(?:https?:\/\/|sheinlink:\/\/)[^\s<>"'`]+/gi;

function stripTrailingPunct(u) {
  return u.replace(/[)\].,;!?]+$/, '');
}

function fromDeeplink(u) {
  // sheinlink://applink/share_receiver?data=<url-encoded json>
  const m = u.match(/[?&]data=([^&]+)/);
  if (!m) return null;
  try {
    const d = JSON.parse(decodeURIComponent(m[1]));
    if (!d.group_id) return null;
    return {
      groupId: String(d.group_id),
      shc: d.shc || '',
      localCountry: d.local_country || 'OTHER',
      urlFrom: d.url_from || '',
      cartShare: String(d.cart_share ?? '1'),
    };
  } catch {
    return null;
  }
}

export function parseInput(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new ShareLinkError('Paste a SHEIN share link first.');

  const found = (raw.match(URL_RE) || []).map(stripTrailingPunct);
  const out = { groupId: '', shc: '', localCountry: '', urlFrom: '', onelink: '', appjump: '' };

  for (const u of found) {
    if (u.startsWith('sheinlink://')) {
      const d = fromDeeplink(u);
      if (d) Object.assign(out, d);
      continue;
    }
    let url;
    try {
      url = new URL(u);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    const p = url.searchParams;

    if (host === 'onelink.shein.com') {
      out.onelink = url.toString();
      out.shc ||= p.get('shc') || '';
    } else if (url.pathname.includes('/sharejump/appjump')) {
      out.appjump = url.toString();
      out.shc ||= p.get('shc') || '';
      out.localCountry ||= p.get('localcountry') || '';
      out.urlFrom ||= p.get('url_from') || '';
    } else if (url.pathname.includes('/cart/share/landing') && p.get('group_id')) {
      out.groupId ||= p.get('group_id');
      out.shc ||= p.get('shc') || '';
      out.localCountry ||= p.get('local_country') || '';
      out.urlFrom ||= p.get('url_from') || '';
    }
  }

  if (!out.groupId && !out.onelink && !out.appjump) {
    // A bare group id is enough to fetch the cart.
    if (/^\d{6,}$/.test(raw)) out.groupId = raw;
    else throw new ShareLinkError('No SHEIN share link found. Paste the whole "I found some great items at SHEIN!" message or the onelink.shein.com URL.');
  }
  return out;
}

// ---------- link resolution (onelink / appjump -> group id) ----------

async function getText(url) {
  const res = await fetchOnce(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow' });
  if (!res.ok) throw new ShareLinkError(`SHEIN answered ${res.status} for ${url}`, 'upstream', 502);
  return res.text();
}

function decodeAttr(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function resolveOnelink(url) {
  const html = await getText(url);
  const dl = html.match(/id="deeplink"\s+value="([^"]+)"/);
  if (dl) {
    const d = fromDeeplink(decodeAttr(dl[1]));
    if (d) return d;
  }
  const web = html.match(/id="url"\s+value="([^"]+)"/);
  if (web) return { appjump: decodeAttr(web[1]) };
  throw new ShareLinkError('This onelink did not resolve to a shared cart. It may have expired.', 'expired', 404);
}

async function resolveAppjump(url) {
  const html = await getText(url);
  const m = html.match(/shareInfo\s*=\s*(\{[\s\S]*?\})\s*;?\s*\n/);
  if (!m) throw new ShareLinkError('Could not read the share info from SHEIN.', 'upstream', 502);
  let info;
  try {
    info = JSON.parse(m[1]);
  } catch {
    throw new ShareLinkError('Could not parse the share info from SHEIN.', 'upstream', 502);
  }
  if (info.share_type && info.share_type !== 'cart') {
    throw new ShareLinkError(`This is a "${info.share_type}" share, not a cart.`, 'not_cart', 422);
  }
  if (Number(info.status) < 0 || !info.id) {
    throw new ShareLinkError('SHEIN says this share link has expired.', 'expired', 404);
  }
  return {
    groupId: String(info.id),
    localCountry: info.localcountry || 'OTHER',
    urlFrom: info.url_from || '',
    shc: '',
  };
}

export async function resolve(text) {
  const parsed = parseInput(text);
  let r = { ...parsed };

  if (!r.groupId && r.onelink) {
    const d = await resolveOnelink(r.onelink);
    r = { ...r, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v)) };
  }
  if (!r.groupId && r.appjump) {
    const d = await resolveAppjump(r.appjump);
    r = { ...r, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v)) };
  }
  if (!r.groupId) throw new ShareLinkError('Could not find the cart id behind this link.', 'expired', 404);

  r.localCountry ||= 'OTHER';
  r.landingUrl = landingUrl(r);
  return r;
}

// ---------- cart fetch ----------

// SHEIN only checks that the cookie is there and shaped like one of its own: a timestamp
// and 50 hex characters. Minting one here saves fetching a page for it, and a geo-routed
// landing page can no longer leave us without one.
let cookie = '';

function mintCookie() {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  let hex = '';
  while (hex.length < 50) hex += Math.floor(Math.random() * 16).toString(16);
  cookie = `armorUuid=${stamp}${hex}`;
  return cookie;
}

async function postCart(url, { groupId, localCountry }, currency, cookie) {
  return fetchOnce(url, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      origin: 'https://m.shein.com',
      referer: `https://m.shein.com/cart/share/landing?group_id=${groupId}`,
      appcurrency: currency,
      cookie,
    },
    body: JSON.stringify({ groupId: String(groupId), localCountry: localCountry || 'OTHER', userLocalSizeCountry: '' }),
    redirect: 'manual',
  });
}

function countItems(info) {
  return (info.normalProducts || []).length + (info.outStock || []).length + (info.unavailable || []).length;
}

function siteOf(url) {
  const m = String(url).match(/^https:\/\/([^/]+)\/(?:([a-z]+)\/)?bff-api\//);
  return m ? (m[2] ? `${m[1]}/${m[2]}` : m[1]) : '';
}

const siteCache = new Map();
const cartCache = new Map();

export async function fetchCartRaw(target, opts = {}) {
  const currency = opts.currency || 'USD';
  const home = msiteHost(target.localCountry);
  if (!cookie) mintCookie();
  let empty = null;

  for (const site of siteOrder(target.localCountry, siteCache.get(home))) {
    const key = `${site}|${target.groupId}|${currency}`;
    const hit = cartCache.get(key);
    if (hit && Date.now() - hit.at < CART_TTL_MS) return hit;

    let url = `https://${site}${BFF_PATH}`;
    let res = await postCart(url, target, currency, cookie);
    if (res.status === 403) res = await postCart(url, target, currency, mintCookie());
    if (res.status === 302) {
      // The CDN sent us to the regional site it thinks we belong to. Ask that one.
      url = res.headers.get('location') || '';
      if (!siteOf(url)) throw new ShareLinkError('SHEIN redirected somewhere unexpected.', 'upstream', 502);
      res = await postCart(url, target, currency, cookie);
    }
    if (!res.ok) throw new ShareLinkError(`SHEIN cart API answered ${res.status}.`, 'upstream', 502);
    const data = await res.json();
    if (data.code === '836100') {
      throw new ShareLinkError('SHEIN put this server behind a bot check. Try again in a few minutes.', 'risk', 503);
    }
    if (data.code !== '0' || !data.info) {
      throw new ShareLinkError(`SHEIN cart API: ${data.msg || data.code || 'unknown error'}`, 'upstream', 502);
    }
    const found = { info: data.info, site: siteOf(url), at: Date.now() };
    if (countItems(data.info) > 0) {
      siteCache.set(home, site);
      cartCache.set(key, found);
      return found;
    }
    empty = found;
  }
  return empty;
}

// ---------- normalisation ----------

function money(p) {
  if (!p || !p.amountWithSymbol) return null;
  return { amount: Number(p.amount), text: p.amountWithSymbol, usd: p.usdAmount ? Number(p.usdAmount) : null };
}

function slug(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .slice(0, 80) || 'item';
}

function absImg(u) {
  if (!u) return '';
  return u.startsWith('//') ? `https:${u}` : u;
}

function tagNames(list) {
  return (list || [])
    .filter((t) => t && t.tagName && t.hasAvailableTag !== '0')
    .map((t) => t.tagName);
}

function item(p, status) {
  const sale = money(p.salePrice);
  const retail = money(p.retailPrice);
  const discount = Number(p.unit_discount || 0);
  return {
    id: String(p.goods_id || ''),
    sn: p.goods_sn || '',
    sku: p.sku_code || p.itemSku || '',
    name: p.goods_name || '',
    attr: p.goodsAttr || '',
    image: absImg(p.goods_img),
    url: `https://www.shein.com/${slug(p.goods_name)}-p-${p.goods_id}.html`,
    price: {
      sale,
      retail: retail && sale && retail.amount !== sale.amount ? retail : null,
      discountPercent: discount > 0 ? discount : 0,
    },
    stock: p.stock != null ? Number(p.stock) : null,
    soldOut: Boolean(p.soldOutStatus) || status === 'outOfStock',
    quickShip: p.quickship === '1',
    onSale: p.is_on_sale === 1 || p.is_on_sale === '1',
    tags: [...tagNames(p.actTags), ...tagNames(p.productTags)],
    tips: (p.productTips || []).map((t) => (typeof t === 'string' ? t : t.tip || t.text || '')).filter(Boolean),
    status,
  };
}

export function normalize(info, target, site) {
  const items = [
    ...(info.normalProducts || []).map((p) => item(p, 'normal')),
    ...(info.outStock || []).map((p) => item(p, 'outOfStock')),
    ...(info.unavailable || []).map((p) => item(p, 'unavailable')),
  ];
  const available = items.filter((i) => i.status === 'normal' && !i.soldOut && i.price.sale);
  const total = available.reduce((s, i) => s + i.price.sale.amount, 0);
  const sample = available.find((i) => i.price.sale) || items.find((i) => i.price.sale);
  const symbol = sample ? sample.price.sale.text.replace(/[\d.,\s]/g, '') : '';

  return {
    groupId: target.groupId,
    shortCode: info.sceneData?.shortCode || (target.shc || '').replace(/^\d+_/, ''),
    sharedBy: info.shareUserInfo?.firstLetter ? `${info.shareUserInfo.firstLetter}**` : '',
    title: String(info.title || '').replace(/<[^>]+>/g, ''),
    count: items.length,
    availableCount: available.length,
    total: { amount: Number(total.toFixed(2)), symbol },
    landingUrl: target.landingUrl || landingUrl(target),
    site: site || msiteHost(target.localCountry),
    siteUrl: landingUrl(target, site),
    items,
  };
}

export async function getCart(text, opts = {}) {
  const target = await resolve(text);
  const { info, site } = await fetchCartRaw(target, opts);
  return normalize(info, target, site);
}
