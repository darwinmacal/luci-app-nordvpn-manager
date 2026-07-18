#!/usr/bin/env ucode

'use strict';

import * as fs from 'fs';
import { cursor } from 'uci';

const CONFIG = 'nordvpn_manager';
const SECTION = 'main';
const CONTROLLER = '/usr/libexec/nordvpn-manager';
const API = '/usr/libexec/nordvpn-manager-api';
const ACTIVE_SERVER = '/etc/nordvpn-manager/active-server';
const HEALTH_DIR = '/tmp/nordvpn-manager-health';

function success(extra) {
	let result = { ok: true };
	for (let key in extra || {})
		result[key] = extra[key];
	return result;
}

function failure(message, extra) {
	let result = { ok: false, error: message };
	for (let key in extra || {})
		result[key] = extra[key];
	return result;
}

function clean_text(value, maxlen) {
	let text = trim(sprintf('%s', value || ''));
	text = join(' ', split(text, /[\r\n\t]+/));
	return substr(text, 0, maxlen || 96);
}

function error_text(value, fallback) {
	let text = clean_text(value, 240);
	return text || fallback;
}

function valid_number(value) {
	return match(sprintf('%s', value), /^[0-9]+$/) != null;
}

function valid_uci_name(value) {
	return type(value) == 'string' && match(value, /^[A-Za-z][A-Za-z0-9_]{0,31}$/) != null;
}

function valid_interface_name(value) {
	return type(value) == 'string' && match(value, /^[A-Za-z][A-Za-z0-9_]{0,14}$/) != null;
}

function valid_zone_name(value) {
	return type(value) == 'string' && match(value, /^[A-Za-z][A-Za-z0-9_-]{0,31}$/) != null;
}

function valid_ipv4(value) {
	if (type(value) != 'string')
		return false;
	let parts = split(value, '.');
	if (length(parts) != 4)
		return false;
	for (let part in parts)
		if (!match(part, /^[0-9]+$/) || int(part) < 0 || int(part) > 255)
			return false;
	return true;
}

function valid_bootstrap(value) {
	let items = split(value || '', ',');
	if (!length(items) || length(items) > 4)
		return false;
	for (let item in items)
		if (!valid_ipv4(trim(item)))
			return false;
	return true;
}

function valid_wireguard_key(value) {
	return type(value) == 'string' && length(value) == 44 &&
		match(value, /^[A-Za-z0-9+\/]{43}=$/) != null;
}

function run(command) {
	let pipe = fs.popen(command);
	if (!pipe)
		return { code: 127, stdout: '' };
	let stdout = pipe.read('all') || '';
	let code = pipe.close();
	return { code: code == null ? 127 : code, stdout };
}

function run_with_input(command, content) {
	let file = fs.mkstemp('/tmp/nordvpn-manager-rpc-XXXXXX');
	if (!file)
		return { code: 127, stdout: 'Unable to prepare the protected input channel' };
	file.write(content);
	file.flush();
	file.seek(0);
	let result = run(command + ' /dev/fd/' + file.fileno() + ' 2>&1');
	file.close();
	return result;
}

function parse_json(text) {
	try {
		return json(text || '');
	}
	catch (e) {
		return null;
	}
}

function parse_values(text) {
	let values = {};
	for (let line in split(text || '', '\n')) {
		let pos = index(line, '=');
		if (pos < 1)
			continue;
		let key = trim(substr(line, 0, pos));
		let value = trim(substr(line, pos + 1));
		if (match(key, /^[A-Za-z0-9_]+$/))
			values[key] = value;
	}
	return values;
}

function api_json(command) {
	let result = run(API + ' ' + command + ' 2>/dev/null');
	if (result.code != 0)
		return failure('Unable to contact the NordVPN API');
	let data = parse_json(result.stdout);
	if (data == null)
		return failure('NordVPN returned an invalid response');
	return success({ data });
}

function config_state() {
	let uci = cursor();
	uci.load(CONFIG);
	let get = (name, fallback) => uci.get(CONFIG, SECTION, name) || fallback;
	let favorites = uci.get(CONFIG, SECTION, 'favorites') || [];
	if (type(favorites) == 'string')
		favorites = [ favorites ];
	return {
		configured: get('configured', '0') == '1',
		enabled: get('enabled', '0') == '1',
		desired_enabled: get('desired_enabled', '0') == '1',
		wan_network: get('wan_network', 'wan'),
		protected_network: get('protected_network', ''),
		protected_subnet: get('protected_subnet', ''),
		wg_interface: get('wg_interface', 'wg_nord'),
		vpn_zone: get('vpn_zone', 'nordvpn'),
		mtu: int(get('mtu', '1420')) || 1420,
		dns_mode: get('dns_mode', 'encrypted'),
		dns_provider: get('dns_provider', 'quad9'),
		dns_custom_url: get('dns_custom_url', ''),
		dns_custom_bootstrap: get('dns_custom_bootstrap', ''),
		killswitch_enabled: get('killswitch_enabled', '1') == '1',
		selected_server_id: int(get('selected_server_id', '0')) || 0,
		selected_hostname: get('selected_hostname', ''),
		favorites: map(favorites, value => int(value || 0))
	};
}

function network_candidates() {
	let uci = cursor();
	let networks = [];
	uci.load('network');
	uci.foreach('network', 'interface', section => {
		let name = section['.name'] || '';
		if (!valid_uci_name(name) || name == 'loopback')
			return;
		let address = section.ipaddr || '';
		if (type(address) == 'array')
			address = address[0] || '';
		push(networks, {
			name,
			proto: clean_text(section.proto || '', 24),
			ipv4: clean_text(address, 48),
			device: clean_text(section.device || '', 48)
		});
	});
	sort(networks, (a, b) => a.name > b.name ? 1 : -1);
	return networks;
}

function account_status() {
	let result = api_json('status');
	if (!result.ok)
		return {
			ready: false,
			linked: false,
			token_present: false,
			key_present: false,
			source: 'none',
			enrolled_at: 0,
			fingerprint: ''
		};
	let data = result.data || {};
	return {
		ready: data.key_present == true,
		linked: data.key_present == true && data.token_present == true,
		token_present: data.token_present == true,
		key_present: data.key_present == true,
		source: clean_text(data.source || 'none', 16),
		enrolled_at: int(data.enrolled_at || 0),
		fingerprint: clean_text(data.fingerprint || '', 16)
	};
}

function active_server() {
	if (!fs.access(ACTIVE_SERVER, 'r'))
		return null;
	let values = parse_values(fs.readfile(ACTIVE_SERVER) || '');
	let id = int(values.server_id || 0);
	if (id <= 0 || !valid_ipv4(values.station || '') ||
	    !valid_wireguard_key(values.public_key || ''))
		return null;
	return {
		id,
		hostname: clean_text(values.hostname, 96),
		station: clean_text(values.station, 48),
		country_code: clean_text(values.country_code, 2),
		country_name: clean_text(values.country_name, 64),
		city_name: clean_text(values.city_name, 64),
		groups: map(split(values.groups || '', ','), value => int(value || 0)),
		load: int(values.load || 0) || 0
	};
}

function switch_status() {
	let result = run(CONTROLLER + ' switch-status 2>/dev/null');
	let values = result.code == 0 ? parse_values(result.stdout) : {};
	return {
		count: int(values.count || 0) || 0,
		limit: int(values.limit || 3) || 3,
		available: int(values.available || 0) || 0,
		min_wait: int(values.min_wait || 0) || 0,
		window_wait: int(values.window_wait || 0) || 0
	};
}

function peer_status(wg) {
	if (!valid_interface_name(wg))
		return {};
	let output = run('/usr/bin/wg show ' + wg + ' dump 2>/dev/null').stdout;
	for (let line in split(output || '', '\n')) {
		let fields = split(line, '\t');
		if (length(fields) < 8)
			continue;
		return {
			endpoint: clean_text(fields[2], 64),
			allowed_ips: clean_text(fields[3], 64),
			latest_handshake: int(fields[4] || 0) || 0,
			transfer_rx: int(fields[5] || 0) || 0,
			transfer_tx: int(fields[6] || 0) || 0,
			persistent_keepalive: int(fields[7] || 0) || 0
		};
	}
	return {};
}

function health_failures() {
	let value = trim(fs.readfile(HEALTH_DIR + '/failures') || '0');
	return valid_number(value) ? int(value) : 0;
}

function status_response() {
	let state = config_state();
	let result = run(CONTROLLER + ' status 2>/dev/null');
	let runtime = result.code == 0 ? parse_values(result.stdout) : {};
	let connected = runtime.connected == '1';
	let pbr = runtime.pbr_running == '1';
	let dns = state.dns_mode != 'encrypted' || runtime.dns_running == '1';
	let connection_state;

	if (state.desired_enabled && connected && pbr && dns)
		connection_state = 'connected';
	else if (state.desired_enabled && runtime.fallback == 'wan')
		connection_state = 'fallback';
	else if (state.desired_enabled)
		connection_state = 'reconnecting';
	else if (runtime.fallback == 'wan')
		connection_state = 'direct';
	else
		connection_state = 'blocked';

	return success({
		state,
		runtime: {
			connected,
			pbr_running: pbr,
			dns_running: runtime.dns_running == '1',
			fallback: clean_text(runtime.fallback || 'unknown', 16),
			handshake_age: int(runtime.handshake_age || 0) || 0,
			health_failures: health_failures()
		},
		connection_state,
		server: active_server(),
		peer: peer_status(state.wg_interface),
		account: account_status(),
		switch_guard: switch_status(),
		networks: network_candidates()
	});
}

function dynamic_server(raw, required_group) {
	if (type(raw) != 'object' || int(raw.id || 0) <= 0 || raw.status != 'online')
		return null;
	let hostname = clean_text(raw.hostname, 96);
	let station = clean_text(raw.station, 48);
	if (!match(hostname, /^[a-z0-9-]+\.nordvpn\.com$/) || !valid_ipv4(station))
		return null;

	let public_key = '';
	for (let technology in raw.technologies || []) {
		if (int(technology.id || 0) != 35 ||
		    (technology.pivot && technology.pivot.status != 'online'))
			continue;
		for (let metadata in technology.metadata || [])
			if (metadata.name == 'public_key')
				public_key = metadata.value || '';
	}
	if (!valid_wireguard_key(public_key))
		return null;

	let group_ids = [];
	let group_names = [];
	let has_required_group = required_group <= 0;
	for (let group in raw.groups || []) {
		let id = int(group.id || 0);
		if (id <= 0)
			continue;
		push(group_ids, id);
		push(group_names, clean_text(group.title || group.identifier, 48));
		if (id == required_group)
			has_required_group = true;
	}
	if (!has_required_group)
		return null;

	let location = (raw.locations || [])[0] || {};
	let country = location.country || {};
	let city = country.city || {};
	let load = int(raw.load || 0);
	if (load < 0 || load > 100)
		load = 0;
	return {
		id: int(raw.id),
		hostname,
		station,
		public_key,
		status: 'online',
		load,
		country_id: int(country.id || 0),
		country_code: clean_text(country.code, 2),
		country_name: clean_text(country.name, 64),
		city_id: int(city.id || 0),
		city_name: clean_text(city.name, 64),
		groups: group_ids,
		group_names
	};
}

function normalize_servers(raw, required_group) {
	let servers = [];
	let seen = {};
	if (type(raw) != 'array')
		return servers;
	for (let item in raw) {
		let server = dynamic_server(item, required_group || 0);
		if (!server || seen[server.id])
			continue;
		push(servers, server);
		seen[server.id] = true;
	}
	return servers;
}

function server_record(server) {
	return sprintf(
		'server_id=%d\nhostname=%s\nstation=%s\npublic_key=%s\ncountry_code=%s\ncountry_name=%s\ncity_name=%s\ngroups=%s\nload=%d\n',
		server.id,
		clean_text(server.hostname, 96),
		clean_text(server.station, 48),
		server.public_key,
		clean_text(server.country_code, 2),
		clean_text(server.country_name, 64),
		clean_text(server.city_name, 64),
		join(',', server.groups || []),
		server.load || 0
	);
}

function locations_response(force) {
	let countries_result = api_json('countries ' + (force ? '1' : '0'));
	if (!countries_result.ok)
		return countries_result;
	let groups_result = api_json('groups ' + (force ? '1' : '0'));
	if (!groups_result.ok)
		return groups_result;

	let countries = [];
	for (let country in countries_result.data || []) {
		let id = int(country.id || 0);
		let code = clean_text(country.code, 2);
		if (id <= 0 || !match(code, /^[A-Z]{2}$/))
			continue;
		let cities = [];
		for (let city in country.cities || []) {
			let city_id = int(city.id || 0);
			if (city_id <= 0)
				continue;
			push(cities, {
				id: city_id,
				name: clean_text(city.name, 64),
				server_count: int(city.serverCount || 0) || 0
			});
		}
		sort(cities, (a, b) => a.name > b.name ? 1 : -1);
		push(countries, {
			id,
			code,
			name: clean_text(country.name, 64),
			server_count: int(country.serverCount || 0) || 0,
			cities
		});
	}
	sort(countries, (a, b) => a.name > b.name ? 1 : -1);

	let wanted = {
		standard: 'legacy_standard',
		p2p: 'legacy_p2p',
		double_vpn: 'legacy_double_vpn',
		onion: 'legacy_onion_over_vpn'
	};
	let by_identifier = {};
	for (let group in groups_result.data || [])
		by_identifier[group.identifier || ''] = group;
	let categories = [];
	for (let key in [ 'standard', 'p2p', 'double_vpn', 'onion' ]) {
		let group = by_identifier[wanted[key]];
		if (!group || int(group.id || 0) <= 0)
			continue;
		push(categories, {
			key,
			id: int(group.id),
			identifier: clean_text(group.identifier, 64),
			name: clean_text(group.title, 64)
		});
	}
	return success({ countries, categories });
}

function recommendations_response(scope, location_id, group_id, force) {
	scope = scope || 'global';
	location_id = int(location_id || 0);
	group_id = int(group_id || 0);
	if (!match(scope, /^(global|country|city)$/) ||
	    (scope != 'global' && location_id <= 0) || group_id < 0)
		return failure('Invalid server filter');
	let result = api_json(sprintf('recommendations %s %d %d %d',
		scope, location_id, group_id, force ? 1 : 0));
	if (!result.ok)
		return result;
	let servers = normalize_servers(result.data, group_id);
	let state = config_state();
	let favorite_set = {};
	for (let id in state.favorites)
		favorite_set[id] = true;
	for (let i = 0; i < length(servers); i++) {
		servers[i].rank = i + 1;
		servers[i].favorite = favorite_set[servers[i].id] == true;
	}
	return success({ servers, scope, location_id, group_id });
}

function fetch_server(server_id) {
	server_id = int(server_id || 0);
	if (server_id <= 0)
		return failure('Invalid NordVPN server');
	let result = api_json('server ' + server_id + ' 1');
	if (!result.ok)
		return result;
	let servers = normalize_servers(result.data, 0);
	if (!length(servers) || servers[0].id != server_id)
		return failure('The selected server is no longer available for WireGuard');
	return success({ server: servers[0] });
}

function connect_server(server) {
	let result = run_with_input(CONTROLLER + ' connect-server', server_record(server));
	if (result.code != 0)
		return failure(error_text(result.stdout, 'Unable to establish the WireGuard connection'), { code: result.code });
	return status_response();
}

const methods = {
	status: {
		call: function() {
			return status_response();
		}
	},

	preflight: {
		args: { wan_network: 'String', protected_network: 'String' },
		call: function(request) {
			let args = request.args || request;
			if (!valid_uci_name(args.wan_network) || !valid_uci_name(args.protected_network))
				return failure('Invalid logical network name');
			let result = run(sprintf('%s preflight %s %s 2>&1', CONTROLLER,
				args.wan_network, args.protected_network));
			return result.code == 0
				? success({ preflight: parse_values(result.stdout) })
				: failure(error_text(result.stdout, 'Network preflight failed'), { code: result.code });
		}
	},

	configure: {
		args: {
			wan_network: 'String', protected_network: 'String', wg_interface: 'String',
			vpn_zone: 'String', mtu: 1420, dns_mode: 'String', dns_provider: 'String',
			dns_custom_url: 'String', dns_custom_bootstrap: 'String', killswitch_enabled: true
		},
		call: function(request) {
			let args = request.args || request;
			let wg = args.wg_interface || 'wg_nord';
			let zone = args.vpn_zone || 'nordvpn';
			let mtu = int(args.mtu || 1420);
			let dns_mode = args.dns_mode || 'encrypted';
			let provider = args.dns_provider || 'quad9';
			let custom_url = trim(args.dns_custom_url || '');
			let bootstrap = trim(args.dns_custom_bootstrap || '');
			if (!valid_uci_name(args.wan_network) || !valid_uci_name(args.protected_network) ||
			    !valid_interface_name(wg) || !valid_zone_name(zone) || mtu < 1280 || mtu > 1500 ||
			    !match(dns_mode, /^(encrypted|system)$/) ||
			    !match(provider, /^(quad9|cloudflare|google|adguard|custom)$/))
				return failure('Invalid manager configuration');
			if (provider == 'custom' &&
			    (!match(custom_url, /^https:\/\/[A-Za-z0-9._~:\/?&=%+\-]+$/) || !valid_bootstrap(bootstrap)))
				return failure('Invalid custom encrypted DNS provider');
			let content = sprintf(
				'wan_network=%s\nprotected_network=%s\nwg_interface=%s\nvpn_zone=%s\nmtu=%d\ndns_mode=%s\ndns_provider=%s\ndns_port=5053\ndns_custom_url=%s\ndns_custom_bootstrap=%s\nkillswitch_enabled=%d\n',
				args.wan_network, args.protected_network, wg, zone, mtu, dns_mode, provider,
				custom_url, bootstrap, args.killswitch_enabled == false ? 0 : 1
			);
			let result = run_with_input(CONTROLLER + ' configure', content);
			return result.code == 0
				? status_response()
				: failure(error_text(result.stdout, 'Unable to configure NordVPN Manager'), { code: result.code });
		}
	},

	account_status: {
		call: function() {
			return success({ account: account_status() });
		}
	},

	enroll: {
		args: { token: 'String' },
		call: function(request) {
			let token = trim(request.args ? request.args.token : request.token);
			if (!match(token, /^[A-Fa-f0-9]{64}$/))
				return failure('The access token must contain 64 hexadecimal characters');
			let result = run_with_input(API + ' enroll', token + '\n');
			token = null;
			return result.code == 0
				? success({ account: account_status() })
				: failure(error_text(result.stdout, 'Unable to link the NordVPN account'), { code: result.code });
		}
	},

	refresh_credentials: {
		call: function() {
			let result = run(API + ' refresh-credentials 2>&1');
			return result.code == 0
				? success({ account: account_status() })
				: failure(error_text(result.stdout, 'Unable to refresh NordLynx credentials'), { code: result.code });
		}
	},

	unlink: {
		call: function() {
			let result = run(CONTROLLER + ' unlink 2>&1');
			return result.code == 0
				? status_response()
				: failure(error_text(result.stdout, 'Unable to unlink the account'), { code: result.code });
		}
	},

	locations: {
		args: { force: false },
		call: function(request) {
			let force = request.args ? request.args.force : request.force;
			return locations_response(force == true);
		}
	},

	recommendations: {
		args: { scope: 'String', location_id: 0, group_id: 0, force: false },
		call: function(request) {
			let args = request.args || request;
			return recommendations_response(args.scope, args.location_id, args.group_id, args.force == true);
		}
	},

	connect_server: {
		args: { server_id: 0 },
		call: function(request) {
			let id = request.args ? request.args.server_id : request.server_id;
			let fetched = fetch_server(id);
			return fetched.ok ? connect_server(fetched.server) : fetched;
		}
	},

	connect_recommended: {
		args: { scope: 'String', location_id: 0, group_id: 0, force: false },
		call: function(request) {
			let args = request.args || request;
			let result = recommendations_response(args.scope, args.location_id, args.group_id, args.force == true);
			if (!result.ok)
				return result;
			if (!length(result.servers))
				return failure('NordVPN returned no compatible WireGuard servers');
			return connect_server(result.servers[0]);
		}
	},

	disconnect: {
		call: function() {
			let result = run(CONTROLLER + ' disconnect 2>&1');
			return result.code == 0
				? status_response()
				: failure(error_text(result.stdout, 'Unable to disconnect NordVPN'), { code: result.code });
		}
	},

	reconnect: {
		call: function() {
			let result = run(CONTROLLER + ' reconnect 2>&1');
			return result.code == 0
				? status_response()
				: failure(error_text(result.stdout, 'Unable to reconnect NordVPN'), { code: result.code });
		}
	},

	set_favorite: {
		args: { server_id: 0, favorite: false },
		call: function(request) {
			let args = request.args || request;
			let id = int(args.server_id || 0);
			if (id <= 0)
				return failure('Invalid NordVPN server');
			let result = run(sprintf('%s favorite %d %d 2>&1', CONTROLLER, id,
				args.favorite == true ? 1 : 0));
			return result.code == 0
				? success({ favorites: config_state().favorites })
				: failure(error_text(result.stdout, 'Unable to update favorites'), { code: result.code });
		}
	},

	set_killswitch: {
		args: { enabled: true },
		call: function(request) {
			let enabled = request.args ? request.args.enabled : request.enabled;
			let result = run(CONTROLLER + ' set-killswitch ' + (enabled == false ? '0' : '1') + ' 2>&1');
			return result.code == 0
				? status_response()
				: failure(error_text(result.stdout, 'Unable to update the kill switch'), { code: result.code });
		}
	},

	reset_configuration: {
		call: function() {
			let result = run(CONTROLLER + ' reset-configuration 2>&1');
			return result.code == 0
				? status_response()
				: failure(error_text(result.stdout, 'Unable to reset the manager'), { code: result.code });
		}
	}
};

return { 'luci.nordvpn_manager': methods };
