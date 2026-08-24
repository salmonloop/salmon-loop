const fs = require('fs');

const path = 'src/cli/ui/components/messageList/utils.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  'const PAD_2 = Array.from({ length: 60 }, (_, i) => (i < 10 ? `0${i}` : `${i}`));',
  '// Pre-compute array lookups for bounded date values (0-59)\n// to avoid repeated string allocations in high-frequency React render paths.\nconst PAD_2 = Array.from({ length: 60 }, (_, i) => (i < 10 ? `0${i}` : `${i}`));'
);

fs.writeFileSync(path, content, 'utf8');
