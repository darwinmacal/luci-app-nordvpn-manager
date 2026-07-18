# luci-app-nordvpn-manager

An unofficial LuCI application for selecting NordVPN WireGuard servers from
OpenWrt. It uses a Nord Account access token, obtains NordLynx credentials,
discovers available servers dynamically and applies routing only to a logical
network chosen by the administrator.

This project is not created, maintained or endorsed by Nord Security. NordVPN
and NordLynx are trademarks of their respective owner.

[Documentación en español](README.es.md)

## Scope

- OpenWrt `25.12.x` with firewall4.
- Architecture-independent APK (`all`).
- Dynamic NordVPN servers only. Static WireGuard profile import is not
  supported.
- One administrator-selected IPv4 logical network protected by PBR.
- Optional fail-closed kill switch, enabled by default.
- Optional DNS over HTTPS with Quad9 as the default provider.
- English source interface and complete Spanish translation.

The application does **not** create bridges, VLANs, SSIDs or physical port
assignments. Prepare the desired logical networks with LuCI or UCI first, then
select them in the setup assistant.

## Traffic states

| VPN intent | Kill switch | WireGuard | Protected network result |
| --- | --- | --- | --- |
| Connected | On or off | Healthy | NordVPN tunnel |
| Connected | On | Failed | Internet blocked |
| Connected | Off | Failed | Direct WAN fallback |
| Disconnected | On | Down | Internet blocked |
| Disconnected | Off | Down | Direct WAN |

When encrypted DNS is enabled, DNS requests from the protected subnet are
redirected to a dedicated `https-dns-proxy` listener. During a healthy VPN
session, the proxy is policy-routed through WireGuard. During direct WAN
fallback, it remains encrypted but exits through WAN. In fail-closed mode it is
stopped while the tunnel is unavailable. The default Quad9 preset uses its
TLS-validated anycast address so upstream plaintext DNS interception cannot
prevent the fallback listener from starting. A provider blocked at the IP or
HTTPS layer will still make the transition fail and roll back.

## Prerequisites

1. Create a WAN logical interface assigned to a WAN firewall zone.
2. Create a separate protected logical interface with a static IPv4 address.
3. Assign the protected interface to its own firewall zone.
4. Keep the WAN and protected networks in different firewall zones.
5. Disable IPv6 assignment and addresses on the protected network. Version
   `0.1.0` intentionally supports IPv4 policy routing only.
6. Ensure LuCI is served through HTTPS before entering an access token.

Example laboratory layout:

```text
wan       DHCP             zone wan
lan       172.20.10.1/24   zone lan
vpnlan    172.20.20.1/24   zone vpnlan
```

Only the logical names are selected in the application. The example is not
applied automatically.

## Installation

Install the application and Spanish translation release APKs, and let APK
resolve the declared dependencies:

```sh
apk add --allow-untrusted \
  /tmp/luci-app-nordvpn-manager-0.1.0-r8.apk \
  /tmp/luci-i18n-nordvpn-manager-es-*.apk
```

Then open:

```text
LuCI > Services > NordVPN Manager
```

The package depends on LuCI HTTPS, WireGuard, PBR and `https-dns-proxy`. Its
`procd` watchdog is enabled automatically.

## Initial setup

1. Select the logical WAN interface.
2. Select the logical protected interface.
3. Keep WireGuard MTU `1420` unless the upstream path requires a smaller value.
4. Choose encrypted DNS and a provider. Quad9 is the default.
5. Keep the kill switch enabled for fail-closed behavior.
6. Save. The backend validates topology, IPv4 and possible IPv6 leakage before
   writing any managed section.
7. Open LuCI over HTTPS and link a fresh Nord Account token.
8. Choose country, city and server category, then connect a recommended or
   explicit server.

NordVPN documents token generation here:
[How to generate a NordVPN login token for a router](https://support.nordvpn.com/hc/en-us/articles/45535038276753-How-to-generate-a-NordVPN-login-token-to-connect-to-a-VPN-server-on-a-router).

The category identifiers for Standard, P2P, Double VPN and Onion over VPN are
resolved from the current NordVPN API response. Numeric category IDs are not
embedded in the UI.

## Managed configuration

The application owns only sections with `nvm_` names and an `nvm_owner=1`
marker. It refuses to overwrite an existing section without that marker.

Main paths:

```text
/etc/config/nordvpn_manager
/etc/nordvpn-manager/credentials/token
/etc/nordvpn-manager/credentials/nordlynx.key
/etc/nordvpn-manager/active-server
/usr/libexec/nordvpn-manager
/usr/libexec/nordvpn-manager-api
```

The token and NordLynx key are root-only (`0600`). The token is never placed in
UCI, process arguments or application logs. RPC passes it through an ephemeral,
already-unlinked file descriptor.

The WireGuard private key is also written to `/etc/config/network` while the
managed interface exists because netifd requires it. Standard OpenWrt backups
may therefore contain that key. The token is deliberately absent from the
package conffile and sysupgrade keep list.

## Kill switch

The switch is transactional:

- Enabling it installs the firewall reject before replacing fallback routing
  with an `unreachable default` route in the PBR table.
- Disabling it installs a WAN fallback route before opening the narrowly scoped
  firewall path.
- A WAN hotplug hook recalculates device and gateway changes.
- The protected subnet remains isolated from unrelated local firewall zones;
  the application never creates inter-LAN forwarding.

Disabling the switch is a deliberate privacy tradeoff. It prevents an outage,
but the ISP can carry traffic while WireGuard is down.

## Health service

`/etc/init.d/nordvpn-manager` supervises handshake, PBR and encrypted DNS. After
the configured failure threshold it retries the selected server, respecting a
cooldown. If recovery fails, the active kill switch policy remains in force.

Useful diagnostics:

```sh
/usr/libexec/nordvpn-manager status
logread -e nordvpn-manager
/etc/init.d/nordvpn-manager status
/etc/init.d/pbr status
wg show wg_nord
```

No command prints the stored token or private key.

## Upgrade and removal

Package upgrades preserve UCI settings and the selected kill switch mode. To
remove the package safely:

1. Disconnect NordVPN.
2. Use **Reset** in the application. This removes owned firewall, PBR, DNS and
   WireGuard sections and purges account credentials.
3. Remove the APK.

The package manager refuses normal removal while managed protection is still
configured. Upgrade transactions are allowed and do not purge runtime state.

## Build

Use the official OpenWrt `25.12.5` SDK:

```sh
./scripts/build-sdk.sh "$SDK"
```

The helper synchronizes the SDK's pinned feeds and installs only this package's
dependency graph. It does not select or build unrelated firmware packages.

See [TESTING.md](docs/TESTING.md) for static, mock and live leak tests, and
[ARCHITECTURE.md](docs/ARCHITECTURE.md) for ownership and routing details.

## License

GPL-2.0-only. See [LICENSE](LICENSE).
