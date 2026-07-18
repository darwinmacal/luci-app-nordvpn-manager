# Arquitectura

## Límites

NordVPN Manager administra políticas, no topología. Recibe dos nombres de redes
lógicas UCI existentes:

- `wan_network`: red y zona firewall de salida.
- `protected_network`: red IPv4 estática en una zona firewall separada.

Calcula `protected_subnet` desde la dirección y máscara. Cada regla firewall y
política PBR administrada queda limitada a esa subred. Dispositivos físicos,
puertos de bridge, VLAN, SSID y radios quedan fuera de la aplicación.

## Componentes

| Componente | Responsabilidad |
| --- | --- |
| `nordvpn-manager-api` | Vincular token, obtener clave NordLynx y consultar API con caché |
| `nordvpn-manager` | Validación, transacciones UCI, WireGuard, firewall, PBR, DNS y rollback |
| `nordvpn-manager-health` | Supervisión y recuperación con cooldown |
| `nordvpn_manager.uc` | Frontera RPC y normalización de respuestas |
| Vista LuCI | Asistente, cuenta, servidores, estado y kill switch |
| Hotplug iface | Reconciliar cambios del dispositivo o gateway WAN |

RPC nunca construye comandos con texto de usuario sin validar. La configuración
y los secretos se entregan mediante descriptores efímeros.

## Flujo de credenciales

1. LuCI acepta el token de 64 caracteres solamente sobre HTTPS.
2. RPC valida su forma y usa `fs.mkstemp()`, que crea un archivo efímero ya
   desvinculado.
3. El helper lee `/dev/fd/N`; el token no aparece como argumento.
4. Curl recibe la autenticación mediante configuración por stdin.
5. Token y clave NordLynx se escriben atómicamente con permisos de root.

La interfaz solamente recibe estado, fecha de vinculación y una huella corta
derivada de la clave pública.

## Servidores dinámicos

Países, categorías y recomendaciones públicas usan caché temporal. RPC acepta
únicamente servidores en línea con hostname NordVPN, endpoint IPv4, tecnología
WireGuard `35`, clave pública válida y la categoría solicitada.

Antes de conectar un servidor explícito, vuelve a consultarlo. El backend shell
recibe un registro normalizado por descriptor y valida cada campo otra vez.

## Propiedad UCI

Las secciones administradas tienen prefijo `nvm_` y `option nvm_owner '1'`.
Incluyen la zona VPN, reglas de salida, políticas PBR, proxy DNS e interfaz y
peer WireGuard. Si el nombre ya existe sin el marcador, la operación se detiene
para no sobrescribir configuración ajena.

## Enrutamiento y firewall

PBR dirige la subred protegida a WireGuard. El peer usa
`route_allowed_ips=0`, por lo que nunca instala una ruta predeterminada global.
El endpoint VPN queda fijado a WAN mediante una ruta host.

La tabla PBR mantiene un fallback de métrica alta:

- kill switch activado: `unreachable default`;
- kill switch desactivado: default por el gateway y dispositivo WAN actuales.

Firewall alterna dos reglas mutuamente excluyentes: rechazo hacia WAN o salida
WAN directa limitada a la subred protegida. No crea forwarding hacia otras LAN.

## DNS cifrado

TCP/UDP 53 de la subred se redirige a una instancia dedicada de
`https-dns-proxy`. DNS externo y DNS over TLS en 853 se rechazan. Esto no puede
bloquear universalmente DoH integrado en aplicaciones, porque usa HTTPS común.

Con WireGuard saludable, el proxy sale desde `10.5.0.2` y PBR lo dirige por el
túnel. Con fallback permitido, se retira esa vinculación y DoH sale por WAN. En
modo fail-closed, el proxy se detiene mientras la VPN no responda.

## Transacciones, rollback e intención

Cada cambio copia los paquetes UCI afectados a un directorio temporal privado.
Si falla, restaura archivos, servicios y la política de fallback persistida. Si
un endpoint nuevo no responde, intenta restaurar el servidor anterior.

`desired_enabled` representa la intención de mantener la VPN conectada;
`enabled` representa el último estado activo. Esta separación permite que el
watchdog siga recuperando una VPN caída sin deshacer una desconexión manual.
