/* Mesure publicitaire ARC : chargement uniquement après accord du visiteur. */
(function (w, d) {
  'use strict';
  if (w.arcMeasurement) return;

  var PIXEL_ID = 'MLmSiQsHhpFB37VqmhBToo';
  var CONSENT_KEY = 'arc_openai_measurement_consent_v1';
  var consent = null;
  var initialized = false;
  var leadSent = false;
  var banner;

  try {
    var saved = JSON.parse(w.localStorage.getItem(CONSENT_KEY));
    if (saved && typeof saved.allowed === 'boolean' && saved.expires > Date.now()) {
      consent = saved.allowed;
    }
  } catch (_) { /* Une préférence inaccessible ne vaut pas consentement. */ }

  function initialize() {
    if (initialized || consent !== true) return;
    if (!w.oaiq) {
      var queue = function () { queue.q.push(arguments); };
      queue.q = [];
      w.oaiq = queue;
      var script = d.createElement('script');
      script.async = true;
      script.src = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';
      d.head.appendChild(script);
    }
    // La préférence est toujours établie avant l'initialisation du Pixel.
    w.oaiq('consent', true);
    w.oaiq('init', { pixelId: PIXEL_ID });
    initialized = true;
  }

  function setConsent(allowed) {
    consent = allowed === true;
    try {
      w.localStorage.setItem(CONSENT_KEY, JSON.stringify({
        allowed: consent,
        expires: Date.now() + 180 * 24 * 60 * 60 * 1000
      }));
    } catch (_) { /* Le choix reste valable pour la page en cours. */ }
    try {
      if (consent) initialize();
      else if (typeof w.oaiq === 'function') w.oaiq('consent', false);
    } catch (_) { /* La mesure ne doit jamais empêcher le formulaire de fonctionner. */ }
    if (banner) banner.hidden = true;
  }

  function trackLead() {
    if (consent !== true || leadSent) return false;
    try {
      initialize();
      var options = { opt_out: true };
      if (w.crypto && typeof w.crypto.randomUUID === 'function') {
        options.event_id = 'arc_contact_' + w.crypto.randomUUID();
      }
      w.oaiq('measure', 'lead_created', { type: 'customer_action' }, options);
      leadSent = true;
      return true;
    } catch (_) { return false; }
  }

  function showChoices() {
    if (banner) banner.hidden = false;
  }

  w.arcMeasurement = { setConsent: setConsent, trackLead: trackLead, showChoices: showChoices };

  function renderChoices() {
    var style = d.createElement('style');
    style.textContent = '#arc-measurement-choices[hidden]{display:none!important}' +
      '#arc-measurement-choices{position:fixed;bottom:16px;left:16px;right:16px;z-index:10000;max-width:720px;margin:auto;padding:20px;background:#fff;color:#18202c;border:1px solid #d9dee5;box-shadow:0 4px 24px #0003;font:16px/1.5 system-ui,sans-serif}' +
      '#arc-measurement-choices p{margin:0 0 12px}' +
      '#arc-measurement-choices .arc-measurement-actions{display:flex;gap:12px;flex-wrap:wrap}' +
      '#arc-measurement-choices button{padding:10px 18px;border:1px solid #0e2240;background:#0e2240;color:#fff;font:inherit;cursor:pointer}' +
      '#arc-measurement-choices a{color:#1f4e8c;text-decoration:underline}' +
      '#arc-measurement-preferences{position:fixed;bottom:8px;left:8px;z-index:9999;padding:6px 10px;background:#fff;color:#18202c;border:1px solid #d9dee5;font:12px system-ui,sans-serif;cursor:pointer}' +
      '#arc-measurement-choices button:focus-visible,#arc-measurement-preferences:focus-visible{outline:3px solid #b8913a;outline-offset:3px}';
    d.head.appendChild(style);
    banner = d.createElement('section');
    banner.id = 'arc-measurement-choices';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Choix de mesure publicitaire');
    banner.innerHTML = '<p><strong>Mesure publicitaire facultative</strong></p>' +
      '<p>Avec votre accord, OpenAI utilise des cookies pour relier vos demandes de contact à nos annonces. ' +
      'Le Pixel peut aussi utiliser des coordonnées pseudonymisées issues des formulaires. ' +
      'Vous pouvez refuser ou retirer votre accord à tout moment via « Mesure publicitaire ». ' +
      '<a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noopener noreferrer">Confidentialité OpenAI</a></p>' +
      '<div class="arc-measurement-actions"><button type="button" data-arc-consent="accept">Accepter</button>' +
      '<button type="button" data-arc-consent="decline">Refuser</button></div>';
    banner.hidden = consent !== null;
    banner.querySelector('[data-arc-consent="accept"]').addEventListener('click', function () { setConsent(true); });
    banner.querySelector('[data-arc-consent="decline"]').addEventListener('click', function () { setConsent(false); });
    d.body.appendChild(banner);

    var preferences = d.createElement('button');
    preferences.id = 'arc-measurement-preferences';
    preferences.type = 'button';
    preferences.textContent = 'Mesure publicitaire';
    preferences.addEventListener('click', showChoices);
    d.body.appendChild(preferences);
    try { initialize(); } catch (_) { /* Une erreur de mesure ne bloque pas la page. */ }
  }

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', renderChoices);
  else renderChoices();
})(window, document);
