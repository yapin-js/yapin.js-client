/**
 * Reading React's own data off DOM elements. Yapin’ doesn't put user ids in its markup, but React keeps
 * every component's props on the element it rendered (`__reactFiber$…`), so walking up from an element
 * finds the props of the components around it. Read-only: nothing here changes React state.
 */

function internalKey(node, prefix) {
  if (!node || typeof node !== 'object') return null;
  for (const key of Object.keys(node)) if (key.startsWith(prefix)) return key;
  return null;
}

/** The React fiber for a DOM element, or null. */
export function fiberOf(node) {
  const key = internalKey(node, '__reactFiber$') ?? internalKey(node, '__reactInternalInstance$');
  return key ? node[key] : null;
}

/** The props React rendered a DOM element with, or null. */
export function propsOf(node) {
  const key = internalKey(node, '__reactProps$');
  return key ? node[key] : null;
}

/** Reads 'a.b.c' from an object without throwing. */
export function readPath(object, path) {
  let value = object;
  for (const part of String(path).split('.')) {
    if (value === null || value === undefined) return undefined;
    try {
      value = value[part];
    } catch {
      return undefined;
    }
  }
  return value;
}

/**
 * Walks from `node` up through its React parents and returns the first `memoizedProps` for which
 * `predicate(props, fiber)` is true. `maxDepth` limits how far up it goes.
 */
export function findProps(node, predicate, { maxDepth = 40 } = {}) {
  let fiber = fiberOf(node);
  for (let depth = 0; fiber && depth < maxDepth; depth++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (props && typeof props === 'object') {
      try {
        if (predicate(props, fiber)) return props;
      } catch {
        // a getter on someone else's props threw; keep walking
      }
    }
  }
  return null;
}

/** The first value found under any of `paths` ('userId', 'user.id', …) walking up from `node`. */
export function findValue(node, paths, { maxDepth = 40, test = (v) => v !== undefined && v !== null && v !== '' } = {}) {
  let found;
  findProps(
    node,
    (props) => {
      for (const path of paths) {
        const value = readPath(props, path);
        if (test(value)) {
          found = value;
          return true;
        }
      }
      return false;
    },
    { maxDepth },
  );
  return found;
}

/** The user id a piece of the page belongs to, using the host's list of prop names. */
export function findUserId(node, paths, options) {
  const value = findValue(node, paths, { ...options, test: (v) => (typeof v === 'string' && v.length > 0) || typeof v === 'number' });
  return value === undefined ? null : String(value);
}
