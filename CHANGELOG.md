# Changelog

All notable changes to this project are documented here.

## [0.1.0-beta.1] - 2026-07-18

### Changed

- Replaced the separate Connect, Reconnect and Disconnect controls with one accessible VPN connection switch.
- Selecting a different server while connected now applies that server immediately while preserving the server-change guard.
- Integrated the page title with the active LuCI theme heading contract.
- Added explicit Catppuccin light and dark palette integration for status controls.

### Fixed

- Restored the connection switch after a cancelled disconnect confirmation.
- Added responsive UI coverage for both switches and the themed page heading.

## [0.1.0-beta] - 2026-07-18

### Added

- Token-based NordLynx enrollment without token process arguments.
- Dynamic country, city, Standard, P2P, Double VPN and Onion discovery.
- Generic logical WAN and protected-network setup assistant.
- Transactional firewall4 and PBR management with ownership markers.
- Optional fail-closed kill switch with direct WAN fallback mode.
- Quad9, Cloudflare, Google, AdGuard and custom DNS over HTTPS providers.
- `procd` health supervision, cooldown, endpoint rollback and WAN hotplug.
- Responsive LuCI dashboard with light/dark theme support.
- Complete Spanish interface and bilingual operator documentation.
