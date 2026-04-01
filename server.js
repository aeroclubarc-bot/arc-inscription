import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// CORS headers pour toutes les routes
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.use(express.static(path.join(__dirname)));

// ── PROXY PPV (évite le problème CORS Railway→Railway) ──────────────
app.get("/api/ppv/total", async (req, res) => {
  try {
    const r = await fetch("https://ppv-production.up.railway.app/total");
    const data = await r.json();
    res.json(data);
  } catch(e) {
    res.status(502).json({ error: "PPV unavailable", total_kwh: 0, current_power_w: 0 });
  }
});

app.get("/api/ppv/today", async (req, res) => {
  try {
    const r = await fetch("https://ppv-production.up.railway.app/stats/today");
    const data = await r.json();
    res.json(data);
  } catch(e) {
    res.status(502).json({ error: "PPV unavailable", today_kwh: 0 });
  }
});

// ── PAGES ────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.redirect(301, "/home-arc"));
app.get("/home-arc", (req, res) => res.sendFile(path.join(__dirname, "home.html")));
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
