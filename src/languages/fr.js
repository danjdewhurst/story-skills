// French: build labels and narration pace. No word lists yet. A colon takes
// a no-break space before it ( ), as French typography sets it.

export default {
  code: "fr",
  name: "French",
  narrationRate: 135,
  labels: {
    chapter: "Chapitre {n}",
    "chapter-heading": "{chapter} : {title}",
    contents: "Table des matières",
    and: "{a} et {b}",
    copyright: "Droits d’auteur",
    "all-rights-reserved": "Tous droits réservés.",
    "published-by": "Publié par {publisher}",
    "scene-break": "Changement de scène",
    "cover-alt": "Couverture de {title}",
    "start-of-content": "Début du contenu",
    "accessibility-summary": "Livre entièrement textuel, avec une table des matières navigable, un titre pour chaque chapitre et un ordre de lecture logique unique.",
    "accessibility-summary-cover": "Livre textuel avec une image de couverture décrite, une table des matières navigable, un titre pour chaque chapitre et un ordre de lecture logique unique.",
    "review-title": "{title} : exemplaire de relecture",
    "review-intro": "Exemplaire de relecture.",
    "review-intro-build": "Exemplaire de relecture, version {build}.",
    "review-labels": "Chaque paragraphe porte une étiquette comme {label} (chapitre 3, paragraphe 12).",
    "review-quote": "Citez l’étiquette dans chaque note, avec les premiers mots du paragraphe, pour que l’auteur retrouve l’endroit exact même après une modification du texte.",
    "review-quote-build": "Citez l’étiquette et la version dans chaque note, avec les premiers mots du paragraphe, pour que l’auteur retrouve l’endroit exact même après une modification du texte.",
    "review-note-link": "Le lien Note à côté de chaque étiquette ouvre une note où ces informations sont déjà remplies.",
    note: "Note",
    "note-title": "Écrire une note sur {label}",
    "anchor-title": "Lien vers {label}",
    by: "par",
    "approximate-words": "Environ {words} mots",
    "approximate-characters": "Environ {characters} caractères",
    "narration-opening": "{title}. Écrit par {authors}. Lu par {narrator}.",
    "narration-opening-anonymous": "{title}. Lu par {narrator}.",
    "narration-closing": "Fin. Vous venez d’écouter {title}, écrit par {authors}, lu par {narrator}.",
    "narration-closing-anonymous": "Fin. Vous venez d’écouter {title}, lu par {narrator}.",
    "screenplay-credit": "Écrit par",
    "screenplay-source": "D’après l’œuvre de {authors}",
    "screenplay-source-anonymous": "D’après l’œuvre originale"
  }
};
