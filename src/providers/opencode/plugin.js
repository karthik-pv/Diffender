const { createSessionHandler } = require("../../.diffender/lib/session-handler");
const { getWorkingDiff, commitCurrentState, resetShadowRepo } = require("../../.diffender/lib/git-engine");
const { loadConfig } = require("../../.diffender/lib/config");
const { openDiffForWorkingChanges } = require("../../.diffender/lib/vscode");

export const DiffenderPlugin = async ({ client, directory }) => {
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
        case "message.updated":
          handler.onMessage(event);
          break;
        case "session.idle":
          await handler.onIdle(event);
          break;
        case "session.updated":
          await handler.onSessionUpdated(event);
          break;
      }
    },
  };
};
