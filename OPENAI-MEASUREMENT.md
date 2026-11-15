# Mesure des demandes de contact ARC

Cette modification prépare le suivi du formulaire de contact avec le Pixel existant du compte ARC.
Elle doit être examinée et publiée avant tout test réel. Aucun envoi réel de données de visiteur n'a été effectué pendant les tests locaux.

## Comportement

- Le SDK OpenAI ne se charge qu'après le choix « Accepter » du visiteur.
- « Refuser » et « Accepter » sont présentés au même niveau. Le choix peut être changé depuis le bouton « Mesure publicitaire ».
- Le choix est conservé au maximum 180 jours. Les événements antérieurs au consentement ne sont pas rejoués.
- Le script appelle `lead_created` seulement après `res.ok && data.ok`, hors réponse de simulation signalée par `warning`.
- Aucun nom, message ou adresse e-mail n'est ajouté au payload de l'événement. Le SDK OpenAI peut réaliser son rapprochement avancé automatique après consentement : le texte proposé au visiteur le signale.
- Les appels de mesure utilisent `opt_out: true`. Un incident du SDK ne bloque pas le formulaire.
- Les balises Google et le signal GTM `contact_submit` existants sont conservés. Le nouveau choix de consentement concerne uniquement cette intégration OpenAI.

## Configuration à terminer dans Ads Manager

1. Ouvrir Conversions et réutiliser la source Web « My first pixel » du compte ARC.
2. Configurer « Demande de renseignements ARC » avec l'événement standard `lead_created` et cette source.
3. Après publication, ouvrir le test du Pixel et envoyer une demande explicitement identifiée comme test, avec accord de mesure.
4. Vérifier la réception de `lead_created`. Une balise déclenchée ou un appel en file d'attente ne prouve pas sa réception.
5. Associer l'événement à la campagne pour le reporting selon les options disponibles. Ne pas modifier son budget ni ses enchères sans validation.

## Initiations : étape distincte

Les liens du site actuel renvoient vers Enviedepiloter/FFA. Le dépôt ne fournit pas de retour fiable de réservation confirmée. Le clic vers la FFA n'est donc pas envoyé comme `appointment_scheduled` ni comme `order_created`.

Le propriétaire confirme recevoir un e-mail de confirmation. Un message FFA récent a été vérifié : il confirme une souscription de passeport et contient uniquement les noms du souscripteur et du bénéficiaire, la durée du passeport et son montant. Il ne fournit ni e-mail de l'acheteur, ni référence de commande exploitable, ni référence de clic publicitaire, ni date de vol réservée. Aucun contenu nominatif n'est inclus dans ce dépôt.

Pour le suivi d'achat, il faut un retour fiable de la FFA (confirmation sur le site ou intégration autorisée avec identifiant unique et signaux d'attribution permis). Pour `appointment_scheduled`, il faut la confirmation effective d'un créneau. Les noms seuls ne doivent pas être utilisés pour inventer un rapprochement publicitaire. Le suivi des initiations reste donc explicitement non configuré.

## Validation locale

`node tests/arc-measurement.test.cjs`

Les tests utilisent uniquement des données synthétiques et un SDK simulé. Ils couvrent accord/refus/retrait, stockage bloqué ou expiré, déduplication, succès et erreurs du vrai gestionnaire de formulaire, mode de simulation sans e-mail et panne du SDK. Ils ne vérifient pas la réception dans OpenAI ni le contenu du conteneur GTM.

Références :
- https://developers.openai.com/ads/measurement-pixel
- https://developers.openai.com/ads/supported-events
- https://help.openai.com/en/articles/20001409-conversion-measurement
