const { program } = require('commander');

const {
  initShadowRepo,
  isShadowRepoInitialized,
  getHistory,
  getWorkingDiff,
  getCommitDiff,
  commitCurrentState,
  resetShadowRepo,
} = require('../core/git-engine');

const {
  createDefaultConfig,
  loadConfig,
} = require('../core/config');

const {
  isCodeCliAvailable,
  openDiffForCommit,
  openDiffForWorkingChanges,
} = require('../core/vscode');

const { gitintegrate } = require('../core/git-integrate');
const { getProvider, listProviders, validateProvider } = require('../providers/registry');

const NOT_INITIALIZED_MSG =
  "Diffender is not initialized in this project. Run 'diffender init' first.";

function requireInit(projectRoot) {
  return isShadowRepoInitialized(projectRoot);
}

function firstLine(message) {
  return message.split('\n')[0];
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '\u2026';
}

program
  .name('diffender')
  .description('A local, read-only diff layer that captures file deltas produced by AI coding prompts.')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize diffender in the current project (creates .diffender/git + config.json).')
  .option('--opencode', 'Install the opencode provider plugin.')
  .option('--claude', 'Install the Claude Code provider plugin.')
  .allowUnknownOption()
  .action(async (options) => {
    const projectRoot = process.cwd();
    try {
      const rawArgs = process.argv.slice(2);
      const providerFlags = rawArgs
        .filter((a) => a.startsWith('--') && a !== '--opencode' && a !== '--claude')
        .map((a) => a.replace(/^--/, ''));

      if (providerFlags.length > 0) {
        const unknown = providerFlags[0];
        const available = listProviders().join(', ');
        console.error(
          `error: provider '${unknown}' is not yet supported. Available providers: ${available}.`
        );
        process.exit(1);
      }

      let providerName = null;
      if (options.opencode) {
        providerName = 'opencode';
      } else if (options.claude) {
        providerName = 'claude-code';
      }

      if (providerName && !validateProvider(providerName)) {
        const available = listProviders().join(', ');
        console.error(
          `error: provider '${providerName}' is not yet supported. Available providers: ${available}.`
        );
        process.exit(1);
      }

      const alreadyInitialized = await isShadowRepoInitialized(projectRoot);
      if (alreadyInitialized) {
        await createDefaultConfig(projectRoot);
        if (providerName) {
          const provider = getProvider(providerName);
          await provider.install(projectRoot);
          console.log(`Provider '${providerName}' installed.`);
        }
        console.log('Diffender is already initialized. Nothing to do.');
        return;
      }
      await initShadowRepo(projectRoot);
      await createDefaultConfig(projectRoot);
      console.log('Diffender initialized. Shadow repo created at .diffender/git.');
      const giResult = await gitintegrate(projectRoot);
      console.log(giResult.message);
      if (providerName) {
        const provider = getProvider(providerName);
        await provider.install(projectRoot);
        console.log(`Provider '${providerName}' installed.`);
      }
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('history')
  .description('Show the history of captured prompt diffs.')
  .action(async () => {
    const projectRoot = process.cwd();
    if (!(await requireInit(projectRoot))) {
      console.log(NOT_INITIALIZED_MSG);
      return;
    }
    try {
      const history = await getHistory(projectRoot);
      if (history.length === 0) {
        console.log('No history yet.');
        return;
      }
      const hashWidth = 40;
      const dateWidth = 19;
      const msgWidth = 50;
      const header =
        'HASH'.padEnd(hashWidth) + '  ' +
        'DATE'.padEnd(dateWidth) + '  ' +
        'MESSAGE';
      console.log(header);
      console.log('-'.repeat(header.length));
      for (const entry of history) {
        const hash = entry.hash;
        const date = entry.date.slice(0, dateWidth);
        const msg = truncate(firstLine(entry.message), msgWidth);
        console.log(`${hash.padEnd(hashWidth)}  ${date.padEnd(dateWidth)}  ${msg}`);
      }
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('show <hash>')
  .description('Show the diff for a specific commit hash (prints to terminal and opens VS Code diff).')
  .option('--no-open', 'Print diff to terminal only, do not open VS Code diff view.')
  .action(async (hash, options) => {
    const projectRoot = process.cwd();
    if (!(await requireInit(projectRoot))) {
      console.log(NOT_INITIALIZED_MSG);
      return;
    }
    try {
      const history = await getHistory(projectRoot);
      const found = history.find((h) => h.hash === hash || h.hash.startsWith(hash));
      if (!found) {
        console.error(`error: commit '${hash}' not found. Run 'diffender history' for available commits.`);
        process.exit(1);
      }
      const { diff } = await getCommitDiff(projectRoot, found.hash);
      const config = await loadConfig(projectRoot);
      if (config.print_diff_to_terminal) {
        console.log(diff);
      }
      if (options.open) {
        try {
          await openDiffForCommit(projectRoot, found.hash);
        } catch (err) {
          console.error(`warning: could not open VS Code diff: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('latest')
  .description('Show the latest diff (uncommitted changes or last commit). Always opens VS Code diff.')
  .option('--no-open', 'Print diff to terminal only, do not open VS Code diff view.')
  .action(async (options) => {
    const projectRoot = process.cwd();
    if (!(await requireInit(projectRoot))) {
      console.log(NOT_INITIALIZED_MSG);
      return;
    }
    try {
      const { diff, files } = await getWorkingDiff(projectRoot);
      const config = await loadConfig(projectRoot);
      if (files.length > 0) {
        if (config.print_diff_to_terminal) {
          console.log(diff);
        }
        if (options.open) {
          try {
            await openDiffForWorkingChanges(projectRoot);
          } catch (err) {
            console.error(`warning: could not open VS Code diff: ${err.message}`);
          }
        }
        return;
      }
      const history = await getHistory(projectRoot);
      if (history.length <= 1) {
        console.log('No changes to show. No prompts have been captured yet.');
        return;
      }
      const { diff: commitDiff } = await getCommitDiff(projectRoot, history[0].hash);
      if (config.print_diff_to_terminal) {
        console.log(commitDiff);
      }
      if (options.open) {
        try {
          await openDiffForCommit(projectRoot, history[0].hash);
        } catch (err) {
          console.error(`warning: could not open VS Code diff: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('reset')
  .description('Reset the shadow repo — wipes all history and creates a fresh baseline commit.')
  .action(async () => {
    const projectRoot = process.cwd();
    if (!(await requireInit(projectRoot))) {
      console.log(NOT_INITIALIZED_MSG);
      return;
    }
    try {
      await resetShadowRepo(projectRoot);
      const history = await getHistory(projectRoot);
      console.log(`Diffender reset. New baseline commit: ${history[0].hash.slice(0, 8)}`);
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('snapshot <message>')
  .description('Manually commit the current state with a message (bypasses the hook).')
  .action(async (message) => {
    const projectRoot = process.cwd();
    if (!(await requireInit(projectRoot))) {
      console.log(NOT_INITIALIZED_MSG);
      return;
    }
    try {
      const committed = await commitCurrentState(projectRoot, message);
      if (!committed) {
        console.log('No changes to snapshot.');
        return;
      }
      const history = await getHistory(projectRoot);
      console.log(`Snapshot created: ${history[0].hash.slice(0, 8)} — ${message}`);
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('gitintegrate')
  .description('Add .diffender/ to the real repo\'s .git/info/exclude so it stays invisible.')
  .action(async () => {
    const projectRoot = process.cwd();
    try {
      const result = await gitintegrate(projectRoot);
      console.log(result.message);
    } catch (err) {
      console.error(`error: ${err.message}`);
      process.exit(1);
    }
  });

const args = process.argv.slice(2);

if (args.length === 0) {
  program.outputHelp();
  process.exit(0);
}

program.parse(process.argv);

