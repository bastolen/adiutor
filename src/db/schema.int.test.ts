/**
 * @file Tests that the database follows the project's rules: UUIDv7 IDs, no
 * auto-increment columns, and an index for every foreign key.
 */
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createUser, inSequence, setupTestContext } from '../../tests/integration/helpers';

const { db } = setupTestContext();

describe('database rules', () => {
  it('has no auto-increment (serial or identity) columns in app tables', async () => {
    const { rows } = await db.execute(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and (column_default like 'nextval(%' or is_identity = 'YES')
    `);
    expect(rows).toEqual([]);
  });

  it('uses uuid primary keys everywhere', async () => {
    const { rows } = await db.execute<{ table_name: string; data_type: string }>(sql`
      select c.table_name, c.data_type
      from information_schema.table_constraints t
      join information_schema.key_column_usage k
        on k.constraint_name = t.constraint_name and k.table_schema = t.table_schema
      join information_schema.columns c
        on c.table_schema = k.table_schema and c.table_name = k.table_name and c.column_name = k.column_name
      where t.table_schema = 'public' and t.constraint_type = 'PRIMARY KEY'
    `);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => expect(row.data_type, row.table_name).toBe('uuid'));
  });

  it('generates time-ordered UUIDv7 IDs', async () => {
    // Created one after another on purpose: IDs must follow creation order.
    const ids = await inSequence([1, 2, 3], (n) => createUser(db, `user${n}@adiutor.test`));
    ids.forEach((id) => expect(id[14]).toBe('7'));
    expect([...ids].sort()).toEqual(ids);
  });

  it('has an index starting with every foreign key column', async () => {
    const { rows } = await db.execute<{ table_name: string; column_name: string }>(sql`
      select rel.relname as table_name, att.attname as column_name
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
      where con.contype = 'f' and ns.nspname = 'public'
        and not exists (
          select 1 from pg_index idx
          where idx.indrelid = con.conrelid and idx.indkey[0] = con.conkey[1]
        )
    `);
    expect(rows).toEqual([]);
  });
});
