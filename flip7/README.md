# Flip 7

Een webapp om Flip 7 te spelen op meerdere telefoons. Geen app installeren, geen
account, geen eigen server: gewoon de pagina openen.

## Spelen

Open `flip7/` op je telefoon (bijvoorbeeld
`https://<gebruiker>.github.io/precies4/flip7/`) en kies een van de drie manieren:

| Manier | Wat het doet |
| --- | --- |
| **Nieuw spel starten** | Jouw telefoon wordt de tafel en krijgt een kamercode van 4 tekens. Deel die code (of de link) met de anderen. |
| **Meedoen met een code** | Vul de code van de tafel in en je schuift aan. |
| **Op één telefoon** | Alles op één toestel; je geeft hem aan elkaar door. Werkt ook zonder internet. |

De telefoon die het spel gestart heeft, is de baas: die houdt de spelstand bij,
start de rondes en kan beslissen voor iemand die de verbinding kwijtraakt. Sluit
die telefoon de pagina, dan is het spel voorbij - dus geef de tafel aan iemand
met een volle accu.

Valt een speler eruit? Diegene opent de link opnieuw, vult dezelfde naam in en
gebruikt dezelfde code: hij krijgt zijn eigen stoel en punten terug. (Dat werkt
zolang hij dezelfde browser op hetzelfde toestel gebruikt.)

## De regels zoals de app ze toepast

* Op je beurt trek je **één** kaart, of je stopt. Daarna is de volgende aan zet.
* Trek je een nummer dat je al hebt, dan ga je **kapot**: 0 punten deze ronde.
* **Stoppen** zet je punten veilig; je doet de rest van de ronde niet meer mee.
* **7 verschillende nummers** = Flip 7: de ronde stopt direct, +15 bonus.
* `+2` t/m `+10` worden bij je score opgeteld. `×2` verdubbelt de som van je
  **nummerkaarten**; de plussen komen daarna erbij.
* **Freeze** geef je aan een speler die nog meedoet (jezelf mag ook): die stopt
  meteen met de punten die hij al heeft.
* **Flip Three** geef je aan een speler die nog meedoet: die trekt direct 3
  kaarten. Kapot gaan of Flip 7 onderbreekt de serie.
* **Second Chance** houd je bij je en gaat automatisch af als je een dubbel
  nummer trekt. Heb je er al een, dan moet je de nieuwe weggeven aan iemand die
  er geen heeft; kan dat niet, dan gaat hij op de aflegstapel.
* Actiekaarten die je *tijdens* een Flip Three trekt, deel je pas uit als de
  serie klaar is.
* De ronde stopt als iedereen gestopt of kapot is. Zodra iemand de grens haalt
  (100, 200 of 300 punten) eindigt het spel na die ronde; de hoogste score wint.

Het deck is compleet: 94 kaarten (één 0, één 1, twee 2-en, ... twaalf 12-en, de
zes modifiers en drie keer elke actiekaart). De aflegstapel wordt opnieuw
geschud als het deck leeg raakt.

## Hoe het in elkaar zit

Statische site, geen build-stap. ES-modules, dus het moet via http(s) geopend
worden (`file://` werkt niet).

```
flip7/
  index.html          alle schermen
  css/style.css
  js/engine.js        de spelregels: puur, zonder DOM of netwerk
  js/net.js           WebRTC-verbindingen (PeerJS)
  js/app.js           schermen, invoer, synchronisatie
  vendor/             meegeleverde PeerJS-build (MIT)
  test/engine.test.mjs
```

De host houdt de enige echte spelstand bij en stuurt na elke zet een kopie naar
de andere telefoons; die sturen alleen intenties terug (`trek`, `stop`, `kies
speler`). De host controleert elke zet opnieuw tegen de regels, dus een
gemanipuleerde gast kan niet buiten zijn beurt spelen. De inhoud van het deck
gaat nooit mee over de lijn - alleen hoeveel kaarten er nog liggen.

Het koppelen van de telefoons loopt via de gratis PeerJS-signaalserver; het
spelverkeer zelf gaat rechtstreeks tussen de toestellen. Wil je een eigen
signaalserver gebruiken, zet die dan in de URL:
`flip7/?peer=mijnserver.nl:9000` (voeg `:onveilig` toe voor http).

## Tests

```sh
node --test flip7/test/engine.test.mjs
```

17 tests over de regels: decksamenstelling, beurtwisseling, kapot gaan, Second
Chance, Freeze, Flip Three (ook genest en onderbroken), Flip 7, scoreberekening,
hergebruik van de aflegstapel en een compleet potje dat niet mag vastlopen.
