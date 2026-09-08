import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, landingUrl, msiteHost, siteOrder, normalize } from '../src/shein.js';

const ONELINK = 'https://onelink.shein.com/51/61eku2d3x8hy?shc=2_R89Ygq23brP';
const DEEPLINK =
  'sheinlink://applink/share_receiver?data=%7B%22group_id%22%3A%22863528685%22%2C%22local_country%22%3A%22OTHER%22%2C%22url_from%22%3A%22GM76504758420%22%2C%22cart_share%22%3A%221%22%2C%22shc%22%3A%222_R89Ygq23brP%22%7D';

test('finds the onelink inside a pasted share message', () => {
  const r = parseInput(`I found some great items at SHEIN!\nThese items in my shopping cart are great. I highly recommend them to everyone!\n${ONELINK}`);
  assert.equal(r.onelink, ONELINK);
  assert.equal(r.shc, '2_R89Ygq23brP');
  assert.equal(r.groupId, '');
});

test('reads the group id straight out of a deeplink', () => {
  const r = parseInput(DEEPLINK);
  assert.equal(r.groupId, '863528685');
  assert.equal(r.localCountry, 'OTHER');
  assert.equal(r.urlFrom, 'GM76504758420');
});

test('reads the landing url and the sharejump url', () => {
  const landing = parseInput('https://m.shein.com/cart/share/landing?shc=2_x&group_id=123456&local_country=EG&url_from=GM1&cart_share=1');
  assert.equal(landing.groupId, '123456');
  assert.equal(landing.localCountry, 'EG');

  const jump = parseInput('https://api-shein.shein.com/h5/sharejump/appjump?onelink=51/abc&shc=2_y&localcountry=OTHER&url_from=GM2');
  assert.ok(jump.appjump.includes('sharejump/appjump'));
  assert.equal(jump.shc, '2_y');
});

test('accepts a bare group id and rejects everything else', () => {
  assert.equal(parseInput('863528685').groupId, '863528685');
  assert.throws(() => parseInput('hello world'), /No SHEIN share link/);
  assert.throws(() => parseInput('https://example.com/not-shein'), /No SHEIN share link/);
});

test('maps countries to their mobile site', () => {
  assert.equal(msiteHost('OTHER'), 'm.shein.com');
  assert.equal(msiteHost('gb'), 'm.shein.co.uk');
  assert.equal(msiteHost('AE'), 'm.shein.com/ar');
  assert.equal(landingUrl({ groupId: '1', shc: '2_a', localCountry: 'US', urlFrom: 'GM9' }), 'https://m.shein.com/us/cart/share/landing?shc=2_a&group_id=1&local_country=US&url_from=GM9&cart_share=1');
});

test('tries the link\'s own site first, then the ones that can see global carts', () => {
  assert.deepEqual(siteOrder('OTHER'), ['m.shein.com', 'm.shein.com/au', 'm.shein.com/ar', 'm.shein.com.mx']);
  assert.deepEqual(siteOrder('us'), ['m.shein.com/us', 'm.shein.com/au', 'm.shein.com/ar', 'm.shein.com.mx']);
  assert.deepEqual(siteOrder('OTHER', 'm.shein.com/ar'), ['m.shein.com/ar', 'm.shein.com', 'm.shein.com/au', 'm.shein.com.mx']);
  assert.equal(landingUrl({ groupId: '1', localCountry: 'OTHER' }, 'm.shein.com/au'), 'https://m.shein.com/au/cart/share/landing?group_id=1&local_country=OTHER&cart_share=1');
});

test('normalises a cart payload', () => {
  const info = {
    title: 'Items shared by <span style="font-weight:bold">m**</span>',
    shareUserInfo: { firstLetter: 'm' },
    sceneData: { shortCode: 'R89Ygq23brP' },
    normalProducts: [
      {
        goods_id: '1', goods_sn: 'sn1', sku_code: 'sku1', goods_name: 'Red Dress', goodsAttr: 'Red / L',
        goods_img: '//img.example/1.jpg', stock: '3', quickship: '1', is_on_sale: 1,
        salePrice: { amount: '5.70', amountWithSymbol: '$5.70', usdAmount: '5.70' },
        retailPrice: { amount: '7.60', amountWithSymbol: '$7.60', usdAmount: '7.60' },
        unit_discount: '25', actTags: [{ tagName: '50+ sold', hasAvailableTag: '1' }],
      },
    ],
    outStock: [{ goods_id: '2', goods_name: 'Gone', salePrice: { amount: '1.00', amountWithSymbol: '$1.00' }, retailPrice: { amount: '1.00', amountWithSymbol: '$1.00' } }],
  };
  const cart = normalize(info, { groupId: '9', shc: '2_R89Ygq23brP', localCountry: 'OTHER' }, 'm.shein.com/au');
  assert.equal(cart.title, 'Items shared by m**');
  assert.equal(cart.site, 'm.shein.com/au');
  assert.equal(cart.siteUrl, 'https://m.shein.com/au/cart/share/landing?shc=2_R89Ygq23brP&group_id=9&local_country=OTHER&cart_share=1');
  assert.equal(cart.landingUrl, 'https://m.shein.com/cart/share/landing?shc=2_R89Ygq23brP&group_id=9&local_country=OTHER&cart_share=1');
  assert.equal(cart.count, 2);
  assert.equal(cart.availableCount, 1);
  assert.deepEqual(cart.total, { amount: 5.7, symbol: '$' });
  const [dress, gone] = cart.items;
  assert.equal(dress.image, 'https://img.example/1.jpg');
  assert.equal(dress.url, 'https://www.shein.com/Red-Dress-p-1.html');
  assert.equal(dress.price.retail.text, '$7.60');
  assert.equal(dress.price.discountPercent, 25);
  assert.equal(dress.quickShip, true);
  assert.deepEqual(dress.tags, ['50+ sold']);
  assert.equal(gone.soldOut, true);
  assert.equal(gone.status, 'outOfStock');
  assert.equal(gone.price.retail, null);
});
