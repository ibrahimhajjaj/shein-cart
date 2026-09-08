# shein-cart

Someone shares their SHEIN cart with you and what you get is a onelink.shein.com URL that
only really works inside the SHEIN app. On a phone without the app it falls through to the
mobile site. On a laptop it drops you on the SHEIN homepage and the cart is nowhere.

This takes that link and shows you the cart: every item with its photo, colour and size,
price, discount, stock, and a link to the product page. It also gives you the plain
m.shein.com URL that opens the same cart in any browser, so you can send that one instead.

There's a site at https://shein.ibrahimwithi.com and a CLI.

## CLI

```bash
npx shein-cart "https://onelink.shein.com/51/xxxxxxxx?shc=2_xxxxxxxxxxx"
```

Needs Node 18+. Paste the whole message if that's what you have, it finds the link in it.
Piping works too: `pbpaste | shein-cart`.

```bash
shein-cart -c EGP "https://onelink.shein.com/51/..."      # prices in another currency
shein-cart --link "https://onelink.shein.com/51/..."      # only the browser link
shein-cart --open "https://onelink.shein.com/51/..."      # and open it
shein-cart --json "https://onelink.shein.com/51/..."      # the cart as JSON
```

## What the link actually does

I traced it because the redirect chain isn't obvious from a browser. The onelink page is a
bit of HTML with a script that tries the app deeplink and falls back to
api-shein.shein.com/h5/sharejump/appjump. That page has the cart's `group_id` embedded twice
(in the deeplink and in a `shareInfo` JSON) and, on a phone, forwards to
m.shein.com/cart/share/landing. With a desktop user agent it forwards to the homepage
instead, which is the whole problem.

The landing page loads the items with one POST to
m.shein.com/bff-api/order/cart/share/landing. All that call checks is the `armorUuid` cookie
every m.shein.com page sets, so this fetches one page for the cookie and reuses it for a few
hours. No login, no app headers, no risk tokens.

## Heads up

- It's SHEIN's private endpoint. When they change it this breaks and `src/shein.js` gets
  patched.
- Prices are guest prices and SHEIN reprices per request, so the total moves by a dollar or
  two between runs. A currency is a header away (`-c EGP`); a language isn't, names come
  back in English whatever you ask for.
- The share payload has no quantities. You get each item and its variant, not how many.
- None of this works from a static page: the endpoints send no CORS headers and the cookie
  belongs to m.shein.com. That's why the site is a Worker.

## The site

A Cloudflare Worker. `public/index.html` is served as a static asset, `worker/index.js`
answers the API, and both sit on `src/shein.js`, which is plain `fetch` and runs unchanged
in Node.

```sh
npm install
npm run dev       # http://localhost:8787
npm run deploy    # the route in wrangler.toml is my hostname, change it
```

`/api/cart?link=…&currency=EGP` returns the cart as JSON, `/api/resolve?link=…` just the ids
and the browser link, and `/go?link=…` is a 302 to that link so it works behind a bookmark.

## Tests

`npm test` covers the link parsing and the payload normalisation. The network path I check
by hand against a real link.

## License

MIT
