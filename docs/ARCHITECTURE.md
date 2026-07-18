# Architecture

[Versión en español](ARCHITECTURE.es.md)

## Boundaries

NordVPN Manager is a policy application, not a topology manager. It accepts two
existing UCI logical network names:

- `wan_network`: the upstream network and firewall zone.
- `protected_network`: a static IPv4 network in a separate firewall zone.

It calculates `protected_subnet` from the protected interface address and
netmask. Every managed firewall rule and PBR policy is scoped to that subnet.
Physical devices, bridge ports, VLAN IDs and wireless radios remain outside the
application boundary.

## Components

| Component | Responsibility |
| --- | --- |
| `nordvpn-manager-api` | Token enrollment, NordLynx key retrieval and cached public API requests |
| `nordvpn-manager` | Validation, UCI transactions, WireGuard, firewall, PBR, DNS and rollback |
| `nordvpn-manager-health` | Handshake/PBR/DNS monitoring and cooldown-controlled recovery |
| `nordvpn_manager.uc` | Narrow RPC boundary and API response normalization |
| LuCI view | Setup, account, server selection, status and kill switch controls |
| iface hotplug | Reconciliation after WAN device or gateway changes |

RPC never invokes a command with an unvalidated user-controlled shell token.
Configuration and account secrets are passed through ephemeral file
descriptors.

## Credential flow

1. LuCI accepts a 64-character token only over an HTTPS page.
2. RPC validates its shape and writes it to `fs.mkstemp()`. Ucode creates this
   file as an already-unlinked ephemeral object.
3. The API helper reads `/dev/fd/N`; the token is not a process argument.
4. Curl receives HTTP basic credentials through a configuration stream on
   stdin, so the token is not visible in the process list.
5. A validated NordLynx key and token are atomically written as root-only files.

The API helper returns only account readiness, enrollment time and a short
fingerprint derived from the public key. It never returns either secret.

## Dynamic server flow

Public country, group and recommendation responses are cached in `/tmp` with
bounded TTLs. RPC accepts only online servers that contain:

- a valid NordVPN hostname;
- an IPv4 station address;
- online WireGuard technology ID `35`;
- a valid WireGuard public key;
- the requested server category when one was selected.

Before connecting an explicit result, RPC fetches that server again. The shell
backend receives a normalized key-value record over a file descriptor and
validates every field a second time.

## Owned UCI sections

Managed sections use stable names and `option nvm_owner '1'`:

```text
firewall.nvm_vpn
firewall.nvm_to_vpn
firewall.nvm_block_wan
firewall.nvm_allow_wan
firewall.nvm_dns_redirect
firewall.nvm_allow_dns
firewall.nvm_block_external_dns
pbr.nvm_protected
pbr.nvm_dns
https-dns-proxy.nordvpn_manager
network.<configured WireGuard name>
network.<configured WireGuard name>_peer
```

Setup, connection and reset abort if a section exists without the ownership
marker. This prevents a predictable section name from overwriting unrelated
administrator configuration.

## Routing model

PBR routes the protected subnet to the WireGuard interface. The generated
WireGuard peer has `route_allowed_ips=0`; it never installs a global default
route in the main table. A host route pins the VPN endpoint to WAN.

The PBR interface table contains a high-metric fallback route:

- kill switch on: `unreachable default`;
- kill switch off: default via the current WAN gateway and device.

The normal WireGuard default route has a preferred metric while the interface
is healthy. The fallback becomes effective only when that route disappears.

## Firewall model

The application creates a masquerading WireGuard zone and an allow rule from
the protected subnet to that zone. WAN behavior is represented by two mutually
exclusive rules:

- `nvm_block_wan`: reject the protected subnet toward WAN;
- `nvm_allow_wan`: allow the protected subnet toward WAN.

No forwarding is created to other local zones. Existing isolation between
logical LANs remains the topology administrator's responsibility and is not
weakened by either kill switch mode.

## Encrypted DNS

The protected subnet's TCP/UDP port 53 traffic is redirected to a dedicated
listener on its own router address. Direct external DNS and DNS over TLS port
853 are rejected. This is not a universal block for arbitrary DNS over HTTPS
applications because DoH uses ordinary HTTPS endpoints.

When the tunnel is healthy, `https-dns-proxy` binds its source to `10.5.0.2`
and an output-chain PBR policy routes it through WireGuard. When WAN fallback is
allowed, the source binding and DNS PBR policy are removed while encryption is
kept. Fail-closed mode disables the proxy while WireGuard is down.

## Transactions and rollback

Configuration-changing operations copy every touched UCI package into a
private temporary transaction directory. A failed operation restores those
files, reloads firewall/PBR/DNS and reapplies the persisted fallback policy.

When a new endpoint cannot handshake, the controller restores the previously
working server when one exists. A rate guard limits rapid server changes to
avoid API churn and unstable repeated reconfiguration.

## Persistent intent

`desired_enabled` records whether the administrator expects the VPN to remain
connected. `enabled` records the last successfully active runtime state. This
separation lets the watchdog keep recovering an established VPN after a failed
attempt without undoing a deliberate manual disconnect.
