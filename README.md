# precies4

Een handvol spelletjes die op de telefoon werken, zonder app en zonder account.
Statische site op GitHub Pages: `https://makemespam.github.io/precies4/`.

| Spel | Waar | Wat het is |
| --- | --- | --- |
| **Precies 4** | [`/`](index.html) | Nederlandse Connections: zoek de vier groepjes van vier. |
| Puzzel maken | [`/maak.html`](maak.html) | Eigen Precies 4-puzzel in elkaar zetten. |
| **Flip 7** | [`/flip7/`](flip7/) | Push your luck met kaarten, op meerdere telefoons. |
| **Tienduizend** | [`/tienduizend/`](tienduizend/) | Het dobbelspel, op meerdere telefoons. |

Flip 7 en Tienduizend werken hetzelfde: één telefoon start een spel en krijgt een
kamercode van 4 tekens, de anderen doen mee via die code of de deel-link. Er is
ook een "op één telefoon"-stand om hem aan elkaar door te geven.

## Opzet

Geen build-stap, geen dependencies om te installeren. ES-modules, dus openen via
http(s) - `file://` werkt niet.

```
shared/          gedeeld door alle spellen
  js/net.js        WebRTC-verbindingen (PeerJS), host + gast
  js/ui.js         schermen, meldingen, naam/token onthouden
  css/base.css     de shell: knoppen, velden, wachtkamer, sheets
  vendor/          meegeleverde PeerJS-build (MIT)
flip7/           spel: engine + tafel + eigen CSS
tienduizend/     spel: engine + tafel + eigen CSS
```

Elk spel heeft een `js/engine.js` met alleen de regels - geen DOM, geen netwerk -
en daarnaast een `js/app.js` die de schermen tekent en de zetten doorgeeft. De
engine is de plek waar de regels wonen, en de plek waar de tests op mikken.

De telefoon die een spel start is de host: die heeft de enige echte spelstand,
controleert elke zet tegen de regels en stuurt de nieuwe stand rond. Gasten
sturen alleen intenties. Het koppelen loopt via de gratis PeerJS-signaalserver,
het spelverkeer gaat rechtstreeks tussen de toestellen. Een eigen signaalserver
kan met `?peer=host:poort` in de URL.

## Tests

```sh
node --test flip7/test/engine.test.mjs tienduizend/test/engine.test.mjs
```

Elk spel heeft zijn eigen `README.md` met de regels zoals de app ze toepast.
