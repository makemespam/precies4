# Wartaal

Het woordenboekspel op meerdere telefoons. Eén speler kiest een woord dat
niemand kent, iedereen schrijft een omschrijving, en daarna moet je eruit halen
welke de echte is.

Zelfde opzet als de andere spellen hier: één telefoon is de tafel, de rest doet
mee met een kamercode van 4 tekens.

## De regels

* De **kiezer** krijgt 15 woorden te zien, **zonder** betekenis, en kiest er
  één. Pas daarna ziet hij wat het woord betekent. Blind kiezen voorkomt dat hij
  het woord uitzoekt dat hij zelf het makkelijkst kan navertellen.
* **De kiezer bluft niet.** Hij schrijft de echte betekenis over en mag hem
  inkorten, maar alleen met **woorden die in die omschrijving staan**, plus
  lidwoorden en voorzetsels. De app controleert dat live en blokkeert het
  inleveren zolang er een woord in staat dat niet mag.
* **De rest verzint** een omschrijving die zo echt mogelijk klinkt.
* Alles wordt geschud en **anoniem** getoond. Iedereen behalve de kiezer stemt;
  op je eigen inzending stemmen kan niet.
* **Punten:** 2 als je de echte vindt, 1 voor elke stem op jouw verzinsel, en de
  kiezer krijgt 1 per speler die de echte mist - met een plafond van 2, zodat
  het niet loont om de waarheid expres onherkenbaar op te schrijven.
* Een gebruikt woord komt **nooit meer terug**; de veertien niet-gekozen woorden
  wel.

Vanaf 3 spelers wordt het leuk. Met 2 kan het (de een schrijft de echte, de
ander gokt tussen twee), maar dan is het vooral een test.

## De woordenlijst

`js/woorden.js` is een gewone lijst van `{ w, b }`. Wil je woorden toevoegen of
weghalen, dan hoef je verder niets aan te passen.

Eisen aan een goed woord: het bestaat echt, staat in een groot woordenboek, en
vrijwel niemand aan tafel kent het - maar de betekenis is te bevatten zodra je
hem hoort. De omschrijving is één korte zin zonder het woord zelf erin, want dat
is de tekst waar de kiezer uit put.

De beste woorden zijn de **gewoon ogende**: bij *haren*, *broek*, *spiegel* en
*serpent* schrijven mensen prachtige geloofwaardige onzin. Puur exotische
woorden leveren minder op.

**Herkomst en betrouwbaarheid.** De lijst is deels met de hand samengesteld en
nagezocht, deels door een taalmodel gegenereerd en daarna geschift op "kent een
gewoon mens dit?". Een deel is bij het genereren tegen woordenboekbronnen
gecontroleerd, een deel niet. Klopt er eentje niet, haal hem dan uit
`js/woorden.js` - het spel merkt daar verder niets van.

## Hoe het in elkaar zit

```
wartaal/
  index.html          alle schermen
  css/style.css
  js/engine.js        de regels: puur, zonder DOM of netwerk
  js/woorden.js       de woordenvoorraad
  js/app.js           schermen, invoer, synchronisatie
  test/engine.test.mjs
```

Dit is het eerste spel hier waarbij **elke telefoon iets anders ziet**. De host
stuurt daarom niet één spelstand naar iedereen, maar per speler een eigen
`viewFor()`: de echte betekenis zit alleen in het pakketje van de kiezer, en
tijdens het stemmen staan er geen namen bij de inzendingen. Wat een telefoon
niet mag weten, wordt er ook niet naartoe gestuurd.

Bij "op één telefoon" komt er een tussenscherm dat vraagt om het toestel door te
geven, want anders leest de volgende speler mee.

## Tests

```sh
node --test wartaal/test/engine.test.mjs
```

19 tests: de regel van de kiezer (inclusief hoofdletters, leestekens en de vrije
lidwoorden en voorzetsels), het beurtverloop, dat de echte betekenis niet in het
kijkje van de andere spelers zit, dat er anoniem gestemd wordt, de punten,
het einde van het spel, en een compleet potje met vier spelers.
