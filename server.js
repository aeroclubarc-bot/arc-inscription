import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/home-arc", (req, res) => {
  res.sendFile(path.join(__dirname, "home.html"));
});

app.get("/ppl", (req, res) => {
  res.sendFile(path.join(__dirname, "ppl.html"));
});

app.get("/postppl", (req, res) => {
  res.sendFile(path.join(__dirname, "postppl.html"));
});

app.get("/statuts", (req, res) => {
  res.sendFile(path.join(__dirname, "statuts.html"));
});

app.get("/reglement", (req, res) => {
  res.sendFile(path.join(__dirname, "reglement.html"));
});

app.listen(PORT, () => {
  console.log(`ARC Inscription running on port ${PORT}`);
});
