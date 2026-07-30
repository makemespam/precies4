# Tienduizend

Het dobbelspel om te spelen op meerdere telefoons. Geen app, geen account.
Zelfde opzet als [Flip 7](../flip7/): één telefoon is de tafel, de rest doet mee
met een kamercode van 4 tekens.

Open `tienduizend/` op je telefoon en kies **Nieuw spel starten**, **Meedoen met
een code** of **Op één telefoon**.

## De regels zoals de app ze toepast

Familieregels verschillen nogal, dus hier staat precies wat deze app doet. De
schuin gemarkeerde keuzes zijn in de wachtkamer aan te passen.

* Je gooit met zes dobbels, legt **minstens één** scorende dobbel vast, en kiest
  dan: verder gooien met wat overblijft, of stoppen en je punten bijschrijven.
* Elke dobbel die je vastlegt moet meedoen aan een combinatie. Een losse 3
  erbij pakken kan dus niet.
* **Poedel:** levert een worp niets op, dan is je beurt voorbij en verlies je
  alles wat je die beurt verzameld had.
* **Alles telt:** leg je alle zes dobbels vast, dan gooi je met alle zes verder
  en blijven je punten staan.
* *Binnenkomen:* de eerste keer stoppen mag pas met **500** punten of meer in
  één beurt (instelbaar: geen drempel, 350, 500 of 1000).
* *Einde:* wie **10.000** haalt sluit het spel; iedereen krijgt daarna nog één
  beurt en de hoogste score wint (instelbaar: 3.000, 5.000 of 10.000).

### Puntentelling

| Combinatie | Punten |
| --- | --- |
| Losse 1 | 100 |
| Losse 5 | 50 |
| Drie gelijke | waarde × 100 |
| Drie 1-en | 1000 |
| Vier / vijf / zes gelijke | drie gelijke × 2 / × 4 / × 8 |
| *Straat* (1 t/m 6, alle zes) | 1500 |
| *Drie paren* (alle zes) | 750 |

Vier gelijke plus een paar telt ook als drie paren. Zit een selectie op meer dan
één manier goed, dan rekent de app altijd de hoogste uitkomst - zes 2-en zijn
dus 1600 en niet 750.

*Straat* en *drie paren* kunnen in de wachtkamer uitgezet worden. Wat deze app
**niet** doet: exact op 10.000 moeten eindigen, punten van elkaar afpakken, of
twee drietallen als aparte combinatie. Zeg het als jullie dat wel zo spelen.

## Hoe het in elkaar zit

```
tienduizend/
  index.html          alle schermen
  css/style.css       dobbels en speelmat
  js/engine.js        de regels: puur, zonder DOM of netwerk
  js/app.js           schermen, invoer, synchronisatie
  test/engine.test.mjs
```

De netwerklaag, de basis-CSS en de kleine UI-helpers staan in
[`../shared/`](../shared/) en zijn hetzelfde voor alle spellen hier.

De host houdt de enige echte stand bij en stuurt na elke zet een kopie rond;
gasten sturen alleen intenties (`gooi`, `tik dobbel aan`, `gooi verder`, `stop`).
Ook het aantikken van een dobbel gaat via de host, zodat iedereen live meekijkt
hoe iemand zit te wikken.

## Tests

```sh
node --test tienduizend/test/engine.test.mjs
```

18 tests over de regels, waaronder één die voor **alle 55.986 mogelijke worpen**
(elke worp van 1 t/m 6 dobbels, met en zonder de extra combinaties) controleert
dat "poedel" precies betekent: er bestaat geen enkele geldige selectie. Dat
voorkomt zowel een onterecht verloren beurt als een speler die vastzit.
