# luci-app-nordvpn-manager

Aplicación LuCI no oficial para seleccionar servidores WireGuard de NordVPN en
OpenWrt. Usa un token de acceso de Nord Account, obtiene credenciales NordLynx,
descubre servidores dinámicamente y aplica el enrutamiento únicamente a la red
lógica seleccionada por el administrador.

Este proyecto no es creado, mantenido ni respaldado por Nord Security. NordVPN
y NordLynx son marcas de sus respectivos propietarios.

## Alcance

- OpenWrt `25.12.x` con firewall4.
- APK independiente de arquitectura (`all`).
- Solamente servidores dinámicos de NordVPN. No importa perfiles WireGuard
  estáticos.
- Una red lógica IPv4 protegida mediante PBR.
- Kill switch opcional y activado de forma predeterminada.
- DNS sobre HTTPS opcional con Quad9 como proveedor predeterminado.
- Interfaz fuente en inglés y traducción completa al español.

La aplicación **no** crea puentes, VLAN, SSID ni asignaciones de puertos
físicos. Primero prepara las redes lógicas mediante LuCI o UCI y después
selecciónalas en el asistente.

## Estados del tráfico

| Intención VPN | Kill switch | WireGuard | Resultado de la red protegida |
| --- | --- | --- | --- |
| Conectada | Activado o desactivado | Saludable | Túnel NordVPN |
| Conectada | Activado | Falló | Internet bloqueado |
| Conectada | Desactivado | Falló | Respaldo WAN directo |
| Desconectada | Activado | Caído | Internet bloqueado |
| Desconectada | Desactivado | Caído | WAN directo |

Con DNS cifrado, las consultas de la subred protegida se redirigen a una
instancia dedicada de `https-dns-proxy`. Con la VPN saludable, el proxy sale por
WireGuard. Durante el respaldo WAN conserva DoH, pero sale directamente por
WAN. En modo fail-closed se detiene mientras el túnel no esté disponible.
El preset predeterminado de Quad9 usa su dirección anycast validada por TLS,
por lo que una interceptación DNS en texto claro aguas arriba no impide iniciar
el proxy durante el respaldo. Si el proveedor está bloqueado por IP o HTTPS, la
transición falla y se revierte.

## Requisitos previos

1. Crea una interfaz lógica WAN dentro de una zona firewall WAN.
2. Crea una interfaz lógica protegida separada con IPv4 estática.
3. Asigna la interfaz protegida a su propia zona firewall.
4. Mantén WAN y la red protegida en zonas firewall diferentes.
5. Desactiva asignaciones y direcciones IPv6 en la red protegida. La versión
   `0.1.0` solamente admite políticas IPv4.
6. Sirve LuCI mediante HTTPS antes de ingresar el token.

Ejemplo de laboratorio:

```text
wan       DHCP             zona wan
lan       172.20.10.1/24   zona lan
vpnlan    172.20.20.1/24   zona vpnlan
```

La aplicación solamente selecciona nombres lógicos. No aplica automáticamente
este ejemplo.

## Instalación

Instala los APK publicados de la aplicación y su traducción al español:

```sh
apk add --allow-untrusted \
  /tmp/luci-app-nordvpn-manager-0.1.0-r8.apk \
  /tmp/luci-i18n-nordvpn-manager-es-*.apk
```

Abre:

```text
LuCI > Servicios > NordVPN Manager
```

APK instalará las dependencias declaradas de LuCI HTTPS, WireGuard, PBR y
`https-dns-proxy`. El watchdog `procd` se habilita automáticamente.

## Configuración inicial

1. Selecciona la interfaz lógica WAN.
2. Selecciona la interfaz lógica protegida.
3. Conserva MTU `1420`, salvo que la ruta del proveedor requiera un valor menor.
4. Activa DNS cifrado y elige proveedor. Quad9 es el predeterminado.
5. Conserva el kill switch activado para operar en modo fail-closed.
6. Guarda. El backend valida topología, IPv4 y posibles fugas IPv6 antes de
   escribir una sección.
7. Abre LuCI mediante HTTPS y vincula un token nuevo de Nord Account.
8. Elige país, ciudad y categoría, y conecta un servidor explícito o el
   recomendado.

NordVPN explica cómo generar el token en
[esta guía oficial](https://support.nordvpn.com/hc/en-us/articles/45535038276753-How-to-generate-a-NordVPN-login-token-to-connect-to-a-VPN-server-on-a-router).

Los identificadores de Standard, P2P, Double VPN y Onion over VPN se resuelven
desde la respuesta actual de la API. La interfaz no fija sus números internos.

## Configuración administrada

La aplicación solamente controla secciones con prefijo `nvm_` y marcador
`nvm_owner=1`. Rechaza sobrescribir una sección existente sin ese marcador.

Rutas principales:

```text
/etc/config/nordvpn_manager
/etc/nordvpn-manager/credentials/token
/etc/nordvpn-manager/credentials/nordlynx.key
/etc/nordvpn-manager/active-server
/usr/libexec/nordvpn-manager
/usr/libexec/nordvpn-manager-api
```

El token y la clave NordLynx son exclusivos de root (`0600`). El token nunca se
guarda en UCI, argumentos de procesos ni logs. RPC lo entrega mediante un
descriptor efímero cuyo archivo ya fue desvinculado.

Netifd necesita la clave privada en `/etc/config/network` mientras existe la
interfaz WireGuard. Un respaldo normal de OpenWrt puede contener esa clave. El
token queda fuera de los conffiles del paquete y de la lista de conservación de
sysupgrade.

## Kill switch

El cambio es transaccional:

- Al activarlo, instala primero el rechazo firewall y después coloca una ruta
  `unreachable default` en la tabla PBR.
- Al desactivarlo, prepara primero la ruta WAN de respaldo y después abre la
  regla firewall limitada a la subred protegida.
- Un hotplug WAN recalcula cambios de dispositivo y gateway.
- La aplicación nunca crea forwarding entre la red protegida y otras LAN.

Desactivar el kill switch evita una interrupción, pero permite que el proveedor
de Internet transporte tráfico cuando WireGuard esté caído.

## Servicio de salud

`/etc/init.d/nordvpn-manager` supervisa handshake, PBR y DNS cifrado. Después
del umbral de fallos intenta reconectar el servidor seleccionado, respetando un
cooldown. Si no lo logra, conserva la política de kill switch elegida.

Diagnóstico:

```sh
/usr/libexec/nordvpn-manager status
logread -e nordvpn-manager
/etc/init.d/nordvpn-manager status
/etc/init.d/pbr status
wg show wg_nord
```

Ningún comando muestra el token o la clave privada.

## Actualización y desinstalación

Las actualizaciones conservan UCI y el estado del kill switch. Para eliminar el
paquete:

1. Desconecta NordVPN.
2. Usa **Restablecer**. Esto elimina las secciones firewall, PBR, DNS y
   WireGuard administradas, además de las credenciales.
3. Desinstala el APK.

La desinstalación se rechaza mientras la protección siga configurada. Las
actualizaciones sí se permiten y no purgan el estado.

## Compilación

Usa el SDK oficial OpenWrt `25.12.5`:

```sh
./scripts/build-sdk.sh "$SDK"
```

El asistente sincroniza los feeds fijados por el SDK e instala solamente el
grafo de dependencias de este paquete. No selecciona ni compila firmware ajeno.

Consulta [pruebas](docs/TESTING.md) y
[arquitectura](docs/ARCHITECTURE.md) para las validaciones de fugas y propiedad
de secciones.

## Licencia

GPL-2.0-only. Consulta [LICENSE](LICENSE).
