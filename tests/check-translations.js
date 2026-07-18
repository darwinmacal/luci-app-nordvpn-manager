'use strict';

const fs = require('fs');

const source = fs.readFileSync('htdocs/luci-static/resources/view/nordvpn-manager/overview.js', 'utf8');
const catalog = fs.readFileSync('po/es/nordvpn-manager.po', 'utf8');
const sourceIds = new Set();
const catalogIds = new Set();

for (const match of source.matchAll(/_\('((?:\\'|[^'])*)'\)/g))
	sourceIds.add(match[1].replace(/\\'/g, "'"));

for (const match of catalog.matchAll(/^msgid "(.*)"$/gm))
	if (match[1])
		catalogIds.add(match[1]);

const missing = Array.from(sourceIds).filter(value => !catalogIds.has(value));
if (missing.length) {
	console.error('Missing Spanish translations:');
	for (const value of missing)
		console.error('  ' + value);
	process.exit(1);
}

console.log(`Translation coverage: ${sourceIds.size}/${sourceIds.size}`);
