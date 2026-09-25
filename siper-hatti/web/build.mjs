// Web oyununu dist/ klasörüne derler: tek JS paketi + CSS + yazı tipleri + ikonlar.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(root, 'dist');
const serve = process.argv.includes('--serve');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });

// Yazı tipleri (Türkçe karakterler için latin + latin-ext)
const fonts = [
  ['rajdhani', 'Rajdhani', [500, 600, 700]],
  ['teko', 'Teko', [500, 600]],
];
let fontCss = '';
for (const [pkg, family, weights] of fonts) {
  for (const w of weights) {
    for (const subset of ['latin-ext', 'latin']) {
      const cssFile = path.join(root, 'node_modules/@fontsource', pkg, `${subset}-${w}.css`);
      const css = fs.readFileSync(cssFile, 'utf8');
      const range = (css.match(/unicode-range:\s*([^;]+);/) || [])[1];
      const file = `${pkg}-${subset}-${w}-normal.woff2`;
      fs.copyFileSync(path.join(root, 'node_modules/@fontsource', pkg, 'files', file), path.join(dist, 'fonts', file));
      fontCss += `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${w};src:url(fonts/${file}) format('woff2');${range ? `unicode-range:${range};` : ''}}\n`;
    }
  }
}
fs.writeFileSync(path.join(dist, 'style.css'), fontCss + fs.readFileSync(path.join(root, 'style.css'), 'utf8'));
fs.copyFileSync(path.join(root, 'index.html'), path.join(dist, 'index.html'));
for (const f of fs.readdirSync(path.join(root, 'public'))) fs.copyFileSync(path.join(root, 'public', f), path.join(dist, f));

const opts = {
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  outfile: path.join(dist, 'game.js'),
  minify: !serve,
  sourcemap: serve ? 'inline' : false,
  target: ['chrome91', 'safari15', 'firefox100'],
  legalComments: 'none',
  logLevel: 'info',
};
if (serve) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: dist, port: 8080, host: '0.0.0.0' });
  console.log(`http://localhost:${port}`);
} else {
  await esbuild.build(opts);
  const size = fs.statSync(opts.outfile).size;
  console.log(`dist/game.js ${(size / 1024).toFixed(0)} KB`);
}
