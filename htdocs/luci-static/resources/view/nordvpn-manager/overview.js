'use strict';
'require dom';
'require poll';
'require rpc';
'require ui';
'require view';

const callStatus = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'status'
});

const callPreflight = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'preflight',
	params: [ 'wan_network', 'protected_network' ]
});

const callConfigure = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'configure',
	params: [ 'wan_network', 'protected_network', 'wg_interface', 'vpn_zone', 'mtu',
		'dns_mode', 'dns_provider', 'dns_custom_url', 'dns_custom_bootstrap', 'killswitch_enabled' ]
});

const callEnroll = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'enroll',
	params: [ 'token' ]
});

const callRefreshCredentials = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'refresh_credentials'
});

const callUnlink = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'unlink'
});

const callLocations = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'locations',
	params: [ 'force' ]
});

const callRecommendations = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'recommendations',
	params: [ 'scope', 'location_id', 'group_id', 'force' ]
});

const callConnectServer = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'connect_server',
	params: [ 'server_id' ]
});

const callConnectRecommended = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'connect_recommended',
	params: [ 'scope', 'location_id', 'group_id', 'force' ]
});

const callDisconnect = rpc.declare({ object: 'luci.nordvpn_manager', method: 'disconnect' });
const callReconnect = rpc.declare({ object: 'luci.nordvpn_manager', method: 'reconnect' });

const callSetFavorite = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'set_favorite',
	params: [ 'server_id', 'favorite' ]
});

const callSetKillswitch = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'set_killswitch',
	params: [ 'enabled' ]
});

const callResetConfiguration = rpc.declare({
	object: 'luci.nordvpn_manager',
	method: 'reset_configuration'
});

const STATE_LABELS = {
	connected: _('Connected'),
	fallback: _('Fallback WAN'),
	reconnecting: _('Reconnecting'),
	direct: _('Direct Internet'),
	blocked: _('Blocked')
};

const CATEGORY_LABELS = {
	standard: _('Standard'),
	p2p: _('P2P'),
	double_vpn: _('Double VPN'),
	onion: _('Onion over VPN')
};

function numberValue(value) {
	value = Number(value || 0);
	return Number.isFinite(value) ? value : 0;
}

function formatBytes(value) {
	value = numberValue(value);
	if (value >= 1073741824)
		return '%.2f GB'.format(value / 1073741824);
	if (value >= 1048576)
		return '%.2f MB'.format(value / 1048576);
	if (value >= 1024)
		return '%.2f KB'.format(value / 1024);
	return '%d B'.format(value);
}

function formatRate(value) {
	return _('%s/s').format(formatBytes(value));
}

function formatDuration(value) {
	value = Math.max(0, Math.floor(numberValue(value)));
	if (value < 60)
		return _('%ds').format(value);
	if (value < 3600)
		return _('%dm %ds').format(Math.floor(value / 60), value % 60);
	return _('%dh %dm').format(Math.floor(value / 3600), Math.floor((value % 3600) / 60));
}

function statusClass(state) {
	return [ 'connected', 'direct' ].indexOf(state) >= 0 ? 'good' :
		(state == 'fallback' ? 'warning' : (state == 'blocked' ? 'bad' : 'idle'));
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callStatus(), { ok: false, state: {}, networks: [] }),
			L.resolveDefault(callLocations(false), { ok: false, countries: [], categories: [] })
		]);
	},

	ensureStyles: function() {
		if (document.getElementById('nordvpn-manager-styles'))
			return;
		document.head.appendChild(E('link', {
			'id': 'nordvpn-manager-styles',
			'rel': 'stylesheet',
			'href': L.resource('view/nordvpn-manager/overview.css') + '?v=0.1.0-r9'
		}));
	},

	notify: function(message, type) {
		ui.addTimeLimitedNotification(null, E('p', [ message ]), 5000, type || 'info');
	},

	setBusy: function(busy, label) {
		this.busy = busy;
		this.busyLabel = label || '';
		if (this.root)
			this.root.setAttribute('aria-busy', busy ? 'true' : 'false');
		this.updateControls();
	},

	runAction: function(label, promise, successMessage) {
		if (this.busy)
			return Promise.resolve();
		this.setBusy(true, label);
		return promise.then(L.bind(function(result) {
			if (!result || result.ok === false)
				throw new Error((result && result.error) || _('The operation could not be completed'));
			if (result.state)
				this.applyStatus(result);
			if (successMessage)
				this.notify(successMessage, 'success');
		}, this)).catch(L.bind(function(error) {
			this.notify(error.message || _('The operation could not be completed'), 'danger');
		}, this)).then(L.bind(function() {
			this.setBusy(false, '');
			return this.refreshStatus();
		}, this));
	},

	refreshStatus: function() {
		if (this.busy)
			return Promise.resolve();
		return L.resolveDefault(callStatus(), null).then(L.bind(function(status) {
			if (status && status.ok !== false)
				this.applyStatus(status);
		}, this));
	},

	dynamicFilter: function() {
		if (this.selectedCity > 0)
			return { scope: 'city', locationId: this.selectedCity, groupId: this.selectedGroup };
		if (this.selectedCountry > 0)
			return { scope: 'country', locationId: this.selectedCountry, groupId: this.selectedGroup };
		return { scope: 'global', locationId: 0, groupId: this.selectedGroup };
	},

	cooldownWait: function() {
		const guard = (this.status && this.status.switch_guard) || {};
		return Math.max(numberValue(guard.min_wait), numberValue(guard.window_wait));
	},

	refreshRecommendations: function(force) {
		if (this.catalogBusy)
			return Promise.resolve();
		const filter = this.dynamicFilter();
		this.catalogBusy = true;
		this.updateControls();
		this.renderServers();
		return L.resolveDefault(callRecommendations(
			filter.scope, filter.locationId, filter.groupId, force == true
		), null).then(L.bind(function(result) {
			if (!result || result.ok === false)
				throw new Error((result && result.error) || _('Unable to load NordVPN servers'));
			this.servers = result.servers || [];
			this.catalogLoaded = true;
			if (!this.servers.some(L.bind(function(server) {
				return Number(server.id) == this.selectedServer;
			}, this)))
				this.selectedServer = this.servers.length ? Number(this.servers[0].id) : 0;
		}, this)).catch(L.bind(function(error) {
			this.notify(error.message || _('Unable to load NordVPN servers'), 'danger');
		}, this)).then(L.bind(function() {
			this.catalogBusy = false;
			this.updateControls();
			this.renderServers();
		}, this));
	},

	connectSelected: function() {
		if (!this.selectedServer)
			return this.notify(_('Select a server first'), 'warning');
		const state = (this.status && this.status.state) || {};
		const same = Number(state.selected_server_id) == this.selectedServer;
		return this.runAction(
			'connect',
			same ? callReconnect() : callConnectServer(this.selectedServer),
			same ? _('VPN reconnected') : _('VPN connected')
		);
	},

	selectServer: function(id) {
		if (this.busy)
			return;
		const state = (this.status && this.status.state) || {};
		const activeId = Number(state.selected_server_id || 0);
		if (state.desired_enabled && id != activeId) {
			const wait = this.cooldownWait();
			if (wait > 0)
				return this.notify(_('Next server change in %s').format(formatDuration(wait)), 'warning');
			if (!(this.account && this.account.linked))
				return this.notify(_('Link your NordVPN account first'), 'warning');
			this.selectedServer = id;
			this.renderServers();
			this.updateControls();
			return this.runAction('connect', callConnectServer(id), _('VPN connected'));
		}
		this.selectedServer = id;
		this.renderServers();
		this.updateControls();
	},

	connectFastest: function() {
		const filter = this.dynamicFilter();
		return this.runAction('connect', callConnectRecommended(
			filter.scope, filter.locationId, filter.groupId, false
		), _('Recommended server connected'));
	},

	confirmDisconnect: function() {
		if (this.busy)
			return;
		const kill = !!(this.status && this.status.state && this.status.state.killswitch_enabled);
		ui.showModal(_('Disconnect NordVPN'), [
			E('p', [ kill ?
				_('The protected network will remain blocked until the VPN reconnects.') :
				_('The protected network will use the direct ISP connection.') ]),
			E('div', { 'class': 'right nvm-modal-actions' }, [
				E('button', {
					'class': 'btn cbi-button',
					'click': ui.createHandlerFn(this, function() { ui.hideModal(); })
				}, [ _('Cancel') ]),
				E('button', {
					'class': 'btn cbi-button cbi-button-negative',
					'click': ui.createHandlerFn(this, function() {
						ui.hideModal();
						return this.runAction('disconnect', callDisconnect(), _('VPN disconnected'));
					})
				}, [ _('Disconnect') ])
			])
		]);
	},

	toggleConnection: function(event) {
		const state = (this.status && this.status.state) || {};
		if (this.busy) {
			event.target.checked = !!state.desired_enabled;
			return;
		}
		if (!event.target.checked) {
			event.target.checked = true;
			return this.confirmDisconnect();
		}
		if (!(this.account && this.account.linked)) {
			event.target.checked = false;
			return this.notify(_('Link your NordVPN account first'), 'warning');
		}
		if (!this.selectedServer) {
			event.target.checked = false;
			return this.notify(_('Select a server first'), 'warning');
		}
		const wait = this.cooldownWait();
		if (wait > 0) {
			event.target.checked = false;
			return this.notify(_('Next server change in %s').format(formatDuration(wait)), 'warning');
		}
		return this.connectSelected();
	},

	toggleKillswitch: function(event) {
		const desired = event.target.checked;
		const restore = L.bind(function() {
			event.target.checked = !desired;
		}, this);
		if (desired)
			return this.runAction('killswitch', callSetKillswitch(true), _('Kill switch enabled'));

		ui.showModal(_('Disable kill switch'), [
			E('p', [ _('If WireGuard stops, the protected network may access the Internet directly through your ISP.') ]),
			E('div', { 'class': 'right nvm-modal-actions' }, [
				E('button', {
					'class': 'btn cbi-button',
					'click': ui.createHandlerFn(this, function() {
						restore();
						ui.hideModal();
					})
				}, [ _('Keep enabled') ]),
				E('button', {
					'class': 'btn cbi-button cbi-button-negative',
					'click': ui.createHandlerFn(this, function() {
						ui.hideModal();
						return this.runAction('killswitch', callSetKillswitch(false), _('Kill switch disabled'));
					})
				}, [ _('Disable') ])
			])
		]);
	},

	showEnrollModal: function() {
		if (this.busy)
			return;
		if (window.location.protocol !== 'https:') {
			this.notify(_('Open LuCI over HTTPS before entering a NordVPN token'), 'danger');
			return;
		}
		const input = E('input', {
			'class': 'cbi-input-password nvm-token-input',
			'type': 'password',
			'placeholder': _('64-character access token'),
			'autocomplete': 'new-password',
			'autocapitalize': 'off',
			'spellcheck': 'false',
			'maxlength': '64'
		});
		ui.showModal(_('Link NordVPN account'), [
			E('p', [
				_('Use a token generated in Nord Account.'), ' ',
				E('a', {
					'href': 'https://support.nordvpn.com/hc/en-us/articles/45535038276753-How-to-generate-a-NordVPN-login-token-to-connect-to-a-VPN-server-on-a-router',
					'target': '_blank',
					'rel': 'noreferrer noopener'
				}, [ _('Generate token') ])
			]),
			input,
			E('div', { 'class': 'right nvm-modal-actions' }, [
				E('button', {
					'class': 'btn cbi-button',
					'click': ui.createHandlerFn(this, function() {
						input.value = '';
						ui.hideModal();
					})
				}, [ _('Cancel') ]),
				E('button', {
					'class': 'btn cbi-button cbi-button-positive',
					'click': ui.createHandlerFn(this, function() {
						let token = String(input.value || '').trim();
						if (!/^[A-Fa-f0-9]{64}$/.test(token)) {
							this.notify(_('The token must contain 64 hexadecimal characters'), 'warning');
							return;
						}
						input.value = '';
						ui.hideModal();
						const request = callEnroll(token);
						token = '';
						return this.runAction('enroll', request, _('NordVPN account linked'));
					})
				}, [ _('Link account') ])
			])
		]);
		window.setTimeout(function() { input.focus(); }, 0);
	},

	confirmUnlink: function() {
		ui.showModal(_('Unlink NordVPN account'), [
			E('p', [ _('The VPN will disconnect and the stored token and NordLynx key will be removed.') ]),
			E('div', { 'class': 'right nvm-modal-actions' }, [
				E('button', {
					'class': 'btn cbi-button',
					'click': ui.createHandlerFn(this, function() { ui.hideModal(); })
				}, [ _('Cancel') ]),
				E('button', {
					'class': 'btn cbi-button cbi-button-negative',
					'click': ui.createHandlerFn(this, function() {
						ui.hideModal();
						return this.runAction('unlink', callUnlink(), _('NordVPN account unlinked'));
					})
				}, [ _('Unlink') ])
			])
		]);
	},

	setFavorite: function(serverId, favorite) {
		if (this.busy)
			return;
		return callSetFavorite(serverId, favorite).then(L.bind(function(result) {
			if (!result || result.ok === false)
				throw new Error((result && result.error) || _('Unable to update favorites'));
			this.favorites = new Set((result.favorites || []).map(Number));
			this.renderServers();
		}, this)).catch(L.bind(function(error) {
			this.notify(error.message || _('Unable to update favorites'), 'danger');
		}, this));
	},

	updateLocationControls: function() {
		if (!this.nodes || !this.nodes.country)
			return;
		const countryOptions = [ E('option', { 'value': '0' }, [ _('All countries') ]) ];
		(this.locations.countries || []).forEach(function(country) {
			countryOptions.push(E('option', { 'value': String(country.id) }, [ country.name ]));
		});
		dom.content(this.nodes.country, countryOptions);
		this.nodes.country.value = String(this.selectedCountry || 0);

		const country = (this.locations.countries || []).find(L.bind(function(item) {
			return Number(item.id) == this.selectedCountry;
		}, this));
		const cityOptions = [ E('option', { 'value': '0' }, [ country ? _('All cities') : _('Any city') ]) ];
		(country && country.cities || []).forEach(function(city) {
			cityOptions.push(E('option', { 'value': String(city.id) }, [ city.name ]));
		});
		dom.content(this.nodes.city, cityOptions);
		if (!country || !(country.cities || []).some(L.bind(function(city) {
			return Number(city.id) == this.selectedCity;
		}, this)))
			this.selectedCity = 0;
		this.nodes.city.value = String(this.selectedCity || 0);

		const categoryOptions = (this.locations.categories || []).map(function(category) {
			return E('option', { 'value': String(category.id) }, [ CATEGORY_LABELS[category.key] || category.name ]);
		});
		dom.content(this.nodes.category, categoryOptions);
		if (!(this.locations.categories || []).some(L.bind(function(category) {
			return Number(category.id) == this.selectedGroup;
		}, this)))
			this.selectedGroup = this.locations.categories.length ? Number(this.locations.categories[0].id) : 0;
		this.nodes.category.value = String(this.selectedGroup || 0);
	},

	renderServers: function() {
		if (!this.nodes || !this.nodes.serverRows)
			return;
		if (this.catalogBusy) {
			dom.content(this.nodes.serverRows, E('div', { 'class': 'nvm-empty' }, [ _('Loading available servers...') ]));
			this.nodes.serverCount.textContent = _('Searching');
			return;
		}
		let servers = this.servers || [];
		if (this.showFavorites)
			servers = servers.filter(L.bind(function(server) { return this.favorites.has(Number(server.id)); }, this));
		this.nodes.serverCount.textContent = _('%d servers').format(servers.length);
		if (!servers.length) {
			dom.content(this.nodes.serverRows, E('div', { 'class': 'nvm-empty' }, [
				this.catalogLoaded ? _('No compatible servers match this filter.') : _('Choose a location to load servers.')
			]));
			return;
		}

		const activeId = Number(this.status && this.status.state && this.status.state.selected_server_id || 0);
		const rows = servers.map(L.bind(function(server) {
			const id = Number(server.id);
			const selected = id == this.selectedServer;
			const active = id == activeId && !!(this.status && this.status.state && this.status.state.desired_enabled);
			const favorite = this.favorites.has(id);
			return E('div', {
				'class': 'nvm-server-row' + (selected ? ' is-selected' : '') + (active ? ' is-active' : '')
			}, [
				E('button', {
					'class': 'nvm-server-select',
					'disabled': this.busy ? 'disabled' : null,
					'click': L.bind(function() { return this.selectServer(id); }, this)
				}, [
					E('span', { 'class': 'nvm-server-name' }, [ server.hostname ]),
					E('span', { 'class': 'nvm-server-location' }, [
						[ server.city_name, server.country_name ].filter(Boolean).join(', ') || _('Unknown location')
					]),
					E('span', { 'class': 'nvm-server-load' }, [ _('%d%% load').format(numberValue(server.load)) ]),
					active ? E('span', { 'class': 'nvm-active-label' }, [ _('Active') ]) : ''
				]),
				E('button', {
					'class': 'nvm-favorite' + (favorite ? ' is-favorite' : ''),
					'title': favorite ? _('Remove from favorites') : _('Add to favorites'),
					'aria-label': favorite ? _('Remove from favorites') : _('Add to favorites'),
					'disabled': this.busy ? 'disabled' : null,
					'click': L.bind(function() { return this.setFavorite(id, !favorite); }, this)
				}, [ favorite ? '★' : '☆' ])
			]);
		}, this));
		dom.content(this.nodes.serverRows, rows);
	},

	metric: function(label, key) {
		return E('div', { 'class': 'nvm-metric' }, [
			E('span', { 'class': 'nvm-metric-label' }, [ label ]),
			E('strong', { 'id': 'nvm-' + key }, [ '-' ])
		]);
	},

	routeNode: function(key, label) {
		return E('div', { 'class': 'nvm-route-node idle', 'id': 'nvm-route-' + key }, [
			E('span', { 'class': 'nvm-route-dot', 'aria-hidden': 'true' }),
			E('span', { 'class': 'nvm-route-label' }, [ label ]),
			E('strong', { 'class': 'nvm-route-value' }, [ _('Waiting') ])
		]);
	},

	setRouteNode: function(key, value, tone) {
		const node = this.nodes['route_' + key];
		if (!node)
			return;
		node.className = 'nvm-route-node ' + tone;
		node.querySelector('.nvm-route-value').textContent = value;
	},

	applyStatus: function(status) {
		this.status = status;
		this.account = status.account || {};
		this.favorites = new Set(((status.state && status.state.favorites) || []).map(Number));
		if (!this.selectedServer && status.state)
			this.selectedServer = Number(status.state.selected_server_id || 0);
		if (!status.state)
			return;
		if (this.viewConfigured !== !!status.state.configured) {
			this.renderCurrentView();
			return;
		}
		if (!this.nodes || !this.nodes.stateBadge)
			return;

		const state = status.state;
		const runtime = status.runtime || {};
		const peer = status.peer || {};
		const server = status.server || {};
		const connection = status.connection_state || 'blocked';
		const label = STATE_LABELS[connection] || STATE_LABELS.blocked;
		this.nodes.stateBadge.className = 'nvm-state-badge ' + statusClass(connection);
		this.nodes.stateBadge.textContent = this.busy ? _('Working') : label;
		this.nodes.stateTitle.textContent = label;
		this.nodes.stateDetail.textContent = server.hostname || _('No server selected');
		this.nodes.connectionInput.checked = !!state.desired_enabled;
		this.nodes.connectionValue.textContent = state.desired_enabled ? _('Enabled') : _('Disabled');
		this.nodes.killInput.checked = !!state.killswitch_enabled;
		this.nodes.killValue.textContent = state.killswitch_enabled ? _('Enabled') : _('Disabled');
		this.nodes.accountValue.textContent = this.account.linked ? _('Linked') : _('Not linked');
		this.nodes.accountDetail.textContent = this.account.linked ?
			(_('NordLynx key %s').format(this.account.fingerprint || '-')) : _('Token required');

		this.nodes.serverMetric.textContent = server.hostname || '-';
		this.nodes.locationMetric.textContent = [ server.city_name, server.country_name ].filter(Boolean).join(', ') || '-';
		this.nodes.endpointMetric.textContent = peer.endpoint || server.station || '-';
		this.nodes.handshakeMetric.textContent = runtime.connected ?
			_('%s ago').format(formatDuration(runtime.handshake_age)) : _('No handshake');
		this.nodes.receivedMetric.textContent = formatBytes(peer.transfer_rx);
		this.nodes.sentMetric.textContent = formatBytes(peer.transfer_tx);

		const now = Date.now();
		let rx = 0;
		let tx = 0;
		if (this.lastTransfer && now > this.lastTransfer.at) {
			const elapsed = (now - this.lastTransfer.at) / 1000;
			rx = Math.max(0, numberValue(peer.transfer_rx) - this.lastTransfer.rx) / elapsed;
			tx = Math.max(0, numberValue(peer.transfer_tx) - this.lastTransfer.tx) / elapsed;
		}
		this.lastTransfer = { at: now, rx: numberValue(peer.transfer_rx), tx: numberValue(peer.transfer_tx) };
		this.nodes.rxRate.textContent = formatRate(rx);
		this.nodes.txRate.textContent = formatRate(tx);

		this.setRouteNode('lan', state.protected_network || _('Protected LAN'), 'good');
		this.setRouteNode('dns', state.dns_mode == 'encrypted' ?
			(runtime.dns_running ? _('Encrypted') : _('Unavailable')) : _('System DNS'),
			state.dns_mode != 'encrypted' ? 'idle' : (runtime.dns_running ? 'dns' : 'bad'));
		this.setRouteNode('tunnel', runtime.connected ? _('WireGuard') : _('Offline'), runtime.connected ? 'good' : 'bad');
		this.setRouteNode('exit', label, statusClass(connection));

		const wait = this.cooldownWait();
		this.nodes.switchGuard.textContent = wait > 0 ?
			_('Next server change in %s').format(formatDuration(wait)) :
			_('%d of %d server changes available').format(
				numberValue(status.switch_guard && status.switch_guard.available),
				numberValue(status.switch_guard && status.switch_guard.limit)
			);
		this.renderServers();
		this.updateControls();
	},

	updateControls: function() {
		if (!this.nodes || !this.nodes.connectionInput)
			return;
		const state = (this.status && this.status.state) || {};
		const linked = !!(this.account && this.account.linked);
		const wait = this.cooldownWait();
		this.nodes.connectionInput.disabled = this.busy || (!state.desired_enabled &&
			(this.catalogBusy || !linked || !this.selectedServer || wait > 0));
		this.nodes.fastest.disabled = this.busy || this.catalogBusy || !linked || !this.selectedGroup || wait > 0;
		this.nodes.refreshServers.disabled = this.busy || this.catalogBusy;
		this.nodes.killInput.disabled = this.busy || !state.configured;
		this.nodes.link.disabled = this.busy;
		this.nodes.refreshKey.disabled = this.busy || !linked;
		this.nodes.unlink.disabled = this.busy || !(this.account && (this.account.token_present || this.account.key_present));
		this.nodes.settings.disabled = this.busy || !!state.desired_enabled;
		this.nodes.reset.disabled = this.busy || !!state.desired_enabled;
		this.nodes.country.disabled = this.busy || this.catalogBusy;
		this.nodes.city.disabled = this.busy || this.catalogBusy || !this.selectedCountry;
		this.nodes.category.disabled = this.busy || this.catalogBusy;
	},

	networkOptions: function(selected) {
		return ((this.status && this.status.networks) || []).map(function(network) {
			return E('option', {
				'value': network.name,
				'selected': network.name == selected ? 'selected' : null
			}, [ network.name + (network.ipv4 ? ' - ' + network.ipv4 : '') ]);
		});
	},

	settingsForm: function(initial) {
		const state = initial || {};
		const networks = (this.status && this.status.networks) || [];
		const wanName = state.wan_network || 'wan';
		let protectedName = state.protected_network || '';
		if (!protectedName) {
			const candidate = networks.find(function(network) {
				return network.name != wanName && network.proto == 'static';
			});
			protectedName = candidate ? candidate.name : '';
		}
		const wan = E('select', { 'class': 'cbi-input-select' }, this.networkOptions(wanName));
		const protectedNetwork = E('select', { 'class': 'cbi-input-select' }, this.networkOptions(protectedName));
		const mtu = E('input', {
			'class': 'cbi-input-text', 'type': 'number', 'min': '1280', 'max': '1500',
			'value': String(state.mtu || 1420)
		});
		const encrypted = E('input', { 'type': 'checkbox', 'checked': state.dns_mode != 'system' ? 'checked' : null });
		const provider = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'quad9' }, [ 'Quad9' ]),
			E('option', { 'value': 'cloudflare' }, [ 'Cloudflare' ]),
			E('option', { 'value': 'google' }, [ 'Google' ]),
			E('option', { 'value': 'adguard' }, [ 'AdGuard DNS' ]),
			E('option', { 'value': 'custom' }, [ _('Custom') ])
		]);
		provider.value = state.dns_provider || 'quad9';
		const customUrl = E('input', {
			'class': 'cbi-input-text', 'type': 'url', 'placeholder': 'https://dns.example/dns-query',
			'value': state.dns_custom_url || ''
		});
		const bootstrap = E('input', {
			'class': 'cbi-input-text', 'type': 'text', 'placeholder': '9.9.9.9,149.112.112.112',
			'value': state.dns_custom_bootstrap || ''
		});
		const kill = E('input', { 'type': 'checkbox', 'checked': state.killswitch_enabled !== false ? 'checked' : null });
		const customFields = E('div', { 'class': 'nvm-custom-dns' }, [
			this.formRow(_('DoH URL'), customUrl),
			this.formRow(_('Bootstrap DNS'), bootstrap)
		]);
		const syncDns = function() {
			provider.disabled = !encrypted.checked;
			customFields.hidden = !encrypted.checked || provider.value != 'custom';
		};
		encrypted.addEventListener('change', syncDns);
		provider.addEventListener('change', syncDns);
		syncDns();

		const save = E('button', {
			'class': 'btn cbi-button cbi-button-positive',
			'click': ui.createHandlerFn(this, function() {
				if (!wan.value || !protectedNetwork.value || wan.value == protectedNetwork.value) {
					this.notify(_('Select two different logical networks'), 'warning');
					return;
				}
				const configure = L.bind(function() {
					return callConfigure(
						wan.value, protectedNetwork.value, 'wg_nord', 'nordvpn', Number(mtu.value || 1420),
						encrypted.checked ? 'encrypted' : 'system', provider.value,
						customUrl.value.trim(), bootstrap.value.trim(), kill.checked
					);
				}, this);
				this.setBusy(true, _('Configuring'));
				return callPreflight(wan.value, protectedNetwork.value).then(function(result) {
					if (!result || result.ok === false)
						throw new Error((result && result.error) || _('Network preflight failed'));
					return configure();
				}).then(L.bind(function(result) {
					if (!result || result.ok === false)
						throw new Error((result && result.error) || _('Unable to save the configuration'));
					const alreadyConfigured = this.viewConfigured;
					this.settingsOpen = false;
					this.applyStatus(result);
					if (alreadyConfigured)
						this.renderCurrentView();
					this.notify(_('NordVPN Manager configured'), 'success');
				}, this)).catch(L.bind(function(error) {
					this.notify(error.message || _('Unable to save the configuration'), 'danger');
				}, this)).then(L.bind(function() {
					this.setBusy(false, '');
					return this.refreshStatus();
				}, this));
			})
		}, [ state.configured ? _('Save changes') : _('Configure manager') ]);

		return E('div', { 'class': 'nvm-settings-form' }, [
			E('div', { 'class': 'nvm-form-grid' }, [
				this.formRow(_('WAN logical network'), wan),
				this.formRow(_('Protected logical network'), protectedNetwork),
				this.formRow(_('WireGuard MTU'), mtu),
				this.formRow(_('Encrypted DNS'), encrypted, 'compact'),
				this.formRow(_('DNS provider'), provider),
				this.formRow(_('Kill switch by default'), kill, 'compact')
			]),
			customFields,
			E('div', { 'class': 'nvm-form-actions' }, [ save ])
		]);
	},

	formRow: function(label, control, className) {
		return E('label', { 'class': 'nvm-form-row ' + (className || '') }, [
			E('span', { 'class': 'nvm-form-label' }, [ label ]),
			control
		]);
	},

	confirmReset: function() {
		ui.showModal(_('Reset NordVPN Manager'), [
			E('p', [ _('Managed firewall, PBR, DNS and WireGuard sections will be removed. Account credentials will also be deleted.') ]),
			E('div', { 'class': 'right nvm-modal-actions' }, [
				E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(this, function() { ui.hideModal(); }) }, [ _('Cancel') ]),
				E('button', {
					'class': 'btn cbi-button cbi-button-negative',
					'click': ui.createHandlerFn(this, function() {
						ui.hideModal();
						return this.runAction('reset', callResetConfiguration(), _('NordVPN Manager reset'));
					})
				}, [ _('Reset') ])
			])
		]);
	},

	renderCurrentView: function() {
		if (!this.root)
			return;
		this.viewConfigured = !!(this.status && this.status.state && this.status.state.configured);
		if (!this.viewConfigured) {
			dom.content(this.nodes.content, E('section', { 'class': 'nvm-onboarding' }, [
				E('div', { 'class': 'nvm-section-head' }, [
					E('div', [ E('h3', [ _('Initial setup') ]), E('p', [ _('Choose the logical networks this manager will use.') ]) ])
				]),
				this.settingsForm(this.status.state || {})
			]));
			return;
		}
		dom.content(this.nodes.content, this.dashboardContent());
		this.captureNodes();
		this.updateLocationControls();
		this.applyStatus(this.status);
		window.setTimeout(L.bind(function() { this.refreshRecommendations(false); }, this), 0);
	},

	dashboardContent: function() {
		const connectionInput = E('input', {
			'id': 'nvm-connection-toggle',
			'type': 'checkbox', 'role': 'switch', 'aria-label': _('VPN connection'),
			'change': L.bind(this.toggleConnection, this)
		});
		const killInput = E('input', {
			'id': 'nvm-kill-toggle',
			'type': 'checkbox', 'role': 'switch', 'aria-label': _('Kill switch'),
			'change': L.bind(this.toggleKillswitch, this)
		});
		const country = E('select', {
			'id': 'nvm-country',
			'class': 'cbi-input-select',
			'change': L.bind(function(event) {
				this.selectedCountry = Number(event.target.value || 0);
				this.selectedCity = 0;
				this.updateLocationControls();
				return this.refreshRecommendations(false);
			}, this)
		});
		const city = E('select', {
			'id': 'nvm-city',
			'class': 'cbi-input-select',
			'change': L.bind(function(event) {
				this.selectedCity = Number(event.target.value || 0);
				return this.refreshRecommendations(false);
			}, this)
		});
		const category = E('select', {
			'id': 'nvm-category',
			'class': 'cbi-input-select',
			'change': L.bind(function(event) {
				this.selectedGroup = Number(event.target.value || 0);
				return this.refreshRecommendations(false);
			}, this)
		});

		return E('div', { 'class': 'nvm-dashboard-content' }, [
			E('section', { 'class': 'nvm-status-band', 'aria-label': _('Connection status') }, [
				E('div', { 'class': 'nvm-state-copy' }, [
					E('span', { 'class': 'nvm-state-badge idle', 'id': 'nvm-state-badge' }, [ _('Checking') ]),
					E('h3', { 'id': 'nvm-state-title' }, [ _('Checking') ]),
					E('span', { 'id': 'nvm-state-detail' }, [ '-' ])
				]),
				E('div', { 'class': 'nvm-connection-control' }, [
					E('div', { 'class': 'nvm-connection-copy' }, [
						E('strong', [ _('VPN connection') ]),
						E('span', { 'id': 'nvm-connection-value' }, [ _('Enabled') ])
					]),
					E('label', { 'class': 'nvm-switch', 'for': 'nvm-connection-toggle' }, [
						connectionInput,
						E('span', { 'class': 'nvm-switch-track', 'aria-hidden': 'true' }, [
							E('span', { 'class': 'nvm-switch-knob' })
						])
					])
				])
			]),

			E('section', { 'class': 'nvm-route', 'aria-label': _('Traffic path') }, [
				this.routeNode('lan', _('Protected LAN')),
				E('span', { 'class': 'nvm-route-line', 'aria-hidden': 'true' }),
				this.routeNode('dns', _('DNS')),
				E('span', { 'class': 'nvm-route-line', 'aria-hidden': 'true' }),
				this.routeNode('tunnel', _('Tunnel')),
				E('span', { 'class': 'nvm-route-line', 'aria-hidden': 'true' }),
				this.routeNode('exit', _('Internet'))
			]),

			E('section', { 'class': 'nvm-protection-band' }, [
				E('div', { 'class': 'nvm-kill-copy' }, [
					E('strong', [ _('Kill switch') ]),
					E('span', { 'id': 'nvm-kill-value' }, [ _('Enabled') ])
				]),
				E('label', { 'class': 'nvm-switch', 'for': 'nvm-kill-toggle' }, [
					killInput,
					E('span', { 'class': 'nvm-switch-track', 'aria-hidden': 'true' }, [
						E('span', { 'class': 'nvm-switch-knob' })
					])
				])
			]),

			E('section', { 'class': 'nvm-metrics', 'aria-label': _('Tunnel details') }, [
				this.metric(_('Server'), 'server'),
				this.metric(_('Location'), 'location'),
				this.metric(_('Endpoint'), 'endpoint'),
				this.metric(_('Handshake'), 'handshake'),
				this.metric(_('Received'), 'received'),
				this.metric(_('Sent'), 'sent'),
				this.metric(_('Download'), 'rx-rate'),
				this.metric(_('Upload'), 'tx-rate')
			]),

			E('section', { 'class': 'nvm-account-band' }, [
				E('div', { 'class': 'nvm-account-copy' }, [
					E('span', { 'class': 'nvm-section-kicker' }, [ _('NordVPN account') ]),
					E('strong', { 'id': 'nvm-account-value' }, [ _('Not linked') ]),
					E('span', { 'id': 'nvm-account-detail' }, [ _('Token required') ])
				]),
				E('div', { 'class': 'nvm-account-actions' }, [
					E('button', { 'class': 'btn cbi-button cbi-button-negative', 'id': 'nvm-unlink', 'click': ui.createHandlerFn(this, this.confirmUnlink) }, [ _('Unlink') ]),
					E('button', { 'class': 'btn cbi-button', 'id': 'nvm-refresh-key', 'click': ui.createHandlerFn(this, function() { return this.runAction('credentials', callRefreshCredentials(), _('NordLynx credentials refreshed')); }) }, [ _('Refresh credentials') ]),
					E('button', { 'class': 'btn cbi-button cbi-button-positive', 'id': 'nvm-link', 'click': ui.createHandlerFn(this, this.showEnrollModal) }, [ _('Link account') ])
				])
			]),

			E('section', { 'class': 'nvm-server-section' }, [
				E('div', { 'class': 'nvm-section-head' }, [
					E('div', [ E('span', { 'class': 'nvm-section-kicker' }, [ _('NordVPN catalog') ]), E('h3', [ _('Choose a server') ]) ]),
					E('span', { 'class': 'nvm-server-count', 'id': 'nvm-server-count' }, [ _('Searching') ])
				]),
				E('div', { 'class': 'nvm-filters' }, [
					this.formRow(_('Country'), country),
					this.formRow(_('City'), city),
					this.formRow(_('Category'), category),
					E('label', { 'class': 'nvm-favorites-filter' }, [
						E('input', { 'type': 'checkbox', 'change': L.bind(function(event) { this.showFavorites = event.target.checked; this.renderServers(); }, this) }),
						E('span', [ _('Favorites') ])
					])
				]),
				E('div', { 'class': 'nvm-catalog-actions' }, [
					E('span', { 'id': 'nvm-switch-guard' }, [ _('Checking server change limit') ]),
					E('div', [
						E('button', { 'class': 'btn cbi-button', 'id': 'nvm-refresh-servers', 'click': ui.createHandlerFn(this, function() { return this.refreshRecommendations(true); }) }, [ _('Refresh') ]),
						E('button', { 'class': 'btn cbi-button cbi-button-positive', 'id': 'nvm-fastest', 'click': ui.createHandlerFn(this, this.connectFastest) }, [ _('Connect fastest') ])
					])
				]),
				E('div', { 'class': 'nvm-server-header', 'aria-hidden': 'true' }, [
					E('span', [ _('Server') ]), E('span', [ _('Location') ]), E('span', [ _('Load') ]), E('span')
				]),
				E('div', { 'class': 'nvm-server-rows', 'id': 'nvm-server-rows' })
			]),

			E('section', { 'class': 'nvm-settings-section' }, [
				E('div', { 'class': 'nvm-section-head' }, [
					E('div', [ E('span', { 'class': 'nvm-section-kicker' }, [ _('Manager') ]), E('h3', [ _('Configuration') ]) ]),
					E('div', [
						E('button', { 'class': 'btn cbi-button cbi-button-negative', 'id': 'nvm-reset', 'click': ui.createHandlerFn(this, this.confirmReset) }, [ _('Reset') ]),
						E('button', { 'class': 'btn cbi-button', 'id': 'nvm-settings', 'click': ui.createHandlerFn(this, function() { this.settingsOpen = !this.settingsOpen; this.renderCurrentView(); }) }, [ _('Edit') ])
					])
				]),
				this.settingsOpen ? this.settingsForm(this.status.state) : ''
			])
		]);
	},

	captureNodes: function() {
		const byId = L.bind(function(id) { return this.root.querySelector('#' + id); }, this);
		Object.assign(this.nodes, {
			stateBadge: byId('nvm-state-badge'), stateTitle: byId('nvm-state-title'), stateDetail: byId('nvm-state-detail'),
			connectionInput: byId('nvm-connection-toggle'), connectionValue: byId('nvm-connection-value'),
			killInput: byId('nvm-kill-toggle'),
			killValue: byId('nvm-kill-value'), accountValue: byId('nvm-account-value'), accountDetail: byId('nvm-account-detail'),
			link: byId('nvm-link'), refreshKey: byId('nvm-refresh-key'), unlink: byId('nvm-unlink'),
			serverMetric: byId('nvm-server'), locationMetric: byId('nvm-location'), endpointMetric: byId('nvm-endpoint'),
			handshakeMetric: byId('nvm-handshake'), receivedMetric: byId('nvm-received'), sentMetric: byId('nvm-sent'),
			rxRate: byId('nvm-rx-rate'), txRate: byId('nvm-tx-rate'), country: byId('nvm-country'),
			city: byId('nvm-city'), category: byId('nvm-category'),
			serverRows: byId('nvm-server-rows'), serverCount: byId('nvm-server-count'), switchGuard: byId('nvm-switch-guard'),
			refreshServers: byId('nvm-refresh-servers'), fastest: byId('nvm-fastest'), settings: byId('nvm-settings'), reset: byId('nvm-reset'),
			route_lan: byId('nvm-route-lan'), route_dns: byId('nvm-route-dns'), route_tunnel: byId('nvm-route-tunnel'), route_exit: byId('nvm-route-exit')
		});
	},

	render: function(data) {
		this.ensureStyles();
		this.status = data[0] && data[0].ok !== false ? data[0] : { state: {}, networks: [] };
		this.locations = data[1] && data[1].ok !== false ? data[1] : { countries: [], categories: [] };
		this.account = this.status.account || {};
		this.servers = [];
		this.catalogLoaded = false;
		this.catalogBusy = false;
		this.busy = false;
		this.busyLabel = '';
		this.settingsOpen = false;
		this.showFavorites = false;
		this.selectedCountry = 0;
		this.selectedCity = 0;
		const standard = (this.locations.categories || []).find(function(category) { return category.key == 'standard'; });
		this.selectedGroup = standard ? Number(standard.id) :
			(this.locations.categories.length ? Number(this.locations.categories[0].id) : 0);
		this.selectedServer = Number(this.status.state && this.status.state.selected_server_id || 0);
		this.favorites = new Set(((this.status.state && this.status.state.favorites) || []).map(Number));
		this.lastTransfer = null;
		this.nodes = {};

		this.root = E('div', { 'class': 'cbi-map nvm-dashboard', 'aria-busy': 'false' }, [
			E('h2', { 'class': 'nvm-page-title' }, [ _('NordVPN Manager') ]),
			E('div', { 'class': 'nvm-page-meta' }, [
				E('span', { 'class': 'nvm-eyebrow' }, [ _('Services / VPN') ]),
				E('span', { 'class': 'nvm-unofficial' }, [ _('Unofficial integration') ])
			]),
			E('div', { 'id': 'nvm-content' })
		]);
		this.nodes.content = this.root.querySelector('#nvm-content');
		this.renderCurrentView();
		poll.add(L.bind(this.refreshStatus, this), 5);
		return this.root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
