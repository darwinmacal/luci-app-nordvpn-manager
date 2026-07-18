'use strict';

String.prototype.format = function() {
	const values = Array.from(arguments);
	let index = 0;
	return this.replace(/%(\.(\d+))?([%sdf])/g, function(match, precision, digits, type) {
		if (type == '%') return '%';
		const value = values[index++];
		if (type == 'd') return String(Math.floor(Number(value || 0)));
		if (type == 'f') return Number(value || 0).toFixed(Number(digits || 0));
		return String(value == null ? '' : value);
	});
};

function append(parent, value) {
	if (value == null || value === false || value === '') return;
	if (Array.isArray(value)) return value.forEach(function(item) { append(parent, item); });
	parent.appendChild(value instanceof Node ? value : document.createTextNode(String(value)));
}

function E(tag, attrs, children) {
	if (Array.isArray(attrs) || attrs instanceof Node || typeof attrs == 'string') {
		children = attrs;
		attrs = {};
	}
	const node = document.createElement(tag);
	Object.entries(attrs || {}).forEach(function(entry) {
		const key = entry[0];
		const value = entry[1];
		if (value == null) return;
		if ([ 'click', 'change', 'input' ].indexOf(key) >= 0)
			node.addEventListener(key, value);
		else if (key == 'checked' || key == 'disabled' || key == 'selected')
			node[key] = !!value;
		else
			node.setAttribute(key, value);
	});
	append(node, children || []);
	return node;
}

const dom = { content: function(node, content) { node.replaceChildren(); append(node, content); } };
const poll = { add: function() {} };
const view = { extend: function(value) { return value; } };
const translations = window.__NVM_TRANSLATIONS || {};
const _ = function(value) { return translations[value] || value; };
const L = {
	bind: function(fn, context) { return fn.bind.apply(fn, [ context ].concat(Array.from(arguments).slice(2))); },
	resolveDefault: function(promise, fallback) { return Promise.resolve(promise).catch(function() { return fallback; }); },
	resource: function(path) { return '/htdocs/luci-static/resources/' + path; }
};

let managerState = {
	ok: true,
	state: {
		configured: true,
		enabled: true,
		desired_enabled: true,
		wan_network: 'wan',
		protected_network: 'vpnlan',
		protected_subnet: '172.20.20.0/24',
		wg_interface: 'wg_nord',
		vpn_zone: 'nordvpn',
		mtu: 1420,
		dns_mode: 'encrypted',
		dns_provider: 'quad9',
		killswitch_enabled: true,
		selected_server_id: 1001,
		selected_hostname: 'us1001.nordvpn.com',
		favorites: [ 1002 ]
	},
	runtime: { connected: true, pbr_running: true, dns_running: true, fallback: 'blocked', handshake_age: 18, health_failures: 0 },
	connection_state: 'connected',
	server: { id: 1001, hostname: 'us1001.nordvpn.com', station: '203.0.113.10', country_code: 'US', country_name: 'United States', city_name: 'Miami', groups: [ 11 ], load: 18 },
	peer: { endpoint: '203.0.113.10:51820', latest_handshake: 1, transfer_rx: 482938122, transfer_tx: 39211844 },
	account: { linked: true, ready: true, token_present: true, key_present: true, fingerprint: '4c91a2d5e780' },
	switch_guard: { count: 0, limit: 3, available: 3, min_wait: 0, window_wait: 0 },
	networks: [
		{ name: 'lan', proto: 'static', ipv4: '172.20.10.1', device: 'br-lan' },
		{ name: 'vpnlan', proto: 'static', ipv4: '172.20.20.1', device: 'br-vpnlan' },
		{ name: 'wan', proto: 'dhcp', ipv4: '198.51.100.20', device: 'wan' }
	]
};

const locations = {
	ok: true,
	countries: [
		{ id: 228, code: 'US', name: 'United States', cities: [ { id: 8787782, name: 'Miami' }, { id: 995503, name: 'New York' } ] },
		{ id: 140, code: 'MX', name: 'Mexico', cities: [ { id: 39165, name: 'Mexico City' } ] },
		{ id: 52, code: 'CR', name: 'Costa Rica', cities: [ { id: 155, name: 'San Jose' } ] }
	],
	categories: [
		{ key: 'standard', id: 11, name: 'Standard VPN servers' },
		{ key: 'p2p', id: 15, name: 'P2P' },
		{ key: 'double_vpn', id: 1, name: 'Double VPN' },
		{ key: 'onion', id: 3, name: 'Onion Over VPN' }
	]
};

const servers = [
	{ id: 1001, hostname: 'us1001.nordvpn.com', station: '203.0.113.10', country_name: 'United States', city_name: 'Miami', load: 18 },
	{ id: 1002, hostname: 'us1002.nordvpn.com', station: '203.0.113.11', country_name: 'United States', city_name: 'Miami', load: 24 },
	{ id: 1003, hostname: 'us1003.nordvpn.com', station: '203.0.113.12', country_name: 'United States', city_name: 'New York', load: 31 },
	{ id: 1004, hostname: 'mx1004.nordvpn.com', station: '203.0.113.13', country_name: 'Mexico', city_name: 'Mexico City', load: 36 }
];

function clone(value) { return JSON.parse(JSON.stringify(value)); }

const rpc = {
	declare: function(definition) {
		return function() {
			const args = Array.from(arguments);
			switch (definition.method) {
			case 'status': return Promise.resolve(clone(managerState));
			case 'locations': return Promise.resolve(clone(locations));
			case 'recommendations': return Promise.resolve({ ok: true, servers: clone(servers) });
			case 'preflight': return Promise.resolve({ ok: true, preflight: {} });
			case 'configure': managerState.state.configured = true; return Promise.resolve(clone(managerState));
			case 'set_killswitch':
				managerState.state.killswitch_enabled = args[0];
				managerState.runtime.fallback = args[0] ? 'blocked' : 'wan';
				return Promise.resolve(clone(managerState));
			case 'connect_server':
				managerState.state.selected_server_id = Number(args[0]);
				managerState.state.desired_enabled = true;
				managerState.connection_state = 'connected';
				return Promise.resolve(clone(managerState));
			case 'connect_recommended': case 'reconnect': return Promise.resolve(clone(managerState));
			case 'disconnect':
				managerState.state.desired_enabled = false;
				managerState.runtime.connected = false;
				managerState.connection_state = managerState.state.killswitch_enabled ? 'blocked' : 'direct';
				return Promise.resolve(clone(managerState));
			case 'set_favorite':
				managerState.state.favorites = args[1] ? [ Number(args[0]) ] : [];
				return Promise.resolve({ ok: true, favorites: clone(managerState.state.favorites) });
			case 'enroll': case 'refresh_credentials': return Promise.resolve({ ok: true, account: clone(managerState.account) });
			case 'unlink': managerState.account = { linked: false, ready: false }; return Promise.resolve(clone(managerState));
			case 'reset_configuration': managerState.state.configured = false; return Promise.resolve(clone(managerState));
			default: return Promise.resolve({ ok: true });
			}
		};
	}
};

const ui = {
	createHandlerFn: function(context, fn) {
		return function(event) { event.preventDefault(); return fn.call(context, event); };
	},
	showModal: function(title, children) {
		const panel = document.getElementById('modal-panel');
		panel.replaceChildren(E('h3', [ title ]));
		append(panel, children);
		document.getElementById('modal').classList.add('open');
	},
	hideModal: function() { document.getElementById('modal').classList.remove('open'); },
	addTimeLimitedNotification: function(unused, content) {
		const notice = E('div', { 'class': 'notice' }, [ content ]);
		document.body.appendChild(notice);
		setTimeout(function() { notice.remove(); }, 1200);
	}
};

fetch('/htdocs/luci-static/resources/view/nordvpn-manager/overview.js')
	.then(function(response) { return response.text(); })
	.then(function(source) {
		const factory = new Function('dom', 'poll', 'rpc', 'ui', 'view', 'L', 'E', '_', source);
		const component = factory(dom, poll, rpc, ui, view, L, E, _);
		window.nvmComponent = component;
		return component.load().then(function(data) {
			document.getElementById('app').appendChild(component.render(data));
		});
	});
