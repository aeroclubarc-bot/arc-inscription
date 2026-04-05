import express from "express";
import path from "path";
import { fileURLToPath } from "url";

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
// Railway → Settings → Variables → ajouter : STRIPE_SECRET_KEY = sk_live_...
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
app.get("/home-arc", (req, res) => res.sendFile(path.join(__dirname, "home.html")));
app.get("/ppv", (req, res) => res.sendFile(path.join(__dirname, "ppv.html")));
app.get("/accueil", (req, res) => res.sendFile(path.join(__dirname, "accueil.html")));
app.get("/leclub", (req, res) => res.sendFile(path.join(__dirname, "leclub.html")));
app.get("/le-club", (req, res) => res.sendFile(path.join(__dirname, "leclub.html")));
app.get("/la-flotte", (req, res) => res.sendFile(path.join(__dirname, "laflotte.html")));
app.get("/formation", (req, res) => res.sendFile(path.join(__dirname, "ppl.html")));
app.get("/ppl", (req, res) => res.sendFile(path.join(__dirname, "ppl.html")));
app.get("/post-ppl", (req, res) => res.sendFile(path.join(__dirname, "postppl.html")));
app.get("/postppl", (req, res) => res.sendFile(path.join(__dirname, "postppl.html")));
app.get("/aerodrome", (req, res) => res.sendFile(path.join(__dirname, "aerodrome.html")));
app.get("/contact", (req, res) => res.sendFile(path.join(__dirname, "contact.html")));
app.get("/tarifs", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/adhesion", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/inscription", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/statuts", (req, res) => res.sendFile(path.join(__dirname, "statuts.html")));
app.get("/reglement", (req, res) => res.sendFile(path.join(__dirname, "reglement.html")));

app.listen(PORT, () => {
  console.log(`ARC running on port ${PORT}`);
});
