# Sport TV IA 📺⚽🏀

Une application Android qui fonctionne **comme une vraie chaîne de télévision sportive** — sauf que
tout est simulé par intelligence artificielle : les joueurs, les matchs, les compétitions, les
commentateurs, le public et même les pubs.

## Les chaînes

| N° | Chaîne | Contenu |
|----|--------|---------|
| 1 | **FOOT+** | Football 24h/24 : Ligue Élite (16 clubs), Coupe Nationale, Coupe des Nations (16 sélections), Supercoupe |
| 2 | **BASKET+** | Un match de Ligue Pro de basket chaque heure |
| 3 | **SPORT 24 INFO** | Journal des sports en continu : scores en direct, résultats, classements, buteurs, programme |

## Ce qui est simulé

- **Matchs joués par IA, en temps réel** : 22 joueurs autonomes (placement tactique, pressing,
  marquage, appels en profondeur, passes, dribbles, centres, tirs, têtes, tacles, fautes,
  hors-jeu, cartons, penaltys, corners, coups francs avec mur, remplacements, fatigue),
  arbitre et arbitres assistants. Un match dure **90 minutes** + temps additionnel, avec une
  **mi-temps de 15 minutes** (pubs, studio, résumé des buts), et des **tirs au but** en coupe.
- **Plus de 700 joueurs inventés**, chacun avec sa nationalité, son âge, son poste, son pied
  fort, son physique et ses notes (vitesse, tir, passe, dribble, défense, physique, gardien).
  Les équipes ont des niveaux, des schémas tactiques (4-4-2, 4-3-3, 4-2-3-1, 3-5-2) et des
  styles de jeu différents. Certains joueurs sont des stars.
- **Grille TV calée sur l'heure réelle** : comme une vraie chaîne, le programme continue même
  quand l'appli est fermée. En allumant la télé, on arrive en plein match, à la bonne minute.
  Tout est déterministe : le match regardé en direct est exactement celui qui compte au classement.
- **Stade 3D** : pelouse tondue, filets, panneaux LED animés, tribunes en cuvette avec des
  dizaines de milliers de supporters animés (ultras, secteur visiteur), écran géant,
  éclairage de jour / de nuit, ombres.
- **Réalisation TV** : plan large, gros plans, célébrations, **ralentis** sous plusieurs angles,
  bandeau de score, temps additionnel, compositions, statistiques, classements, bandeau défilant.
- **Son** : rumeur du stade, clameurs, « ohhh », sifflets, chants et tambours des supporters,
  sifflet de l'arbitre, frappes de balle.
- **Deux commentateurs** (un commentateur + un consultant) avec deux voix différentes, qui
  commentent chaque action, se répondent et discutent des joueurs, des stats et de la tactique
  pendant les temps morts. Les voix utilisent le moteur de synthèse vocale du téléphone
  (installez/activez les voix françaises « Google Text-to-Speech » pour la meilleure qualité).
- **Publicités** (marques fictives) avec jingles et voix off, avant-match, mi-temps, après-match.

## Télécommande

- Glisser vers le haut / le bas : changer de chaîne
- Toucher l'écran : télécommande (CH+, CH−, Guide des programmes, Réglages, Son)
- Réglages : durée des matchs (90, 45 ou 30 min), qualité graphique, commentateurs, volume

## Installer l'APK

À chaque modification, GitHub Actions compile l'application et publie `SportTV-IA.apk` dans
l'onglet **Releases** du dépôt. Téléchargez-le depuis le téléphone et ouvrez-le pour l'installer.

## Développement

```bash
npm install
npm run dev          # version navigateur (http://localhost:5173)
npm run build        # build web
npx cap sync android # copie dans le projet Android
cd android && ./gradlew assembleDebug
```

Paramètres d'URL utiles pour tester dans le navigateur : `?autostart&ch=1` (chaîne),
`&offset=30` (avancer l'horloge de 30 min), `&speed=3` (matchs de 30 min), `&q=low`.
