/**
 * @typedef {Object} Provider
 * @property {string} name - String identifier (e.g. "opencode", "claude-code").
 * @property {function(string): Promise<boolean>} detect - Checks whether this
 *   provider's marker exists in the project at `projectRoot`.
 * @property {function(string): Promise<void>} install - Writes the hook/plugin
 *   files this provider needs, wired to the core git engine + diff viewer.
 * @property {function(string): Promise<void>} uninstall - Removes those files
 *   cleanly (for reset/re-init scenarios and test teardown).
 */

const REQUIRED_MEMBERS = ['name', 'detect', 'install', 'uninstall'];

/**
 * Validates that a module conforms to the Provider contract.
 * @param {any} module - The module to validate.
 * @returns {boolean} True if the module implements all required members.
 */
function conformsToContract(module) {
  if (!module || typeof module !== 'object') {
    return false;
  }
  for (const member of REQUIRED_MEMBERS) {
    if (module[member] === undefined || module[member] === null) {
      return false;
    }
  }
  if (typeof module.name !== 'string') return false;
  if (typeof module.detect !== 'function') return false;
  if (typeof module.install !== 'function') return false;
  if (typeof module.uninstall !== 'function') return false;
  return true;
}

module.exports = {
  REQUIRED_MEMBERS,
  conformsToContract,
};
