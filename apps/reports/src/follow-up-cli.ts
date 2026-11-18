import { readFileSync } from 'node:fs';
import { followUp, type Action } from './follow-up.js';
const [directory, actionFile] = process.argv.slice(2);
if (!directory || !actionFile || process.argv.length !== 4) throw new Error('Usage: follow-up-cli.js PRIVATE_DIRECTORY ACTION_JSON');
console.log('SIMULATED FIXTURE ONLY: no live acceptance or work execution');
console.log(JSON.stringify(followUp(directory, JSON.parse(readFileSync(actionFile, 'utf8')) as Action), null, 2));
