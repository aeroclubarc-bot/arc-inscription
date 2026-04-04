import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// CORS headers
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ── REDIRECT / avant express.static ──────────────────────────────────
app.get("/", (req, res) => res.redirect(301, "/home-arc"));

// ── PROXY PPV ─────────────────────────────────────────────────────────
app.get("/api/ppv/total", async (req, res) => {
  try {
    const r = await fetch("https://ppv-production.up.railway.app/total", {
      headers: { "Accept": "application/json", "User-Agent": "ARC-Proxy/1.0" }
    });
    // Vérifier que la réponse est bien du JSON
    const contentType = r.headers.get("content-type") || "";
    if (!r.ok || !contentType.includes("application/json")) {
      const text = await r.text();
      console.log("PPV total non-JSON response:", r.status, text.slice(0, 100));
      return res.json({ total_kwh: 0, current_power_w: 0, error: "upstream_error" });
    }
    const data = await r.json();
    res.json(data);
  } catch(e) {
    console.log("PPV total fetch error:", e.message);
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
      console.log("PPV today non-JSON response:", r.status, text.slice(0, 100));
      return res.json({ today_kwh: 0, error: "upstream_error" });
    }
    const data = await r.json();
    res.json(data);
  } catch(e) {
    console.log("PPV today fetch error:", e.message);
    res.json({ today_kwh: 0, error: e.message });
  }
});

// ── STATIC FILES ──────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── PAGES ─────────────────────────────────────────────────────────────
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
