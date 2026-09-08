import { getCart, resolve, ShareLinkError } from '../src/shein.js';

const CURRENCY_RE = /^[A-Z]{3}$/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const link = url.searchParams.get('link') || '';
    const currency = (url.searchParams.get('currency') || '').toUpperCase();

    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { ok: false, error: 'GET only' });

      if (url.pathname === '/api/cart') {
        const cart = await getCart(link, { currency: CURRENCY_RE.test(currency) ? currency : '' });
        return json(200, { ok: true, cart });
      }

      if (url.pathname === '/api/resolve') {
        const r = await resolve(link);
        return json(200, { ok: true, groupId: r.groupId, shc: r.shc, localCountry: r.localCountry, landingUrl: r.landingUrl });
      }

      // Bookmark-friendly: /go?link=<share link> lands on the cart in any browser.
      if (url.pathname === '/go') {
        const r = await resolve(link);
        return new Response(null, { status: 302, headers: { location: r.landingUrl, 'cache-control': 'no-store' } });
      }

      return json(404, { ok: false, error: 'Not found' });
    } catch (err) {
      if (err instanceof ShareLinkError) return json(err.status, { ok: false, code: err.code, error: err.message });
      console.error(err);
      return json(500, { ok: false, code: 'internal', error: 'Something broke on this side.' });
    }
  },
};
