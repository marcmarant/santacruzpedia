// Contraseñas y tokens. Sin dependencias: usa scrypt y números aleatorios de node:crypto.
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, sal: Buffer, len: number) => Promise<Buffer>;
const LARGO = 64;
export const MIN_CONTRASENA = 8;

/** 'scrypt$<sal>$<hash>' en base64 */
export async function cifrarContrasena(contrasena: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scryptAsync(contrasena.normalize('NFC'), sal, LARGO);
  return `scrypt$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function comprobarContrasena(contrasena: string, guardado: string): Promise<boolean> {
  const [alg, sal, hash] = guardado.split('$');
  if (alg !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const calculado = await scryptAsync(contrasena.normalize('NFC'), Buffer.from(sal, 'base64'), esperado.length);
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

/** hash que se compara cuando el usuario no existe, para que tarde lo mismo y no revele si existe */
export const HASH_FALSO = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(LARGO).toString('base64');

/** token aleatorio para cookies e invitaciones; en la base de datos solo se guarda su hash */
export const nuevoToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function validarContrasena(c: string, repetida: string): string | null {
  if (c.length < MIN_CONTRASENA) return `La contraseña debe tener al menos ${MIN_CONTRASENA} caracteres.`;
  if (c.length > 200) return 'La contraseña es demasiado larga.';
  if (c !== repetida) return 'Las dos contraseñas no coinciden.';
  return null;
}
