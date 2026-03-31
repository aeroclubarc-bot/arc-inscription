import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

// Home
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "home.html")));
app.get("/home-arc", (req, res) => res.sendFile(path.join(__dirname, "home.html")));

// Flotte
app.get("/la-flotte", (req, res) => res.sendFile(path.join(__dirname, "laflotte.html")));

// Formation
app.get("/formation", (req, res) => res.sendFile(path.join(__dirname, "ppl.html")));
app.get("/ppl", (req, res) => res.sendFile(path.join(__dirname, "ppl.html")));

// Post-PPL
app.get("/post-ppl", (req, res) => res.sendFile(path.join(__dirname, "postppl.html")));
app.get("/postppl", (req, res) => res.sendFile(path.join(__dirname, "postppl.html")));

// Aérodrome
app.get("/aerodrome", (req, res) => res.sendFile(path.join(__dirname, "aerodrome.html")));

// Contact
app.get("/contact", (req, res) => res.sendFile(path.join(__dirname, "contact.html")));

// Tarifs & Adhésion
app.get("/tarifs", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/adhesion", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

// Documents
app.get("/statuts", (req, res) => res.sendFile(path.join(__dirname, "statuts.html")));
app.get("/reglement", (req, res) => res.sendFile(path.join(__dirname, "reglement.html")));

app.listen(PORT, () => {
  console.log(`ARC running on port ${PORT}`);
});
