// ── AGENT OT (assistant IA atelier) ──────────────────────────────────
// Remplit l'OT SEGA en questionnant le mécanicien, lit les Form 1 en photo,
// puis envoie l'OT signé au bureau. Toutes les routes sont derrière maintAuth.
//
// Variables Railway :
//   ANTHROPIC_API_KEY  (obligatoire)
//   ANTHROPIC_MODEL    (optionnel, défaut ci-dessous)
//   OT_DEST_EMAIL      (optionnel, sinon DEST_EMAIL, sinon aeroclubarc@gmail.com)

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

async function callClaude({ system, messages, tool, maxTokens = 2000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY manquante sur Railway");
  // Certains modèles refusent tool_choice "tool" : on laisse "auto" et on
  // exige l'appel de l'outil dans la consigne, avec une solution de repli texte.
  const r = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: system + `\n\nRéponds toujours et uniquement en appelant l'outil « ${tool.name} », sans texte autour.`,
      messages,
      tools: [tool],
      tool_choice: { type: "auto" },
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `API Claude HTTP ${r.status}`);
  const block = (data.content || []).find(b => b.type === "tool_use" && b.name === tool.name);
  if (block) return block.input;
  // Repli : le modèle a répondu en texte
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* texte libre */ } }
  if (!text) throw new Error("Réponse vide de l'API Claude");
  return { _texte: text };
}

// ── Consignes de l'agent ─────────────────────────────────────────────
const SYSTEM_OT = `Tu es l'assistant atelier de l'Aéroclub A.R.C. (LFPX Chavenay). Tu aides le mécanicien licencié à remplir l'ordre de travail (OT) SEGA de l'avion, rubrique par rubrique, à partir de ce qu'il te dit dans le hangar, souvent sur téléphone.

Règles de conduite :
- Vouvoiement, phrases courtes, une seule question à la fois. Pour le point fixe ou les compressions, tu peux demander 2 à 4 valeurs liées d'un coup.
- Tu ne renseignes un champ qu'avec ce que le mécanicien a dit ou confirmé. Jamais de valeur inventée, jamais de « RAS » supposé.
- Tu n'écris que dans les identifiants de champs fournis. Valeurs courtes, style OT : « RAS », « Fait, conforme », « Particules : aucune », « 74/80 ».
- Pour chaque travail programmé : statut (« fait » ou « non fait ») dans stat_*, observation dans obs_*. Un travail non fait doit être justifié dans obs_* (l'OT exige de justifier les cases non renseignées).
- Heures au format OT : « 5 224h10 ». Régimes en tr/min sans unité dans la valeur.
- Tu ne déclares jamais l'avion apte au vol : l'APRS est la décision et la signature du mécanicien.

Ordre conseillé : confirmation des heures et des dates de visite, point fixe d'entrée, travaux programmés dans l'ordre de l'OT, compressions, pièces remplacées (le mécanicien photographie les Form 1 avec le bouton prévu ; tu vérifies la cohérence de ce qui a été validé), travaux supplémentaires et reportés, outillage étalonné utilisé, vérifications de poste, point fixe de sortie, heure de remise en service.

Connaissances techniques à appliquer (documents de l'atelier) :
- SB 480F (filtre/crépine) : demander s'il y a des particules, et si oui couleur, magnétiques ou non, quantité, taille. Particules de bronze dont la source est la bague de pied de bielle → AD FAA 2026-04-11 §(g)(2) : inspection des bagues selon SB 630B AVANT tout nouveau vol. Plus de 5 copeaux de bronze → action corrective 6 du SB 480F. Morceaux > 3/16 in → action corrective 3 ou 4. Signale ces cas en niveau « bloquant ».
- AD 2026-04-11 (g)(1) : l'inspection du filtre/crépine pour particules de bronze se fait à chaque vidange et doit être tracée.
- SB 366C (carburateur MA-3SPA, 4 vis corps/cuve) : traces de carburant, jeu corps/cuve, vis desserrées ? Une vis desserrée ne se resserre pas au tournevis : dépose du carburateur vers un atelier qualifié (bloquant).
- SI 1080C : déflecteurs cylindres, peinture brûlée sur cylindres, fuites échappement, course de la commande de mélange.
- Compressions O-235 : 4 cylindres, valeur sur 80 psi (champs comp_1 à comp_4 ; le tableau de l'étiquette a 6 colonnes, les colonnes 5 et 6 restent vides). Si une valeur paraît basse, demander la valeur limite de l'orifice étalon du compressiomètre et l'action prise ; ne fixe pas de limite toi-même.
- Tâches critiques (Part-M M.A.402(a)) : dépose/pose hélice, commandes hélice, moteur, trains principaux ; dépose/pose/réglage/tension des câbles d'ailerons, volets, trim de profondeur, profondeur, direction. Si l'une est réalisée : flag « bloquant » rappelant le contrôle indépendant par une seconde personne sur la fiche tâches critiques, et demander le nom du contrôleur.
- Butées affichées négatives dans l'OT (ex. « Restent -13h22 ») : le signaler une fois au début en « attention » pour confirmation avec le gestionnaire de navigabilité, sans bloquer la saisie.

Messages spéciaux : « __START__ » = début de session : présente en une ou deux phrases l'OT (avion, nombre de travaux), signale les butées dépassées, puis pose la première question. Les messages entre crochets [Form 1 validé ...] viennent de l'application, pas du mécanicien.

Quand tous les champs utiles sont renseignés (y compris la justification des cases laissées vides), mets done=true et invite le mécanicien à passer à la vérification et à la signature.`;

const TOOL_OT = {
  name: "mettre_a_jour_ot",
  description: "Renseigne les champs de l'OT et formule la prochaine question au mécanicien.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "string", description: "Message affiché au mécanicien (question suivante ou confirmation)." },
      set: {
        type: "array",
        description: "Champs à renseigner ou corriger, uniquement avec des identifiants fournis.",
        items: {
          type: "object",
          properties: { id: { type: "string" }, value: { type: "string" } },
          required: ["id", "value"],
        },
      },
      flags: {
        type: "array",
        description: "Alertes techniques ou réglementaires nouvelles (ne pas répéter les précédentes).",
        items: {
          type: "object",
          properties: {
            level: { type: "string", enum: ["info", "attention", "bloquant"] },
            text: { type: "string" },
          },
          required: ["level", "text"],
        },
      },
      done: { type: "boolean" },
    },
    required: ["reply", "set", "flags", "done"],
  },
};

const SYSTEM_FORM1 = `Tu lis la photo d'un certificat libératoire de pièce aéronautique (EASA Form 1, ancien JAA Form One, FAA 8130-3). Tu recopies exactement ce qui est lisible, case par case. Si une case est illisible, coupée, floue ou absente, laisse le champ vide et décris le problème dans problemes. N'interprète pas, ne complète pas, ne devine pas un caractère douteux d'un P/N ou d'un S/N : dans ce cas laisse vide et signale-le.`;

const TOOL_FORM1 = {
  name: "lecture_form1",
  description: "Données extraites du certificat photographié.",
  input_schema: {
    type: "object",
    properties: {
      type_document: { type: "string", enum: ["EASA Form 1", "JAA Form One", "FAA 8130-3", "Autre", "Illisible"] },
      numero_suivi: { type: "string", description: "Case 3 : form tracking number" },
      organisme: { type: "string", description: "Case 4 : nom de l'organisme émetteur" },
      agrement: { type: "string", description: "Référence d'agrément de l'organisme (case 4 ou 14)" },
      ordre_travail: { type: "string", description: "Case 5" },
      designation: { type: "string", description: "Case 7" },
      part_number: { type: "string", description: "Case 8" },
      quantite: { type: "string", description: "Case 9" },
      serial_number: { type: "string", description: "Case 10" },
      statut: { type: "string", description: "Case 11 : NEW, OVERHAULED, REPAIRED, INSPECTED/TESTED…" },
      remarques: { type: "string", description: "Case 12" },
      date: { type: "string", description: "Date de signature (case 14e/13e), format JJ/MM/AAAA si possible" },
      signe: { type: "boolean", description: "Une signature est-elle visible ?" },
      problemes: { type: "array", items: { type: "string" } },
    },
    required: ["type_document", "part_number", "serial_number", "signe", "problemes"],
  },
};

export function registerAgentOt(app, { maintAuth, Resend, getPg }) {
  // Tour de conversation
  app.post("/api/agent-ot/turn", maintAuth, async (req, res) => {
    try {
      const { ot, fields, history, message } = req.body || {};
      if (!Array.isArray(fields) || !message) return res.status(400).json({ error: "Requête incomplète" });
      const allowed = new Set(fields.map(f => f.id));
      const etat = fields
        .map(f => `${f.id} | ${f.section} | ${f.label}${f.value ? ` | = ${f.value}` : ""}`)
        .join("\n");
      const contexte = `OT ${ot?.numero || "?"} — ${ot?.immat || "?"} — ${ot?.avion || ""}\n` +
        `Heures saisies sur l'OT : ${ot?.heures || ""}\nMécanicien : ${ot?.mecano || ""}\n` +
        `Texte des travaux programmés :\n${ot?.travaux || ""}\n\nChamps (id | rubrique | libellé | valeur actuelle) :\n${etat}`;
      const msgs = [];
      for (const m of (history || []).slice(-24)) {
        if (!m?.content || (m.role !== "user" && m.role !== "assistant")) continue;
        msgs.push({ role: m.role, content: String(m.content).slice(0, 4000) });
      }
      // L'API exige d'alterner et de commencer par user
      while (msgs.length && msgs[0].role !== "user") msgs.shift();
      msgs.push({ role: "user", content: `${contexte}\n\n— Message du mécanicien —\n${String(message).slice(0, 4000)}` });
      const merged = [];
      for (const m of msgs) {
        if (merged.length && merged[merged.length - 1].role === m.role) merged[merged.length - 1].content += "\n\n" + m.content;
        else merged.push({ ...m });
      }
      const raw = await callClaude({ system: SYSTEM_OT, messages: merged, tool: TOOL_OT });
      const out = raw._texte
        ? { reply: raw._texte, set: [], flags: [], done: false }
        : { reply: raw.reply || "", set: Array.isArray(raw.set) ? raw.set : [], flags: Array.isArray(raw.flags) ? raw.flags : [], done: !!raw.done };
      out.set = out.set.filter(s => s && allowed.has(s.id) && typeof s.value === "string");
      res.json(out);
    } catch (e) {
      console.error("agent-ot/turn:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Lecture d'un Form 1 en photo
  app.post("/api/agent-ot/form1", maintAuth, async (req, res) => {
    try {
      const { image } = req.body || {};
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(image || "");
      if (!m) return res.status(400).json({ error: "Photo manquante ou format non pris en charge" });
      const out = await callClaude({
        system: SYSTEM_FORM1,
        tool: TOOL_FORM1,
        maxTokens: 1200,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
            { type: "text", text: "Extrais les données de ce certificat." },
          ],
        }],
      });
      if (out._texte) return res.status(502).json({ error: "Lecture non structurée, saisissez les cases à la main" });
      out.problemes = Array.isArray(out.problemes) ? out.problemes : [];
      res.json(out);
    } catch (e) {
      console.error("agent-ot/form1:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Envoi de l'OT signé au bureau + trace en base
  app.post("/api/agent-ot/send", maintAuth, async (req, res) => {
    try {
      const { pdf, filename, immat, numero, mecano, valeurs, alertes } = req.body || {};
      if (!pdf || !/^[A-Za-z0-9+/=]+$/.test(pdf.slice(0, 200))) return res.status(400).json({ error: "PDF manquant" });
      const safeName = String(filename || "OT_signe.pdf").replace(/[^A-Za-z0-9._-]/g, "_");
      const pool = getPg();
      if (pool) {
        try {
          await pool.query(`CREATE TABLE IF NOT EXISTS ot_agent (
            id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW(),
            immat TEXT, numero TEXT, mecano TEXT, valeurs JSONB, alertes JSONB)`);
          await pool.query(
            "INSERT INTO ot_agent (immat, numero, mecano, valeurs, alertes) VALUES ($1,$2,$3,$4,$5)",
            [immat || null, numero || null, mecano || null, JSON.stringify(valeurs || {}), JSON.stringify(alertes || [])]
          );
        } catch (e) { console.error("ot_agent insert:", e.message); }
      }
      const key = process.env.RESEND_API_KEY;
      if (!key) return res.status(500).json({ error: "RESEND_API_KEY manquante : téléchargez le PDF et envoyez-le manuellement" });
      const dest = process.env.OT_DEST_EMAIL || process.env.DEST_EMAIL || "aeroclubarc@gmail.com";
      const lignesAlertes = (alertes || []).map(a => `- [${a.level}] ${a.text}`).join("\n") || "Aucune";
      const resend = new Resend(key);
      const { error } = await resend.emails.send({
        from: "Atelier ARC <onboarding@resend.dev>",
        to: [dest],
        subject: `OT ${numero || ""} ${immat || ""} signé par ${mecano || "le mécanicien"}`,
        text: `OT ${numero || ""} du ${immat || ""}, rempli avec l'agent atelier et signé par ${mecano || ""}.\n\nAlertes relevées pendant la saisie :\n${lignesAlertes}\n\nLe PDF signé (avec les Form 1 en annexe) est joint.`,
        attachments: [{ filename: safeName, content: Buffer.from(pdf, "base64") }],
      });
      if (error) return res.status(500).json({ error: error.message || "Envoi refusé par Resend" });
      res.json({ ok: true, dest });
    } catch (e) {
      console.error("agent-ot/send:", e.message);
      res.status(500).json({ error: e.message });
    }
  });
}

