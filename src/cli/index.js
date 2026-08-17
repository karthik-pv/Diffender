const { program } = require('commander');

program
  .name('diffender')
  .description('A local, read-only diff layer that captures file deltas produced by AI coding prompts.')
  .version('0.1.0');

const args = process.argv.slice(2);

if (args.length === 0) {
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);

const unknownArgs = program.args;
if (unknownArgs.length > 0) {
  console.error(`error: unknown command '${unknownArgs[0]}'. Run 'diffender --help' for available commands.`);
  process.exit(1);
}
