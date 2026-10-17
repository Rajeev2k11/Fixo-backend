// CLAUDE.md rule 1: a module never imports another module's internals.
// From src/modules/<a>/..., an import into src/modules/<b>/ (b != a) may only name a public file
// directly inside <b>/: *.module, *.service, *.schema (for foreign keys), *.keys or *.guard.
// Its repository, domain/, consumers and controllers stay private.
import path from 'node:path';

const MODULES_DIR = /[\\/]src[\\/]modules[\\/]/;
const PUBLIC_FILE = /^[a-z-]+\.(module|service|schema|keys|guard)\.js$/;

/** For a path inside src/modules: the module name and the path within that module. */
function locate(file) {
  const [, inside] = file.split(MODULES_DIR);
  if (inside === undefined) return undefined;
  const [module, ...rest] = inside.split(/[\\/]/);
  return { module, rest };
}

/** @type {import('eslint').Rule.RuleModule} */
export const moduleBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: "Modules may only import other modules' public files" },
    messages: {
      internal:
        "'{{source}}' is internal to the {{module}} module. Use its service, or react to its events.",
    },
    schema: [],
  },
  create(context) {
    const from = locate(context.filename);
    if (!from) return {};

    const check = (node) => {
      const source = node.source?.value;
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const target = locate(path.resolve(path.dirname(context.filename), source));
      if (!target || target.module === from.module) return;
      const isPublic = target.rest.length === 1 && PUBLIC_FILE.test(target.rest[0] ?? '');
      if (!isPublic) {
        context.report({
          node: node.source,
          messageId: 'internal',
          data: { source, module: target.module },
        });
      }
    };
    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check };
  },
};
