# ARC Inscription 2026

Formulaire d'adhésion en ligne pour l'Aéroclub A.R.C. de Chavenay (LFPX).

## Déploiement Railway

1. Crée un repo GitHub et pousse ce dossier
2. Va sur [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Sélectionne le repo → Railway détecte Node.js automatiquement
4. Le formulaire sera accessible sur l'URL Railway générée (ex: arc-inscription.up.railway.app)

## Intégration Webflow

Injecte l'iframe suivant dans la page Tarifs via un élément HTML Embed :

```html
<iframe 
  src="https://TON-URL.up.railway.app" 
  width="100%" 
  height="900px" 
  frameborder="0"
  style="border:none; border-radius:8px;"
  title="Formulaire d'adhésion ARC 2026">
</iframe>
```

## Contenu

- Étape 1 : Identité + contacts d'urgence
- Étape 2 : Statut pilote, licences, expérience, FFA
- Étape 3 : Cotisations ARC avec calcul automatique
- Étape 4 : Double validation + paiement PayPal
