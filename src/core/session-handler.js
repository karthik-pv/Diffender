function createSessionHandler(deps) {
  const {
    getMessages,
    getWorkingDiff,
    loadConfig,
    openDiff,
    commitSnapshot,
    reset,
  } = deps;

  const revertState = new Map();
  let lastPromptText = null;

  function onMessage(event) {
    const msg = event?.properties?.message;
    if (msg && msg.role === 'user' && msg.content) {
      lastPromptText = msg.content;
    }
  }

  async function onIdle(event) {
    let promptText = lastPromptText;
    lastPromptText = null;

    if (!promptText && getMessages) {
      try {
        const messages = await getMessages(event?.properties?.session?.id);
        if (Array.isArray(messages)) {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user' && messages[i].content) {
              promptText = messages[i].content;
              break;
            }
          }
        }
      } catch {}
    }

    if (!promptText) {
      promptText = new Date().toISOString();
    }

    const { files } = await getWorkingDiff();

    if (files.length > 0) {
      const config = await loadConfig();
      if (config.open_diff_auto && openDiff) {
        await openDiff();
      }
    }

    await commitSnapshot(promptText);
  }

  async function onSessionUpdated(event) {
    const session = event?.properties?.session || {};
    const sessionId = session.id || 'default';
    const currentRevert = session.revert;

    const lastRevert = revertState.get(sessionId);
    const hadRevert = lastRevert !== undefined && lastRevert !== null;
    const hasRevert = currentRevert !== undefined && currentRevert !== null;

    if (hadRevert !== hasRevert) {
      await reset();
    }

    revertState.set(sessionId, currentRevert);
  }

  return { onMessage, onIdle, onSessionUpdated };
}

module.exports = { createSessionHandler };
