import { Transform, type TransformFnParams } from 'class-transformer';

/**
 * Correctly parses a `?flag=true` / `?flag=false` query string into a real
 * boolean. `@Type(() => Boolean)` looks like the obvious choice here but is
 * wrong for query strings: it does a raw `Boolean(value)` cast, and
 * `Boolean('false')` is `true` (any non-empty string is truthy in JS).
 */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ value }: TransformFnParams): unknown => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return value;
  });
}
