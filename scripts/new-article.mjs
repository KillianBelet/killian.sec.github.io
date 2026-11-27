// Crée un brouillon d'article depuis le terminal (équivalent du bouton « Écrire un article » du Studio).
// Usage : npm run new -- "Titre de l'article" [catégorie]
import fs from 'node:fs';
import { slugify, isoDate, articlePath, serializeArticle, writeFileAtomic } from '../lib/core.mjs';

const [title, category = 'Sécurité'] = process.argv.slice(2);
if (!title) {
  console.error('Usage : npm run new -- "Titre de l\'article" [catégorie]');
  process.exit(1);
}
const slug = slugify(title).slice(0, 80).replace(/-+$/, '');
if (!slug) { console.error('Le titre doit contenir au moins une lettre ou un chiffre.'); process.exit(1); }
const file = articlePath(slug);
if (fs.existsSync(file)) { console.error(`Un article existe déjà : content/articles/${slug}.md`); process.exit(1); }

writeFileAtomic(file, serializeArticle({
  title, date: isoDate(new Date()), category, tags: [], summary: '', draft: true,
  body: 'Posez le problème en deux ou trois phrases.\n\n## Premier point\n\nVotre contenu.\n',
}));
console.log(`✔ Brouillon créé : content/articles/${slug}.md (draft: true, à passer à false pour le publier)`);
