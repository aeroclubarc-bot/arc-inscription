import express from "express";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { Resend } from "resend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// ── POSTGRES (optionnel) ──────────────────────────────────────────────
// Si DATABASE_URL est défini (plugin Railway Postgres), on l'utilise pour
// les notes atelier. Sinon, les notes restent en local-only (localStorage navigateur).
let pgPool = null;
let pgReady = false;
if (process.env.DATABASE_URL) {
  try {
    const pgMod = await import("pg");
    pgPool = new pgMod.default.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("railway") ? { rejectUnauthorized: false } : false,
    });
    // Migration idempotente
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS atelier_notes (
        id INT PRIMARY KEY DEFAULT 1,
        content TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by TEXT
      );
    `);
    await pgPool.query(`
      INSERT INTO atelier_notes (id, content) VALUES (1, '')
      ON CONFLICT (id) DO NOTHING;
    `);
    // Codes promo à usage unique — validés et consommés côté serveur uniquement.
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS single_use_promo_codes (
        code TEXT PRIMARY KEY,
        discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
        discount_value NUMERIC NOT NULL,
        scope TEXT[] NOT NULL DEFAULT ARRAY['arc']::TEXT[],
        label TEXT NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        used_at TIMESTAMPTZ,
        used_by TEXT,
        payment_intent_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Migration : assiette de la réduction sur les bases créées avant cette colonne.
    // Les codes existants conservent leur comportement (cotisation ARC seule).
    await pgPool.query(`
      ALTER TABLE single_use_promo_codes
      ADD COLUMN IF NOT EXISTS scope TEXT[] NOT NULL DEFAULT ARRAY['arc']::TEXT[];
    `);
    // Dons — enregistrés après vérification du paiement auprès de Stripe.
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS dons (
        id             SERIAL PRIMARY KEY,
        session_id     TEXT UNIQUE NOT NULL,
        numero_recu    TEXT,
        montant_cents  INTEGER NOT NULL,
        profil         TEXT NOT NULL,
        nom            TEXT,
        email          TEXT,
        adresse        TEXT,
        recu_envoye    BOOLEAN NOT NULL DEFAULT FALSE,
        cree_le        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    pgReady = true;
    console.log("✓ PostgreSQL connecté — sync notes atelier activée");
  } catch (e) {
    console.error("✗ PostgreSQL setup échoué :", e.message);
    console.error("  → Les notes resteront en local navigateur uniquement.");
    pgPool = null;
    pgReady = false;
  }
} else {
  console.log("⚠ DATABASE_URL non défini — sync notes serveur désactivée");
}

// ── MIDDLEWARE GLOBAL ──────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS + OPTIONS preflight
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── DOMAINE CANONIQUE ─────────────────────────────────────────────────
const CANONICAL = "www.aeroclub-arc.fr";
const ALIASES = [
  "www.aeroclub-arc.com",
  "www.aeroclubarc.fr",
  "www.aeroclubarc.com",
  "aeroclub-arc.fr",
  "aeroclub-arc.com",
  "aeroclubarc.fr",
  "aeroclubarc.com",
];
app.use((req, res, next) => {
  const host = req.hostname;
  if (ALIASES.includes(host)) {
    return res.redirect(301, `https://${CANONICAL}${req.originalUrl}`);
  }
  next();
});

// ── PAGE D'ACCUEIL ────────────────────────────────────────────────────
// `/` SERT la page d'accueil (elle déclare <link rel=canonical href="/">).
// L'ancienne URL /home-arc redirige vers elle. Ne pas réinverser : cela
// recréerait la boucle canonique qui a désindexé l'accueil.
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "home.html")));
app.get("/home-arc", (req, res) => res.redirect(301, "/"));
app.get("/accueil", (req, res) => res.redirect(301, "/"));

// ── AUTH MAINTENANCE ──────────────────────────────────────────────────
// Mot de passe partagé entre mécaniciens — défini en variable d'env Railway.
// Token = SHA-256 du mot de passe (stocké en cookie HttpOnly).
const MAINT_PASSWORD = process.env.MAINTENANCE_PASSWORD || "changeme-set-env-var";
const MAINT_COOKIE = "arc-maint-auth";
const MAINT_TOKEN = crypto.createHash("sha256").update(MAINT_PASSWORD).digest("hex");
const MAINT_COOKIE_MAXAGE = 60 * 60 * 24; // 24h

function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  const parts = raw.split(";").map(s => s.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return p.slice(name.length + 1);
  }
  return null;
}

function maintAuth(req, res, next) {
  const token = getCookie(req, MAINT_COOKIE);
  if (token && token === MAINT_TOKEN) return next();
  // Pour les pages (GET/HEAD non-API) on redirige vers le login ; pour l'API on renvoie 401 JSON.
  const isApi = req.path.startsWith("/api/");
  if (!isApi && (req.method === "GET" || req.method === "HEAD")) {
    const dest = encodeURIComponent(req.originalUrl);
    return res.redirect(`/maintenance/login?next=${dest}`);
  }
  return res.status(401).json({ error: "Authentification requise" });
}

// Bloque l'accès direct aux fichiers HTML protégés (contournement express.static)
const PROTECTED_HTML = new Set([
  "/maintenance.html",
  "/maintenance-login.html",
  "/entretien-d113.html",
  "/entretien-dr250.html",
  "/entretien-dh251.html",
  "/signer-ot.html",
  "/promo-admin.html",
]);
app.use((req, res, next) => {
  if (PROTECTED_HTML.has(req.path)) {
    // Redirige vers la version sans .html (qui passe par maintAuth)
    const cleanPath = req.path.replace(/\.html$/, "");
    return res.redirect(302, cleanPath);
  }
  next();
});

// Page login (publique)
app.get("/maintenance/login", (req, res) => {
  res.sendFile(path.join(__dirname, "maintenance-login.html"));
});

// API auth (publique — vérifie le mot de passe, pose le cookie)
app.post("/api/maintenance/auth", (req, res) => {
  const pw = (req.body && req.body.password) || "";
  if (pw !== MAINT_PASSWORD) {
    return res.status(401).json({ error: "Mot de passe incorrect" });
  }
  res.setHeader(
    "Set-Cookie",
    `${MAINT_COOKIE}=${MAINT_TOKEN}; Path=/; Max-Age=${MAINT_COOKIE_MAXAGE}; SameSite=Strict; HttpOnly`
  );
  res.json({ ok: true });
});

// ── NOTES ATELIER (sync serveur) ──────────────────────────────────────
// Protégé par maintAuth — seuls les mécanos authentifiés peuvent lire/écrire.
app.get("/api/notes", maintAuth, async (req, res) => {
  if (!pgReady) return res.status(503).json({ error: "Notes serveur indisponibles (DB non configurée)" });
  try {
    const { rows } = await pgPool.query(
      "SELECT content, updated_at, updated_by FROM atelier_notes WHERE id = 1"
    );
    if (rows.length === 0) return res.json({ content: "", updated_at: null, updated_by: null });
    res.json({
      content: rows[0].content,
      updated_at: rows[0].updated_at,
      updated_by: rows[0].updated_by,
    });
  } catch (e) {
    console.error("GET /api/notes error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/notes", maintAuth, async (req, res) => {
  if (!pgReady) return res.status(503).json({ error: "Notes serveur indisponibles (DB non configurée)" });
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (content === null) return res.status(400).json({ error: "Champ 'content' (string) requis" });
  // Limite raisonnable pour empêcher l'abus
  if (content.length > 200000) return res.status(413).json({ error: "Notes trop volumineuses (max 200 ko)" });
  const updatedBy = (req.body?.updated_by || "").toString().slice(0, 80) || null;
  try {
    const { rows } = await pgPool.query(
      `UPDATE atelier_notes
       SET content = $1, updated_at = NOW(), updated_by = $2
       WHERE id = 1
       RETURNING updated_at`,
      [content, updatedBy]
    );
    res.json({ ok: true, updated_at: rows[0].updated_at });
  } catch (e) {
    console.error("POST /api/notes error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── CODES PROMO À USAGE UNIQUE (Postgres) ─────────────────────────────
// Ces codes sont distincts des PROMO_CODES statiques côté client (POUF2026,
// FAMILLE, etc. — réutilisables). Ceux-ci sont créés un par un, vérifiés au
// moment de la saisie, et consommés seulement après un paiement Stripe
// confirmé réussi — jamais sur simple déclaration du navigateur.

// Vérifie un code — appelé quand le code saisi ne matche aucun PROMO_CODES statique
app.post("/api/promo/check", async (req, res) => {
  if (!pgReady) return res.status(503).json({ valid: false, reason: "db_unavailable" });
  const code = (req.body?.code || "").toString().trim().toUpperCase();
  if (!code) return res.json({ valid: false, reason: "empty" });
  try {
    const { rows } = await pgPool.query(
      "SELECT discount_type, discount_value, scope, label, used FROM single_use_promo_codes WHERE code = $1",
      [code]
    );
    if (rows.length === 0) return res.json({ valid: false, reason: "not_found" });
    if (rows[0].used) return res.json({ valid: false, reason: "used" });
    res.json({
      valid: true,
      type: rows[0].discount_type,
      value: Number(rows[0].discount_value),
      scope: rows[0].scope && rows[0].scope.length ? rows[0].scope : ["arc"],
      label: rows[0].label,
    });
  } catch (e) {
    console.error("POST /api/promo/check error:", e.message);
    res.status(500).json({ valid: false, reason: "server_error" });
  }
});

// Consomme un code — appelé UNIQUEMENT après succès du paiement Stripe.
// Revérifie auprès de Stripe que le PaymentIntent a bien réussi avant de marquer le code utilisé.
app.post("/api/promo/consume", async (req, res) => {
  if (!pgReady) return res.status(503).json({ ok: false, error: "db_unavailable" });
  const code = (req.body?.code || "").toString().trim().toUpperCase();
  const paymentIntentId = (req.body?.payment_intent_id || "").toString().trim();
  if (!code || !paymentIntentId) {
    return res.status(400).json({ ok: false, error: "code et payment_intent_id requis" });
  }
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) return res.status(500).json({ ok: false, error: "Stripe non configuré" });
  try {
    // Vérification indépendante auprès de Stripe — on ne fait jamais confiance au client seul
    const r = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
      headers: { "Authorization": `Bearer ${stripeSecretKey}` },
    });
    const pi = await r.json();
    if (!r.ok || pi.status !== "succeeded") {
      return res.status(400).json({ ok: false, error: "Paiement non confirmé auprès de Stripe" });
    }
    const usedBy = pi.receipt_email || pi.metadata?.name || null;
    const { rows } = await pgPool.query(
      `UPDATE single_use_promo_codes
       SET used = TRUE, used_at = NOW(), used_by = $2, payment_intent_id = $3
       WHERE code = $1 AND used = FALSE
       RETURNING code`,
      [code, usedBy, paymentIntentId]
    );
    if (rows.length === 0) {
      // Déjà consommé entre-temps (double-clic, tentative concurrente, etc.)
      return res.status(409).json({ ok: false, error: "Code déjà utilisé" });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /api/promo/consume error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Crée un nouveau code à usage unique — protégé par le mot de passe atelier/maintenance existant
app.post("/api/promo/create", maintAuth, async (req, res) => {
  if (!pgReady) return res.status(503).json({ ok: false, error: "db_unavailable" });
  const code = (req.body?.code || "").toString().trim().toUpperCase();
  const type = req.body?.type === "fixed" ? "fixed" : "percent";
  const value = Number(req.body?.value);
  const label = (req.body?.label || "").toString().trim() || `Code offert — ${code}`;
  // Assiette : postes sur lesquels porte la réduction. AUDACE en est toujours exclu.
  const SCOPES = ["arc", "ffa", "annexes", "caution"];
  const scope = Array.isArray(req.body?.scope)
    ? req.body.scope.filter((k) => SCOPES.includes(k))
    : ["arc"];
  if (!code || !Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ ok: false, error: "code et value (nombre > 0) requis" });
  }
  if (scope.length === 0) {
    return res.status(400).json({ ok: false, error: "au moins un poste doit être sélectionné" });
  }
  if (type === "percent" && value > 100) {
    return res.status(400).json({ ok: false, error: "un pourcentage ne peut excéder 100" });
  }
  try {
    await pgPool.query(
      `INSERT INTO single_use_promo_codes (code, discount_type, discount_value, scope, label)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO NOTHING`,
      [code, type, value, scope, label]
    );
    res.json({ ok: true, code, type, value, scope, label });
  } catch (e) {
    console.error("POST /api/promo/create error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Liste les codes existants et leur statut — protégée
app.get("/api/promo/list", maintAuth, async (req, res) => {
  if (!pgReady) return res.status(503).json({ error: "db_unavailable" });
  try {
    const { rows } = await pgPool.query(
      "SELECT code, discount_type, discount_value, scope, label, used, used_at, used_by FROM single_use_promo_codes ORDER BY created_at DESC"
    );
    res.json({ codes: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STRIPE PAYMENT INTENT ─────────────────────────────────────────────
app.post("/api/stripe/create-payment-intent", async (req, res) => {
  try {
    const { amount, email, name, description, code_promo } = req.body;
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Montant invalide" });
    }
    // Garde-fou : si un code à usage unique est déclaré, on vérifie qu'il n'est pas déjà consommé
    // avant même de créer l'intention de paiement (bloque les tentatives de réutilisation).
    if (code_promo && pgReady) {
      const { rows } = await pgPool.query(
        "SELECT used FROM single_use_promo_codes WHERE code = $1",
        [code_promo.toString().trim().toUpperCase()]
      );
      if (rows.length > 0 && rows[0].used) {
        return res.status(400).json({ error: "Ce code promo a déjà été utilisé" });
      }
    }
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ error: "Stripe non configuré — clé manquante" });
    }
    const r = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        amount: String(Math.round(Number(amount) * 100)),
        currency: "eur",
        description: description || "Adhésion ARC 2026",
        "receipt_email": email || "",
        "metadata[name]": name || "",
        "metadata[source]": "arc-inscription",
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(400).json({ error: data.error?.message || "Erreur Stripe API" });
    }
    res.json({ clientSecret: data.client_secret });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── TEST EMAIL ────────────────────────────────────────────────────────
app.get("/api/test-email", async (req, res) => {
  const resendKey = process.env.RESEND_API_KEY;
  const destEmail = process.env.DEST_EMAIL || "aeroclubarc@gmail.com";
  if (!resendKey) return res.json({ error: "RESEND_API_KEY manquante" });
  try {
    const resend = new Resend(resendKey);
    const { data, error } = await resend.emails.send({
      from: "Test ARC <onboarding@resend.dev>",
      to: [destEmail],
      subject: "[ARC] Test email Railway",
      text: "Test email depuis Railway — si vous recevez ceci, Resend fonctionne correctement.",
    });
    if (error) return res.status(400).json({ error: error.message, detail: error });
    res.json({ ok: true, emailId: data.id, sentTo: destEmail });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CONTACT SUBMIT ────────────────────────────────────────────────────
app.post("/api/contact/submit", async (req, res) => {
  try {
    const { name, email, telephone, sujet, message } = req.body;
    if (!name || !email || !sujet || !message) {
      return res.status(400).json({ error: "Champs manquants" });
    }
    const resendKey = process.env.RESEND_API_KEY;
    const destEmail = process.env.DEST_EMAIL || "aeroclubarc@gmail.com";
    const emailBody = `NOUVEAU MESSAGE — FORMULAIRE DE CONTACT
════════════════════════════════════════
De : ${name}
Email : ${email}
Téléphone : ${telephone || 'Non renseigné'}
Sujet : ${sujet}

Message :
${message}
════════════════════════════════════════
Répondre à : ${email}`;
    if (!resendKey) {
      console.log("=== CONTACT ===\n" + emailBody);
      return res.json({ ok: true, warning: "Email non envoyé — RESEND_API_KEY manquante" });
    }
    const resend = new Resend(resendKey);
    const { data, error } = await resend.emails.send({
      from: "Contact ARC <onboarding@resend.dev>",
      to: [destEmail],
      reply_to: email,
      subject: `[ARC Contact] ${sujet} — ${name}`,
      text: emailBody,
    });
    if (error) {
      console.error("Resend contact error:", error);
      return res.status(500).json({ error: error.message });
    }
    console.log(`Contact envoyé de ${name} (${email}) — ID: ${data.id}`);
    res.json({ ok: true });
  } catch(e) {
    console.error("Erreur contact submit:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── INSCRIPTION SUBMIT ─────────────────────────────────────────────────
app.post("/api/inscription/submit", async (req, res) => {
  try {
    const d = req.body;
    const emailBody = `NOUVELLE ADHÉSION — AÉROCLUB A.R.C.
════════════════════════════════════════
Date : ${d.date_inscription}
Stripe ID : ${d.stripe_payment_id}
Montant réglé : ${d.montant_paye}
Code promo : ${d.code_promo || 'Aucun'}

══ IDENTITÉ ══
Nom : ${d.nom} ${d.prenom}
Date de naissance : ${d.date_naissance}
Lieu de naissance : ${d.lieu_naissance}
Nationalité : ${d.nationalite}
Sexe : ${d.sexe}
Profession : ${d.profession}
Employeur : ${d.employeur}

══ COORDONNÉES ══
Adresse : ${d.adresse}, ${d.cp} ${d.ville}
Téléphone : ${d.tel}
Mobile : ${d.mobile}
Email : ${d.email}

══ CONTACT D'URGENCE ══
Nom : ${d.urgence_nom} — Tél : ${d.urgence_tel}
Bénéficiaire assurance : ${d.beneficiaire_nom} — ${d.beneficiaire_tel}

══ NIVEAU PILOTE ══
Statut(s) : ${d.statuts}
Qualification(s) : ${d.qualifications}

══ LICENCES & CERTIFICATS ══
N° Licence FFA : ${d.licence_ffa || 'Non renseigné'}
N° Licence CPL/PPL/LAPL : ${d.licence_cpl || 'Non renseigné'}
Date d'obtention : ${d.date_obtention || 'Non renseignée'}
Date de validité : ${d.date_validite || 'Non renseignée'}

══ VISITE MÉDICALE ══
Classe médicale : ${d.medical}
Validité certificat médical : ${d.med_validite || 'Non renseignée'}

══ QUALIFICATION TW ══
Date d'obtention TW : ${d.tw_date || 'Non renseignée'}

══ EXPÉRIENCE AÉRONAUTIQUE (CARNET DE VOL) ══
                  Total      12 mois
Heures DC :       ${String(d.total_dc||0).padStart(6)}     ${String(d.mois_dc||0).padStart(6)}
Heures CDB :      ${String(d.total_cdb||0).padStart(6)}     ${String(d.mois_cdb||0).padStart(6)}
Atterrissages :   ${String(d.total_att||0).padStart(6)}     ${String(d.mois_att||0).padStart(6)}

TW spécifique :
Heures DC TW :    ${d.tw_dc || 0}
Heures CDB TW :   ${d.tw_cdb || 0}
Atterrissages TW : ${d.tw_att || 0}

══ COTISATIONS CHOISIES ══
Adhésion ARC : ${d.cotisation_arc}
Formule FFA : ${d.cotisation_ffa}
Options FFA : ${d.options_ffa}
Code promo : ${d.code_promo}
TOTAL RÉGLÉ : ${d.montant_paye}
════════════════════════════════════════`;
    const resendKey = process.env.RESEND_API_KEY;
    const destEmail = process.env.DEST_EMAIL || "aeroclubarc@gmail.com";
    console.log(`[ARC] Nouvelle adhésion reçue — ${d.prenom} ${d.nom} — Resend key: ${resendKey ? "OK" : "MANQUANTE"} — dest: ${destEmail}`);
    if (!resendKey) {
      console.log("=== NOUVELLE ADHÉSION (pas de clé Resend) ===\n" + emailBody);
      return res.json({ ok: true, warning: "Email non envoyé — RESEND_API_KEY manquante" });
    }
    const resend = new Resend(resendKey);
    const { data, error } = await resend.emails.send({
      from: "Formulaire ARC <onboarding@resend.dev>",
      to: [destEmail],
      reply_to: d.email || destEmail,
      subject: `[ARC] Adhésion — ${d.prenom} ${d.nom} — ${d.montant_paye}`,
      text: emailBody,
    });
    if (error) {
      console.error("Resend error:", error);
      return res.status(500).json({ error: error.message || "Erreur Resend" });
    }
    console.log(`Email envoyé pour ${d.prenom} ${d.nom} — ID: ${data.id}`);
    res.json({ ok: true, emailId: data.id });
  } catch(e) {
    console.error("Erreur inscription submit:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PROXY PPV (cache mémoire 60 s + timeout 5 s) ─────────────────────
// Le service ppv-production sert déjà ses propres données depuis un cache
// (aucun appel Solarman par requête). Ce cache-ci évite en plus de le
// solliciter à chaque visiteur : 1 requête amont par minute maximum,
// et le site reste réactif même si le service solaire est indisponible.
const PPV_UPSTREAM = "https://ppv-production.up.railway.app";
const PPV_CACHE_TTL_MS = 60 * 1000;
const ppvCache = {}; // { [path]: { data, fetchedAt } }

async function ppvProxy(upstreamPath, fallback, res) {
  const cached = ppvCache[upstreamPath];
  const now = Date.now();

  if (cached && now - cached.fetchedAt < PPV_CACHE_TTL_MS) {
    res.set("Cache-Control", "public, max-age=60");
    return res.json(cached.data);
  }

  try {
    const r = await fetch(`${PPV_UPSTREAM}${upstreamPath}`, {
      headers: { "Accept": "application/json", "User-Agent": "ARC-Proxy/1.0" },
      signal: AbortSignal.timeout(5000)
    });
    const contentType = r.headers.get("content-type") || "";
    if (!r.ok || !contentType.includes("application/json")) {
      const text = await r.text();
      console.log(`PPV ${upstreamPath} non-JSON:`, r.status, text.slice(0, 100));
      // Mieux vaut servir la dernière valeur connue qu'un zéro
      return res.json(cached ? cached.data : { ...fallback, error: "upstream_error" });
    }
    const data = await r.json();
    ppvCache[upstreamPath] = { data, fetchedAt: now };
    res.set("Cache-Control", "public, max-age=60");
    res.json(data);
  } catch (e) {
    console.log(`PPV ${upstreamPath} error:`, e.message);
    res.json(cached ? cached.data : { ...fallback, error: e.message });
  }
}

app.get("/api/ppv/total", (req, res) =>
  ppvProxy("/total", { total_kwh: 0, current_power_w: 0 }, res)
);

app.get("/api/ppv/today", (req, res) =>
  ppvProxy("/stats/today", { today_kwh: 0 }, res)
);

// ── STATIC FILES (après les routes API) ──────────────────────────────
// ── REDIRECTIONS 301 ──────────────────────────────────────────────────
// Anciennes URLs Webflow encore explorées par Google (404 en Search Console).
const REDIRECTIONS_HERITEES = {
  "/flotte":      "/la-flotte",
  "/club":        "/leclub",
  "/instructeur": "/leclub",
};
for (const [ancienne, cible] of Object.entries(REDIRECTIONS_HERITEES)) {
  app.get(ancienne, (req, res) => res.redirect(301, cible));
}

// Chaque page est aussi servie en .html par express.static, ce qui crée un
// doublon pour Google. On renvoie vers l'URL propre. Les pages protégées
// (entretien-*, maintenance, signer-ot, promo-admin) ne sont pas listées :
// elles restent gérées par le middleware d'authentification.
const URLS_PROPRES = {
  "home": "/", "accueil": "/", "leclub": "/leclub",
  "laflotte": "/la-flotte", "ppl": "/formation", "postppl": "/post-ppl",
  "aerodrome": "/aerodrome", "contact": "/contact", "ppv": "/ppv",
  "statuts": "/statuts", "reglement": "/reglement", "soutenir": "/soutenir",
  "index": "/adhesion", "arc-inscription": "/adhesion",
  "merci-don": "/don/merci",
};
app.use((req, res, next) => {
  const m = req.path.match(/^\/([a-z0-9-]+)\.html$/i);
  if (m) {
    const cible = URLS_PROPRES[m[1].toLowerCase()];
    if (cible) return res.redirect(301, cible);
  }
  next();
});

app.use(express.static(path.join(__dirname)));

// ── PAGES ─────────────────────────────────────────────────────────────
app.get("/ppv",            (req, res) => res.sendFile(path.join(__dirname, "ppv.html")));
app.get("/leclub",         (req, res) => res.sendFile(path.join(__dirname, "leclub.html")));
app.get("/le-club",        (req, res) => res.sendFile(path.join(__dirname, "leclub.html")));
app.get("/la-flotte",      (req, res) => res.sendFile(path.join(__dirname, "laflotte.html")));
app.get("/formation",      (req, res) => res.sendFile(path.join(__dirname, "ppl.html")));
app.get("/ppl",            (req, res) => res.sendFile(path.join(__dirname, "ppl.html")));
app.get("/post-ppl",       (req, res) => res.sendFile(path.join(__dirname, "postppl.html")));
app.get("/postppl",        (req, res) => res.sendFile(path.join(__dirname, "postppl.html")));
app.get("/aerodrome",      (req, res) => res.sendFile(path.join(__dirname, "aerodrome.html")));
app.get("/contact",        (req, res) => res.sendFile(path.join(__dirname, "contact.html")));
app.get("/tarifs",         (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/adhesion",       (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/inscription",    (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/statuts",        (req, res) => res.sendFile(path.join(__dirname, "statuts.html")));
app.get("/reglement",      (req, res) => res.sendFile(path.join(__dirname, "reglement.html")));

// ══ DONS / MÉCÉNAT ════════════════════════════════════════════════════
app.get("/soutenir", (req, res) => res.sendFile(path.join(__dirname, "soutenir.html")));
app.get("/don",      (req, res) => res.redirect(302, "/soutenir#don"));

const DON_MIN = 10;      // €
const DON_MAX = 50000;   // €

// Crée la session Stripe Checkout — appel REST direct, comme /api/promo/consume
app.post("/api/don/checkout", async (req, res) => {
  const montant = Math.round(Number(req.body?.montant));
  const profil  = req.body?.profil === "entreprise" ? "entreprise" : "particulier";

  if (!Number.isFinite(montant) || montant < DON_MIN || montant > DON_MAX) {
    return res.status(400).json({
      error: `Le montant doit être compris entre ${DON_MIN} € et ${DON_MAX.toLocaleString("fr-FR")} €`,
    });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) return res.status(500).json({ error: "Stripe non configuré" });

  const base = `https://${CANONICAL}`;
  const params = new URLSearchParams({
    "mode": "payment",
    "locale": "fr",
    "submit_type": "donate",
    "billing_address_collection": "required",   // nom + adresse : requis pour le reçu fiscal
    "customer_creation": "always",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(montant * 100),
    "line_items[0][price_data][product_data][name]": "Don à l'Aéroclub A.R.C.",
    "line_items[0][price_data][product_data][description]":
      profil === "entreprise"
        ? "Mécénat d'entreprise (art. 238 bis CGI) — reçu 2041-MEC délivré en début d'année"
        : "Don d'un particulier (art. 200 CGI) — reçu Cerfa 11580 délivré en début d'année",
    "metadata[type]": "don",
    "metadata[profil]": profil,
    "payment_intent_data[description]": `Don ${profil} — ${montant} € — Aéroclub A.R.C.`,
    "success_url": `${base}/don/merci?session_id={CHECKOUT_SESSION_ID}`,
    "cancel_url": `${base}/soutenir#don`,
  });

  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const session = await r.json();
    if (!r.ok || !session.url) {
      console.error("[don] Stripe:", session.error?.message || r.status);
      return res.status(502).json({ error: "Session de paiement indisponible" });
    }
    res.json({ url: session.url });
  } catch (e) {
    console.error("POST /api/don/checkout error:", e.message);
    res.status(500).json({ error: "Création de la session impossible" });
  }
});

// Relit le statut auprès de Stripe puis enregistre — on ne fait jamais
// confiance au seul retour navigateur.
async function enregistrerDon(sessionId) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey || !sessionId) return null;

  const r = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { "Authorization": `Bearer ${stripeSecretKey}` } }
  );
  const s = await r.json();
  if (!r.ok || s.payment_status !== "paid" || s.metadata?.type !== "don") return null;

  const d = s.customer_details || {};
  const a = d.address || {};
  const adresse = [a.line1, a.line2, `${a.postal_code || ""} ${a.city || ""}`.trim(), a.country]
    .filter(Boolean).join(", ");

  let nouveau = false;
  if (pgPool) {
    const { rows } = await pgPool.query(
      `INSERT INTO dons (session_id, montant_cents, profil, nom, email, adresse)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (session_id) DO NOTHING
       RETURNING id`,
      [s.id, s.amount_total, s.metadata.profil, d.name, d.email, adresse]
    );
    nouveau = rows.length > 0;   // false = page rechargée, pas de second mail
  }

  if (nouveau) {
    const montant = (s.amount_total / 100).toLocaleString("fr-FR");
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const resend = new Resend(resendKey);
      try {
        await resend.emails.send({
          from: "Aéroclub A.R.C. <contact@aeroclub-arc.fr>",
          to: d.email,
          subject: `Merci pour votre don de ${montant} €`,
          html: `
            <p>Bonjour${d.name ? " " + d.name : ""},</p>
            <p>Nous avons bien reçu votre don de <strong>${montant} €</strong>. Merci.</p>
            <p>Il financera directement l'entretien de nos Jodel et nos actions auprès des
               jeunes : préparation au BIA et vols découverte.</p>
            <p>Votre <strong>reçu fiscal</strong> vous sera adressé en début d'année prochaine :
               Cerfa 11580 pour un particulier, à reporter ligne 7UF de votre déclaration de
               revenus ; imprimé 2041-MEC au titre du mécénat d'entreprise.</p>
            <p>Bons vols,<br>A. Drieu — Président<br>
               Aéroclub A.R.C., Aérodrome de Chavenay-Villepreux (LFPX)</p>`,
        });
      } catch (e) { console.error("[don] mail donateur:", e.message); }

      try {
        await resend.emails.send({
          from: "Site A.R.C. <contact@aeroclub-arc.fr>",
          to: "contact@aeroclub-arc.fr",
          subject: `Nouveau don : ${montant} € (${s.metadata.profil})`,
          html: `<p><strong>${montant} €</strong> — ${s.metadata.profil}</p>
                 <p>${d.name || "—"}<br>${d.email || "—"}<br>${adresse || "—"}</p>
                 <p style="color:#888;font-size:12px">Session ${s.id}</p>`,
        });
      } catch (e) { console.error("[don] mail interne:", e.message); }
    }
  }
  return s;
}

app.get("/don/merci", async (req, res) => {
  try {
    await enregistrerDon((req.query.session_id || "").toString());
  } catch (e) {
    // Le donateur a payé : on ne lui affiche jamais d'erreur ici.
    console.error("[don] enregistrement:", e.message);
  }
  res.sendFile(path.join(__dirname, "merci-don.html"));
});

// Export CSV pour l'édition des reçus en janvier — protégé par maintAuth
app.get("/api/dons/export", maintAuth, async (req, res) => {
  if (!pgPool) return res.status(503).send("Base indisponible");
  const annee = parseInt(req.query.annee, 10) || new Date().getFullYear();
  try {
    const { rows } = await pgPool.query(
      `SELECT cree_le, montant_cents, profil, nom, email, adresse, numero_recu, recu_envoye
         FROM dons WHERE EXTRACT(YEAR FROM cree_le) = $1 ORDER BY cree_le`,
      [annee]
    );
    const csv = ["Date;Montant EUR;Profil;Nom;Email;Adresse;N recu;Recu envoye"]
      .concat(rows.map(r => [
        r.cree_le.toISOString().slice(0, 10),
        (r.montant_cents / 100).toFixed(2).replace(".", ","),
        r.profil, r.nom || "", r.email || "",
        (r.adresse || "").replace(/;/g, ","),
        r.numero_recu || "",
        r.recu_envoye ? "oui" : "non",
      ].join(";")))
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="dons-${annee}.csv"`);
    res.send("\uFEFF" + csv);   // BOM pour Excel
  } catch (e) {
    console.error("GET /api/dons/export error:", e.message);
    res.status(500).send("Erreur export");
  }
});
// ══════════════════════════════════════════════════════════════════════

// ── ATELIER MAINTENANCE (PROTÉGÉ) ─────────────────────────────────────
app.get("/maintenance",     maintAuth, (req, res) => res.sendFile(path.join(__dirname, "maintenance.html")));
app.get("/entretien-d113",  maintAuth, (req, res) => res.sendFile(path.join(__dirname, "entretien-d113.html")));
app.get("/entretien-dr250", maintAuth, (req, res) => res.sendFile(path.join(__dirname, "entretien-dr250.html")));
app.get("/entretien-dh251", maintAuth, (req, res) => res.sendFile(path.join(__dirname, "entretien-dh251.html")));
app.get("/signer-ot",       maintAuth, (req, res) => res.sendFile(path.join(__dirname, "signer-ot.html")));
app.get("/promo-admin",     maintAuth, (req, res) => res.sendFile(path.join(__dirname, "promo-admin.html")));

app.get("/sitemap.xml", (req, res) => {
  res.setHeader("Content-Type", "application/xml");
  res.sendFile(path.join(__dirname, "sitemap.xml"));
});
app.get("/robots.txt", (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.send("User-agent: *\nAllow: /\nDisallow: /maintenance\nDisallow: /entretien-d113\nDisallow: /entretien-dr250\nDisallow: /entretien-dh251\nDisallow: /signer-ot\nDisallow: /promo-admin\nSitemap: https://www.aeroclub-arc.fr/sitemap.xml\n");
});

app.listen(PORT, () => {
  console.log(`ARC running on port ${PORT}`);
  console.log(`▸ Maintenance auth: ENABLED (build 2026-05-22 v3 + notes sync)`);
  console.log(`▸ Maintenance password: ${MAINT_PASSWORD === "changeme-set-env-var" ? "⚠️  DEFAULT (set MAINTENANCE_PASSWORD env var!)" : "✓ from MAINTENANCE_PASSWORD env"}`);
  console.log(`▸ Notes sync (PostgreSQL): ${pgReady ? "✓ ENABLED" : "✗ disabled (DATABASE_URL not set or DB unreachable)"}`);
  console.log(`▸ Protected routes: /maintenance, /entretien-d113, /entretien-dr250, /entretien-dh251, /signer-ot, /promo-admin`);
});
