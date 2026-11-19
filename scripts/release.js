// `npm run release`: bumps the version everywhere it lives (sw.js and the ?v= links in index.html),
// so phones fetch the new files and the offline copy is replaced. Run it before every push to main.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), swPath = path.join(root, 'sw.js'), htmlPath = path.join(root, 'index.html');
const sw = fs.readFileSync(swPath, 'utf8'), html = fs.readFileSync(htmlPath, 'utf8');
const cur = sw.match(/const VERSION = '(\d+)'/)[1], next = String(+cur + 1);
fs.writeFileSync(swPath, sw.replace(`const VERSION = '${cur}'`, `const VERSION = '${next}'`));
fs.writeFileSync(htmlPath, html.replace(`styles.css?v=${cur}"`, `styles.css?v=${next}"`).replace(`app.js?v=${cur}"`, `app.js?v=${next}"`));
console.log(`Version ${cur} → ${next}`);
