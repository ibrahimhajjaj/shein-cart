#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { getCart, resolve, ShareLinkError } from '../src/shein.js';

const HELP = `Usage: shein-cart <share link or pasted message> [options]
       shein-cart < message.txt

Show the items behind a SHEIN "I found some great items at SHEIN!" link.

Options:
  -c, --currency <code>  prices in this currency (EGP, EUR, ...), default USD
  -j, --json             print the cart as JSON
  -l, --link             print only the link that opens the cart in a browser
  -o, --open             open that link in the default browser
  -h, --help
  -V, --version
`;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => paint('1', s);
const dim = (s) => paint('2', s);
const red = (s) => paint('31', s);
const green = (s) => paint('32', s);

function die(message, code = 1) {
  process.stderr.write(`shein-cart: ${message}\n`);
  process.exit(code);
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

function printCart(cart) {
  const out = [];
  const gone = cart.count - cart.availableCount;
  const head = [cart.title || 'Shared cart', `${cart.count} item${cart.count === 1 ? '' : 's'}${gone ? ` (${gone} unavailable)` : ''}`];
  if (cart.total.amount) head.push(`total ${cart.total.symbol}${cart.total.amount.toFixed(2)}`);
  out.push(bold(head.join(' · ')));
  out.push(dim(cart.landingUrl));
  out.push('');

  const width = String(cart.count).length;
  cart.items.forEach((it, i) => {
    const n = String(i + 1).padStart(width);
    const sale = it.price.sale ? it.price.sale.text : 'n/a';
    const price = it.price.discountPercent ? `${red(sale)} ${dim(it.price.retail ? it.price.retail.text : '')} ${red(`-${it.price.discountPercent}%`)}` : bold(sale);
    const flags = [];
    if (it.soldOut || it.status !== 'normal') flags.push(red('sold out'));
    else if (it.stock != null && it.stock > 0 && it.stock <= 5) flags.push(red(`only ${it.stock} left`));
    if (it.quickShip) flags.push(green('quickship'));
    out.push(`${dim(n)}  ${price}  ${it.name}`);
    out.push(`${' '.repeat(width)}  ${dim([it.attr, ...flags, ...it.tags.slice(0, 2)].filter(Boolean).join(' · '))}`);
    out.push(`${' '.repeat(width)}  ${dim(it.url)}`);
  });
  process.stdout.write(out.join('\n') + '\n');
}

async function main() {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        currency: { type: 'string', short: 'c' },
        json: { type: 'boolean', short: 'j' },
        link: { type: 'boolean', short: 'l' },
        open: { type: 'boolean', short: 'o' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'V' },
      },
    }));
  } catch (err) {
    die(`${err.message}\n\n${HELP}`, 2);
  }

  if (values.help) return process.stdout.write(HELP);
  if (values.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    return process.stdout.write(`${pkg.version}\n`);
  }

  let input = positionals.join(' ').trim();
  if (!input && !process.stdin.isTTY) input = (await readStdin()).trim();
  if (!input) {
    process.stderr.write(HELP);
    process.exit(2);
  }

  const currency = (values.currency || '').toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) die(`"${values.currency}" is not a currency code`);

  if (values.link || values.open) {
    const r = await resolve(input);
    process.stdout.write(`${r.landingUrl}\n`);
    if (values.open) openInBrowser(r.landingUrl);
    return;
  }

  const cart = await getCart(input, { currency });
  if (values.json) return process.stdout.write(JSON.stringify(cart, null, 2) + '\n');
  printCart(cart);
}

main().catch((err) => {
  if (err instanceof ShareLinkError) die(err.message);
  die(err && err.message ? err.message : String(err));
});
