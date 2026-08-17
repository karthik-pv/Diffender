let sessionHandler, gitEngine, config, vscode;
try {
  sessionHandler = require('./lib/session-handler');
  gitEngine = require('./lib/git-engine');
  config = require('./lib/config');
  vscode = require('./lib/vscode');
} catch {
  sessionHandler = require('../../core/session-handler');
  gitEngine = require('../../core/git-engine');
  config = require('../../core/config');
  vscode = require('../../core/vscode');
}

const { createSessionHandler } = sessionHandler;
const { getWorkingDiff, commitCurrentState, resetShadowRepo } = gitEngine;
const { loadConfig } = config;
const { openDiffForWorkingChanges } = vscode;

const DiffenderPlugin = async ({ client, directory }) => {
  const projectRoot = directory || process.cwd();

  const getMessages = client?.session?.messages
    ? async (sessionId) => client.session.messages({ id: sessionId })
    : null;

  const handler = createSessionHandler({
    getMessages,
    getWorkingDiff: () => getWorkingDiff(projectRoot),
    loadConfig: () => loadConfig(projectRoot),
    openDiff: () => openDiffForWorkingChanges(projectRoot),
    commitSnapshot: (message) => commitCurrentState(projectRoot, message),
    reset: () => resetShadowRepo(projectRoot),
  });

  return {
    event: async ({ event }) => {
      switch (event.type) {
        case 'message.updated':
          handler.onMessage(event);
          break;
        case 'session.idle':
          await handler.onIdle(event);
          break;
        case 'session.updated':
          await handler.onSessionUpdated(event);
          break;
      }
    },
  };
};

module.exports = { DiffenderPlugin };
