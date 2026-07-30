# Regenwoezels

Dobbelen om tegels, op meerdere telefoons. Zelfde opzet als [Flip 7](../flip7/)
en [Tienduizend](../tienduizend/): één telefoon is de tafel, de rest doet mee met
een kamercode van 4 tekens. Er is ook een "op één telefoon"-stand.

Onze eigen versie van een bekend dobbelspel: eigen naam, eigen vormgeving,
alleen de spelregels zijn hetzelfde. Vandaar woezels in plaats van wormen.

## De regels zoals de app ze toepast

* Er liggen **16 tegels** op de grill, van **21 tot 36**. Elke tegel is woezels
  waard: 21-24 = 1, 25-28 = 2, 29-32 = 3, 33-36 = 4. Samen 40 woezels.
* Je gooit met **8 dobbels** met de waarden 1 t/m 5 en een **woezel**. Een woezel
  telt 5 punten, net als een 5.
* Op je beurt: gooien, dan **één waarde** kiezen en **alle** dobbels met die
  waarde apart leggen. Daarna gooi je verder met wat over is, of je stopt.
  Dezelfde waarde mag je die beurt **niet nog eens** kiezen.
* Je hebt **minstens één woezel** nodig om een tegel te mogen pakken.
* **Stoppen:** je pakt de hoogste tegel op de grill die niet boven je totaal
  ligt. Is je totaal **precies gelijk** aan de bovenste tegel van een andere
  speler, dan mag je die in plaats daarvan afpakken. Kun je beide, dan kies je.
* **Mislukt** als je niets nieuws kunt apart leggen, als je stopt zonder woezel,
  of als je te laag eindigt voor elke tegel. Dan lever je je bovenste tegel weer
  in op de grill, en gaat daarna de **hoogste tegel van de grill** uit het spel -
  tenzij dat precies de tegel is die je net hebt teruggelegd. Heb je geen tegel, dan
  verdwijnt alleen die hoogste.
* Alleen je **bovenste** tegel kan afgepakt of ingeleverd worden.
* Liggen alle acht dobbels vast, dan wordt je beurt meteen afgerekend: pakken als
  het kan, anders mislukt hij.
* **Einde:** zodra de grill leeg is. De meeste woezels wint; gelijk is gelijk.

Wat deze app **niet** doet: een aparte tweespelersvariant met minder tegels, en
bij gelijkspel een tiebreak op de hoogste tegel. Zeg het als jullie dat anders
spelen.

## Hoe het in elkaar zit

```
regenwoezels/
  index.html          alle schermen
  css/style.css       grill, tegels en dobbels
  js/engine.js        de regels: puur, zonder DOM of netwerk
  js/app.js           schermen, invoer, synchronisatie
  test/engine.test.mjs
```

De netwerklaag, de basis-CSS en de UI-helpers komen uit
[`../shared/`](../shared/). De host houdt de enige echte stand bij; gasten
sturen alleen intenties (`gooi`, `leg deze waarde apart`, `stop`, `kies`). Ook
het apart leggen gaat via de host, zodat iedereen live meekijkt.

De woezel is een inline SVG en geen emoji, zodat hij er op elke telefoon
hetzelfde uitziet.

## Tests

```sh
node --test regenwoezels/test/engine.test.mjs
```

18 tests over de regels: de tegelwaarden, alle dobbels van een waarde apart
leggen, dezelfde waarde niet twee keer, de drie manieren om te mislukken, wat er
met de grill gebeurt bij een mislukking, afpakken bij een exacte match, kiezen
tussen grill en afpakken, en het einde. De laatste test speelt **40 complete
potjes** uit en controleert per potje dat de grill leegloopt en dat alle 16
tegels verantwoord blijven (bij een speler of uit het spel).
