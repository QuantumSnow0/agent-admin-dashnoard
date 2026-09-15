/**
 * Typed SQL argument encoding for node-postgres.
 *
 * Critical: a raw JavaScript array bound to a JSONB parameter is serialized as a
 * PostgreSQL array by node-pg and yields 22P02 ("invalid input syntax for type json").
 * JSONB values must be JSON.stringify'd and cast with ::jsonb.
 *
 * Do NOT globally stringify arrays — PostgreSQL text[]/uuid[] parameters must stay
 * as JavaScript arrays for correct array encoding.
 */

export type SqlArgKind = "jsonb" | "uuid" | "text" | "int" | "bool" | "default";

export type SqlArg = {
  readonly __wamSqlArg: true;
  readonly kind: SqlArgKind;
  readonly value: unknown;
};

export function sqlJsonb(value: unknown): SqlArg {
  return { __wamSqlArg: true, kind: "jsonb", value };
}

export function sqlUuid(value: string | null): SqlArg {
  return { __wamSqlArg: true, kind: "uuid", value };
}

export function sqlText(value: string | null): SqlArg {
  return { __wamSqlArg: true, kind: "text", value };
}

export function sqlInt(value: number | null): SqlArg {
  return { __wamSqlArg: true, kind: "int", value };
}

export function isSqlArg(v: unknown): v is SqlArg {
  return Boolean(v && typeof v === "object" && (v as SqlArg).__wamSqlArg === true);
}

/** Encode a JSONB-bound value for node-postgres (string + ::jsonb cast). */
export function encodeJsonbParam(value: unknown): string {
  if (typeof value === "string") {
    // Already serialized JSON text — pass through after validating parse
    JSON.parse(value);
    return value;
  }
  return JSON.stringify(value ?? null);
}

export type BuiltSqlArgs = {
  placeholders: string;
  values: unknown[];
};

/**
 * Build `$n` / `$n::jsonb` placeholders and wire values for pool.query.
 * Unmarked args keep their native node-pg encoding (including JS arrays → PG arrays).
 */
export function buildTypedSqlArgs(args: unknown[]): BuiltSqlArgs {
  const values: unknown[] = [];
  const parts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const n = i + 1;
    if (isSqlArg(a)) {
      switch (a.kind) {
        case "jsonb":
          parts.push(`$${n}::jsonb`);
          values.push(encodeJsonbParam(a.value));
          break;
        case "uuid":
          parts.push(`$${n}::uuid`);
          values.push(a.value);
          break;
        case "text":
          parts.push(`$${n}::text`);
          values.push(a.value);
          break;
        case "int":
          parts.push(`$${n}::integer`);
          values.push(a.value);
          break;
        case "bool":
          parts.push(`$${n}::boolean`);
          values.push(a.value);
          break;
        default:
          parts.push(`$${n}`);
          values.push(a.value);
      }
    } else {
      parts.push(`$${n}`);
      values.push(a);
    }
  }
  return { placeholders: parts.join(", "), values };
}
