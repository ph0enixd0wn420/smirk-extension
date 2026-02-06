/**
 * Defensive response parsing utilities.
 *
 * These helpers safely extract fields from unknown API responses,
 * preventing crashes when the backend returns unexpected shapes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ============================================================================
// Safe field access (returns undefined on missing/wrong type)
// ============================================================================

export function str(obj: unknown, key: string): string | undefined {
  if (!isObj(obj)) return undefined;
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

export function num(obj: unknown, key: string): number | undefined {
  if (!isObj(obj)) return undefined;
  const v = obj[key];
  return typeof v === 'number' ? v : undefined;
}

export function bool(obj: unknown, key: string): boolean | undefined {
  if (!isObj(obj)) return undefined;
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function arr(obj: unknown, key: string): unknown[] | undefined {
  if (!isObj(obj)) return undefined;
  const v = obj[key];
  return Array.isArray(v) ? v : undefined;
}

export function obj(obj: unknown, key: string): Obj | undefined {
  if (!isObj(obj)) return undefined;
  const v = obj[key];
  return isObj(v) ? v : undefined;
}

// ============================================================================
// Field access with fallback (never returns undefined)
// ============================================================================

export function strOr(o: unknown, key: string, fallback: string): string {
  return str(o, key) ?? fallback;
}

export function numOr(o: unknown, key: string, fallback: number): number {
  return num(o, key) ?? fallback;
}

export function boolOr(o: unknown, key: string, fallback: boolean): boolean {
  return bool(o, key) ?? fallback;
}

// ============================================================================
// snake_case → camelCase transformation
// ============================================================================

function snakeKeyToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Recursively transforms all snake_case keys in an object to camelCase.
 * Arrays are traversed, primitives are returned as-is.
 */
export function snakeToCamel<T = unknown>(data: unknown): T {
  if (Array.isArray(data)) {
    return data.map(snakeToCamel) as T;
  }
  if (isObj(data)) {
    const result: Obj = {};
    for (const [key, value] of Object.entries(data)) {
      result[snakeKeyToCamel(key)] = snakeToCamel(value);
    }
    return result as T;
  }
  return data as T;
}
