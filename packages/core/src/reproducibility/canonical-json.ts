import { ValidationError } from '../errors/index.js';

/**
 * Serialises a value to a canonical JSON string: object keys sorted, `undefined` properties
 * dropped, `bigint` written as a decimal string.
 *
 * `JSON.stringify` is not usable for hashing because key order follows insertion order, so two
 * structurally identical snapshots built by different code paths would hash differently.
 *
 * Non-integer `number` values are rejected outright. A float in a snapshot would make the
 * fingerprint depend on binary floating-point formatting, which is exactly the class of bug the
 * money model exists to prevent. Integers (settlement seconds, version numbers) are allowed.
 */
export function canonicalJson(value: unknown): string {
  return stringify(value, []);
}

function stringify(value: unknown, path: readonly string[]): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new ValidationError('Cannot canonicalise a non-finite number.', {
          path: path.join('.'),
        });
      }
      if (!Number.isInteger(value)) {
        throw new ValidationError(
          'Cannot canonicalise a fractional number. Use a decimal string so the fingerprint is ' +
            'independent of floating-point representation.',
          { path: path.join('.'), value: String(value) },
        );
      }
      return value.toString();
    }
    case 'undefined':
      throw new ValidationError('Cannot canonicalise `undefined`.', { path: path.join('.') });
    case 'object':
      break;
    default:
      throw new ValidationError(`Cannot canonicalise a value of type ${typeof value}.`, {
        path: path.join('.'),
      });
  }

  if (Array.isArray(value)) {
    const items = value.map((item, index) => stringify(item, [...path, String(index)]));
    return `[${items.join(',')}]`;
  }

  const source = unwrapToJson(value, path);
  if (source !== value) {
    return stringify(source, path);
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .flatMap((key) => {
      const entry = record[key];
      if (entry === undefined) {
        return [];
      }
      return [`${JSON.stringify(key)}:${stringify(entry, [...path, key])}`];
    });

  return `{${entries.join(',')}}`;
}

/** Honours `toJSON()` so domain value objects canonicalise through their transport form. */
function unwrapToJson(value: object, path: readonly string[]): unknown {
  const candidate = value as { toJSON?: unknown };
  if (typeof candidate.toJSON !== 'function') {
    return value;
  }
  const result: unknown = (candidate.toJSON as () => unknown).call(value);
  if (result === value) {
    throw new ValidationError('`toJSON()` returned the receiver, which cannot be canonicalised.', {
      path: path.join('.'),
    });
  }
  return result;
}
