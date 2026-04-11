import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

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

// ── REDIRECT / ────────────────────────────────────────────────────────
app.get("/", (req, res) => res.redirect(301, "/home-arc"));

// ── STRIPE PAYMENT INTENT ─────────────────────────────────────────────
app.post("/api/stripe/create-payment-intent", async (req, res) => {
  try {
    const { amount, email, name, description } = req.body;
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Montant invalide" });
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

// ── PROXY PPV ─────────────────────────────────────────────────────────
app.get("/api/ppv/total", async (req, res) => {
  try {
    const r = await fetch("https://ppv-production.up.railway.app/total", {
      headers: { "Accept": "application/json", "User-Agent": "ARC-Proxy/1.0" }
    });
    const contentType = r.headers.get("content-type") || "";
    if (!r.ok || !contentType.includes("application/json")) {
      const text = await r.text();
      console.log("PPV total non-JSON:", r.status, text.slice(0, 100));
      return res.json({ total_kwh: 0, current_power_w: 0, error: "upstream_error" });
    }
    const data = await r.json();
    res.json(data);
  } catch(e) {
    console.log("PPV total error:", e.message);
    res.json({ total_kwh: 0, current_power_w: 0, error: e.message });
  }
});

app.get("/api/ppv/today", async (req, res) => {
  try {
    const r = await fetch("https://ppv-production.up.railway.app/stats/today", {
      headers: { "Accept": "application/json", "User-Agent": "ARC-Proxy/1.0" }
    });
    const contentType = r.headers.get("content-type") || "";
    if (!r.ok || !contentType.includes("application/json")) {
      const text = await r.text();
      console.log("PPV today non-JSON:", r.status, text.slice(0, 100));
      return res.json({ today_kwh: 0, error: "upstream_error" });
    }
    const data = await r.json();
    res.json(data);
  } catch(e) {
    console.log("PPV today error:", e.message);
    res.json({ today_kwh: 0, error: e.message });
  }
});

// ── STATIC FILES (après les routes API) ──────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── PAGES ─────────────────────────────────────────────────────────────
app.get("/home-arc",       (req, res) => res.sendFile(path.join(__dirname, "home.html")));
app.get("/ppv",            (req, res) => res.sendFile(path.join(__dirname, "ppv.html")));
app.get("/accueil",        (req, res) => res.sendFile(path.join(__dirname, "accueil.html")));
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

// ── ENTRETIEN DR250 ───────────────────────────────────────────────────
app.get("/entretien-dr250", (req, res) => res.sendFile(path.join(__dirname, "entretien-dr250.html")));

// ── ENTRETIEN D113 ───────────────────────────────────────────────────
app.get("/entretien-d113", (req, res) => res.sendFile(path.join(__dirname, "entretien-d113.html")));

app.get("/sitemap.xml", (req, res) => {
  res.setHeader("Content-Type", "application/xml");
  res.sendFile(path.join(__dirname, "sitemap.xml"));
});
app.get("/robots.txt", (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.send("User-agent: *\nAllow: /\nDisallow: /tarifs\nDisallow: /inscription\nDisallow: /adhesion\nSitemap: https://www.aeroclub-arc.fr/sitemap.xml\n");
});

app.listen(PORT, () => {
  console.log(`ARC running on port ${PORT}`);
});
