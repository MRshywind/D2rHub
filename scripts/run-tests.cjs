const fs = require("fs");
const path = require("path");
const ts = require("typescript");

require.extensions[".ts"] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

function findTests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTests(fullPath);
    return entry.name.endsWith(".test.ts") ? [fullPath] : [];
  });
}

const sourceDirectory = path.join(__dirname, "..", "src");
for (const testFile of findTests(sourceDirectory).sort()) {
  require(testFile);
}
