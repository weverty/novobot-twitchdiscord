import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const file = path.join(__dirname, 'vinculos.json');
const adapter = new JSONFile(file);

// 💡 IMPORTANTE: passa os dados padrão aqui
const db = new Low(adapter, {
  usuarios: [],
  twitch_auth: {}
});

export default async function createDB() {
  await db.read();

  // Garantia extra (não deveria cair aqui, mas vai que né)
  db.data ||= {
    usuarios: [],
    twitch_auth: {}
  };

  await db.write();
  return db;
}
