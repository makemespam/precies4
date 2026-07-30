/*
 * Kleine helpers die elk spel op deze site gebruikt: schermen wisselen,
 * meldingen, naam/token onthouden en het scherm aan houden.
 * Geen spelregels hier - die horen in de engine van het spel zelf.
 */

const NAME_KEY = 'tafel.naam';
const TOKEN_KEY = 'tafel.token';

export const $ = (id) => document.getElementById(id);

/** Toont één .screen en verbergt de rest. */
export function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.removeAttribute('data-active'));
  $(id).setAttribute('data-active', '');
  window.scrollTo(0, 0);
}

export function isVisible(id) {
  return $(id).hasAttribute('data-active');
}

let toastTimer;
export function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

export function escape(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export function initials(name) {
  return (name || '?').trim().slice(0, 1).toUpperCase();
}

export function button(cls, html, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.innerHTML = html;
  b.addEventListener('click', onClick);
  return b;
}

/* ------------------------------------------------------------- identiteit */

/** Vast kenmerk van dit toestel, zodat je na herladen je stoel terugkrijgt. */
export function myToken() {
  let t = localStorage.getItem(TOKEN_KEY) || localStorage.getItem('flip7.token');
  if (!t) {
    t = Math.random().toString(36).slice(2, 8) + '-' + Date.now().toString(36);
  }
  localStorage.setItem(TOKEN_KEY, t);
  return t;
}

export function rememberedName() {
  // 'flip7.name' is de sleutel van vóór de gedeelde opslag.
  return localStorage.getItem(NAME_KEY) || localStorage.getItem('flip7.name') || '';
}

export function rememberName(name) {
  if (name) localStorage.setItem(NAME_KEY, name);
  return name;
}

/* ---------------------------------------------------------------- overige */

let wakeLock = null;

export async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* niet ondersteund of geweigerd: niet erg */
  }
}

/** Deelt een uitnodigingslink, met de code als terugval. */
export async function shareInvite(code, spel) {
  const url = location.origin + location.pathname + '?join=' + code;
  try {
    if (navigator.share) {
      await navigator.share({ title: spel, text: `Doe mee met ${spel} - code ${code}`, url });
    } else {
      await navigator.clipboard.writeText(url);
      toast('Link gekopieerd');
    }
  } catch {
    /* gebruiker brak het delen af */
  }
}

export async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    toast('Code gekopieerd');
  } catch {
    toast('Code: ' + code);
  }
}
