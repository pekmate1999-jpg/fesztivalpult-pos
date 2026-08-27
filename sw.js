/* Fesztiválpult POS — service worker (adatbiztos frissítéssel)
 *
 * FONTOS: ez a service worker SOHA nem nyúl a localStorage-hoz — a fiókok,
 * tranzakciók, egyenlegek a böngésző localStorage-ában élnek, amit a SW nem lát
 * és nem töröl. A frissítés csak a GYORSÍTÓTÁRAT (cache) cseréli.
 *
 * Stratégia:
 *  - HTML (index.html / navigáció): NETWORK-FIRST — ha van net, mindig a friss appot
 *    tölti, így az új verzió magától megjelenik (nem kell "webhelyadatokat törölni").
 *    Ha nincs net, a cache-elt utolsó verziót adja (offline működés a fesztiválon).
 *  - Statikus assetek (css, ikon, manifest): CACHE-FIRST, a háttérben frissítve.
 *  - Aktiváláskor a régi cache-eket törli.
 *  - SKIP_WAITING üzenetre azonnal aktiválódik (az app "Frissítés" gombja ezt küldi).
 *
 * Verzióemeléskor NÖVELD a CACHE_VERSION-t — ettől a régi cache kiürül és friss lesz.
 */

const CACHE_VERSION = "v15";
const CACHE_NAME = "fesztivalpult-" + CACHE_VERSION;

// Offline-hoz előre elrakott fájlok (a repódban ezek legyenek elérhetők).
const PRECACHE = [
  "./",
  "./index.html",
  "./tailwind.css",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // Nem bukik el a telepítés, ha egy-egy asset hiányzik.
      Promise.allSettled(PRECACHE.map(u => cache.add(u)))
    )
  );
  // NEM hívunk automatikus skipWaiting-et — az appnak jelezzük, hogy van új verzió,
  // és a felhasználó dönt (a "Frissítés" gomb küld SKIP_WAITING üzenetet). Így egy
  // aktív pult közben nem cserélődik le váratlanul.
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Az app "Frissítés" gombja ezt küldi → azonnal átveszi az irányítást az új verzió.
self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isHTMLRequest(req) {
  if (req.mode === "navigate") return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Csak azonos eredetű kéréseket kezelünk (a Google Sheets sync menjen közvetlenül).
  if (url.origin !== self.location.origin) return;

  if (isHTMLRequest(req)) {
    // NETWORK-FIRST: friss app, ha van net; különben a cache-elt verzió.
    event.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put("./index.html", copy)).catch(() => {});
        return resp;
      }).catch(() =>
        caches.match(req).then(hit => hit || caches.match("./index.html"))
      )
    );
    return;
  }

  // CACHE-FIRST a statikus assetekre, háttér-frissítéssel (stale-while-revalidate).
  event.respondWith(
    caches.match(req).then(hit => {
      const fetchPromise = fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => hit);
      return hit || fetchPromise;
    })
  );
});
