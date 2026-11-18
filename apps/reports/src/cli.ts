import { run } from './generate.js';
const directory = process.argv[2];
if (!directory || process.argv.length !== 3) throw new Error('Usage: node apps/reports/dist/cli.js OUTPUT_DIRECTORY');
console.log(run(directory));
