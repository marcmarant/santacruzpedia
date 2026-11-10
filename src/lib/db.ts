// Conexión a PostgreSQL (credenciales en .env)
import pg from 'pg';
import { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD } from 'astro:env/server';

pg.types.setTypeParser(1082, v => v); // las fechas llegan como texto 'YYYY-MM-DD'

export const pool = new pg.Pool({
  host: PGHOST, port: PGPORT, database: PGDATABASE, user: PGUSER, password: PGPASSWORD, max: 4,
});

export async function consulta<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}
