const fs = require('fs');

const setupPath = 'tests/setup-bun.ts';
let setup = fs.readFileSync(setupPath, 'utf8');

// Ensure globalThis.mock is bound and has clearAllMocks
if (!setup.includes('globalThis.mock = mock;')) {
    setup += '\nimport { mock } from "bun:test";\nglobalThis.mock = mock;\nif (typeof globalThis.mock.clearAllMocks !== "function") globalThis.mock.clearAllMocks = () => {};';
    fs.writeFileSync(setupPath, setup);
}
