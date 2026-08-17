const { conformsToContract } = require('./provider-interface');

const providers = {};

function register(provider) {
  if (!conformsToContract(provider)) {
    throw new Error(
      `Provider '${provider && provider.name}' does not conform to the provider contract.`
    );
  }
  providers[provider.name] = provider;
}

function getProvider(name) {
  const provider = providers[name];
  if (!provider) {
    const available = Object.keys(providers);
    throw new Error(
      `Provider '${name}' is not yet supported. Available providers: ${available.join(', ')}.`
    );
  }
  return provider;
}

function listProviders() {
  return Object.keys(providers);
}

function validateProvider(name) {
  return name in providers;
}

function detectProvider(projectRoot) {
  for (const name of Object.keys(providers)) {
    const provider = providers[name];
    if (provider.detect(projectRoot)) {
      return provider;
    }
  }
  return null;
}

const opencode = require('./opencode');
register(opencode);

module.exports = {
  register,
  getProvider,
  listProviders,
  validateProvider,
  detectProvider,
};
