import type { namedTypes } from "ast-types";
import type { NamingConventions, FileModification } from "../types/output.js";
import {
  parseTypeScript,
  printAST,
  findLastImportIndex,
  createNamedImport,
  builders as b,
  recast,
} from "../utils/ast.js";

/**
 * Modify appAuthorization.ts to add a new scope module
 *
 * Adds:
 * 1. Import statement for the scope module
 * 2. .withScopeModule() call in the authService chain
 */
export function modifyAuthorization(
  source: string,
  filePath: string,
  names: NamingConventions
): FileModification {
  const ast = parseTypeScript(source);
  const program = ast.program as namedTypes.Program;

  // 1. Add import after the last workflow scope import
  const importSource = `./workflows/${names.directoryName}/scopes`;
  const newImport = createNamedImport(names.scopeModuleName, importSource);

  if (!hasNamedImport(program, names.scopeModuleName, importSource)) {
    const lastImportIndex = findLastImportIndex(program.body);
    program.body.splice(lastImportIndex + 1, 0, newImport);
  }

  // 2. Find the authService declaration and add .withScopeModule() before .build()
  recast.visit(ast, {
    visitVariableDeclarator(path) {
      const id = path.node.id;
      if (id.type === "Identifier" && id.name === "authService") {
        // The init should be a call chain ending with .build()
        const init = path.node.init;
        if (init && init.type === "CallExpression") {
          // Find the .build() call and insert .withScopeModule() before it
          if (
            !chainHasWithScopeModule(
              init as namedTypes.CallExpression,
              names.scopeModuleName
            )
          ) {
            insertWithScopeModule(
              init as namedTypes.CallExpression,
              names.scopeModuleName
            );
          }
        }
        return false;
      }
      this.traverse(path);
      return undefined;
    },
  });

  const modified = printAST(ast);

  return {
    filePath,
    content: modified,
    description: `Added ${names.scopeModuleName} to authService`,
  };
}

/**
 * Insert .withScopeModule(moduleName) before .build() in the chain
 */
function insertWithScopeModule(
  callExpr: namedTypes.CallExpression,
  moduleName: string
): void {
  // The structure is: something.build()
  // We need to change it to: something.withScopeModule(moduleName).build()

  if (
    callExpr.callee.type === "MemberExpression" &&
    callExpr.callee.property.type === "Identifier" &&
    callExpr.callee.property.name === "build"
  ) {
    // Found .build() - wrap its object with .withScopeModule()
    const originalObject = callExpr.callee.object;

    const withScopeModuleCall = b.callExpression(
      b.memberExpression(originalObject, b.identifier("withScopeModule")),
      [b.identifier(moduleName)]
    );

    callExpr.callee.object = withScopeModuleCall;
  }
}

function hasNamedImport(
  program: namedTypes.Program,
  importName: string,
  importSource: string
): boolean {
  return program.body.some((node) => {
    if (node.type !== "ImportDeclaration") {
      return false;
    }
    if (
      node.source.type !== "StringLiteral" ||
      node.source.value !== importSource
    ) {
      return false;
    }
    return node.specifiers?.some(
      (specifier) =>
        specifier.type === "ImportSpecifier" &&
        specifier.imported.type === "Identifier" &&
        specifier.imported.name === importName
    );
  });
}

function chainHasWithScopeModule(
  callExpr: namedTypes.CallExpression,
  moduleName: string
): boolean {
  const callee = callExpr.callee;
  if (callee.type === "MemberExpression") {
    if (
      callee.property.type === "Identifier" &&
      callee.property.name === "withScopeModule"
    ) {
      const arg = callExpr.arguments[0];
      if (arg && arg.type === "Identifier" && arg.name === moduleName) {
        return true;
      }
    }

    if (callee.object.type === "CallExpression") {
      return chainHasWithScopeModule(callee.object, moduleName);
    }
  }

  return false;
}
