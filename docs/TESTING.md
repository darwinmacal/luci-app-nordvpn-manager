# Testing

[Versión en español](TESTING.es.md)

Release publication is blocked unless static, package and live routing tests
all pass.

## Static checks

```sh
./tests/run.sh
```

The suite checks shell syntax and ShellCheck findings, Ucode compilation,
JavaScript parsing, JSON, PO format/coverage, managed-section markers and known
secret or private-topology patterns.

## SDK build

Use the official OpenWrt `25.12.5` MediaTek MT7622 SDK. Verify the SDK archive
before extraction:

```text
0bd25a391256dbe9ad1f9c6f313364b1f9eddcc0e280c829d644034981ad8306
```

Build:

```sh
./scripts/build-sdk.sh /path/to/openwrt-sdk-25.12.5-mediatek-mt7622_gcc-14.3.0_musl.Linux-x86_64
```

The helper installs only the package dependency graph. A build host still needs
the standard OpenWrt SDK prerequisites documented by OpenWrt.

Confirm that the artifact reports architecture `all`, declares only expected
dependencies and does not contain credential paths as package conffiles.

## UI checks

Serve the repository root and open `tests/ui/`:

```sh
python -m http.server 8765 --bind 127.0.0.1
```

Automated desktop/mobile, light/dark and English/Spanish checks are available
after `npm install`:

```sh
npm run qa:ui
```

The harness executes the real LuCI view with mocked RPC. Check desktop and
mobile widths, light and dark color schemes, keyboard focus, kill switch
confirmation, direct fallback, server selection, account actions, settings and
initial setup. No horizontal page overflow or internal vertical scrolling is
expected.

## Clean-router prerequisites

Before installing the APK on a test router:

1. Save a complete configuration backup.
2. Ensure a console or failsafe recovery path exists.
3. Keep an independent Internet connection for the administrative workstation.
4. Create isolated WAN, normal LAN and protected LAN logical networks.
5. Disable IPv6 on the protected test network.
6. Reserve a test client address in that network.

## Live functional matrix

Record the command output and packet-capture timestamps for each case:

1. Normal LAN exits through the ISP address.
2. Protected LAN with VPN connected exits through the selected NordVPN address.
3. Neither LAN can reach the other LAN's router or client addresses unless an
   explicit administrator rule exists outside this application.
4. Protected DNS port 53 is redirected to the router listener.
5. The resolver uses HTTPS and its output follows WireGuard.
6. Standard, P2P, Double VPN and Onion categories each return compatible
   dynamic servers.
7. A nonresponsive new endpoint restores the previously active server.

## Kill switch leak test

Use a continuously active client on the protected network and capture WAN at
the router. Do not rely only on ping.

With the kill switch enabled:

1. Start continuous TCP, UDP and ICMP traffic to public test endpoints.
2. Start DNS queries to the router and to external port 53/853 addresses.
3. Bring the WireGuard interface down without changing the checkbox.
4. Confirm the protected client loses Internet.
5. Confirm the WAN capture contains no client payload, DNS or new connection
   from the protected source subnet.
6. Confirm the PBR table contains `unreachable default`.
7. Wait through at least one watchdog recovery cycle.

With the kill switch disabled:

1. Repeat the tunnel failure.
2. Confirm traffic resumes through WAN.
3. Confirm DNS remains DoH and no direct port 53/853 query escapes.
4. Confirm the protected LAN still cannot reach the normal LAN.
5. Re-enable the kill switch during fallback and confirm WAN closes before the
   UI reports completion.

## Persistence

Test both checkbox states across:

- service restart;
- firewall restart;
- WAN DHCP renewal;
- router reboot;
- package upgrade.

After each event, compare UCI, nftables rules, PBR table routes, DNS source route
and the LuCI state. Any discrepancy blocks release.
