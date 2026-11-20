/**
 * @file Tests that the database follows the project's rules: UUIDv7 IDs, no
 * auto-increment columns, an index for every foreign key, and a CHECK
 * constraint on every text column that only allows certain values.
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

  /** The text columns that only allow certain values, each with its `_valid` check (`oneOf`). */
  const VALUE_CHECKS = [
    'app_error_route_type_valid',
    'app_error_source_valid',
    'invitation_locale_valid',
    'job_run_status_valid',
    'job_run_trigger_valid',
    'job_state_last_status_valid',
    'queued_job_status_valid',
    'request_created_by_side_valid',
    'request_description_format_valid',
    'request_entry_author_side_valid',
    'request_entry_body_format_valid',
    'request_entry_kind_valid',
    'request_priority_valid',
    'request_status_valid',
    'request_type_valid',
    'staff_settings_default_locale_valid',
  ];

  it('limits every text column with a fixed set of values to those values', async () => {
    const { rows } = await db.execute<{ name: string }>(sql`
      select con.conname as name
      from pg_constraint con
      join pg_namespace ns on ns.oid = con.connamespace
      where con.contype = 'c' and ns.nspname = 'public' and con.conname like '%\_valid'
      order by con.conname
    `);
    expect(rows.map(({ name }) => name)).toEqual(VALUE_CHECKS);
  });

  it('refuses a value outside the list, and leaves an optional column optional', async () => {
    /**
     * Stores an error with the given source and route type.
     *
     * @param source - Where it happened.
     * @param routeType - What the server was doing, if anything.
     * @returns The database's error code, or `stored`.
     */
    const store = async (source: string, routeType: string | null) => {
      try {
        await db.execute(
          sql`insert into app_error (reference, source, route_type) values ('TEST-0001', ${source}, ${routeType})`,
        );
        return 'stored';
      } catch (error) {
        return (error as { cause?: { code?: string } }).cause?.code ?? String(error);
      }
    };

    expect(await store('nowhere', null)).toBe('23514');
    expect(await store('server', 'somewhere')).toBe('23514');
    expect(await store('job', null)).toBe('stored');
  });
});
