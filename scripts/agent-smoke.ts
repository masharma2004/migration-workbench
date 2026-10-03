import { runAgentLoop } from '../src/server/agent/loop';
import { getProvider } from '../src/server/agent/provider';
import { buildProposePrompt } from '../src/server/agent/prompts';
import { seedRecordsAsInput } from '../src/seed';

const provider = getProvider();
if (!provider) throw new Error('No provider configured');
const records = seedRecordsAsInput();
runAgentLoop({ provider, records, prompt: buildProposePrompt(records.length),
  onStep: async (s) => console.log(s.step, s.kind, s.toolName, JSON.stringify(s.result).slice(0, 160)) })
  .then((o) => console.log(JSON.stringify(o, null, 2).slice(0, 4000)));
