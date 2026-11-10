// Crea una cuenta de moderador (o convierte en moderador una que ya existe y le pone contraseña nueva).
//
//   npm run crear-moderador                 -> pregunta el colegial y la contraseña
//   npm run crear-moderador -- 2021plato    -> para ese colegial
//
// La contraseña se escribe sin que se vea en pantalla y se guarda cifrada (scrypt).
import pg from 'pg';
import readline from 'node:readline';
import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

const db = new pg.Client({
  host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), database: process.env.PGDATABASE,
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const preguntar = q => new Promise(r => rl.question(q, r));
/** pregunta sin mostrar lo que se escribe */
function preguntarOculto(q) {
  return new Promise(r => {
    const escribir = rl._writeToOutput;
    rl._writeToOutput = s => { if (s.includes(q)) escribir.call(rl, s); };
    rl.question(q, v => { rl._writeToOutput = escribir; process.stdout.write('\n'); r(v); });
  });
}
const cifrar = async c => {
  const sal = randomBytes(16);
  const hash = await promisify(scrypt)(c.normalize('NFC'), sal, 64);
  return `scrypt$${sal.toString('base64')}$${hash.toString('base64')}`;
};

try {
  await db.connect();
  const id = (process.argv[2] || await preguntar('Id del colegial (p. ej. 2021plato): ')).trim();
  const [col] = (await db.query('select id, mote, nombre from colegial where id = $1', [id])).rows;
  if (!col) throw new Error(`No existe ningún colegial con id «${id}».`);
  console.log(`Colegial: ${col.mote}${col.nombre ? ` (${col.nombre})` : ''}`);

  const c1 = await preguntarOculto('Contraseña (mínimo 8 caracteres): ');
  const c2 = await preguntarOculto('Repite la contraseña: ');
  if (c1.length < 8) throw new Error('La contraseña es demasiado corta.');
  if (c1 !== c2) throw new Error('Las contraseñas no coinciden.');

  const hash = await cifrar(c1);
  const { rows: [u] } = await db.query(
    `insert into wiki.usuario (usuario, colegial_id, nombre, hash_password, rol) values ($1, $1, $2, $3, 'moderador')
     on conflict (colegial_id) do update set hash_password = excluded.hash_password, rol = 'moderador', activo = true
     returning usuario, (xmax <> 0) as existia`, [col.id, col.mote, hash]);
  console.log(u.existia
    ? `Listo: la cuenta «${u.usuario}» ahora es moderadora y tiene contraseña nueva.`
    : `Listo: creada la cuenta de moderador «${u.usuario}». Ya puedes iniciar sesión en la wiki.`);
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 1;
} finally {
  rl.close();
  await db.end().catch(() => {});
}
