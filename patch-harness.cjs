const fs = require('fs');
const harnessPath = 'tests/helpers/bun-test-harness.ts';
let harness = fs.readFileSync(harnessPath, 'utf8');
harness = harness.replace('mock.clearAllMocks();', 'if (typeof mock.clearAllMocks === "function") mock.clearAllMocks();');
fs.writeFileSync(harnessPath, harness);
