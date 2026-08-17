# Diffender

A local, read-only diff layer that captures the exact file delta produced by each AI coding prompt, using a private shadow git repo (`.diffender/git`), and surfaces it in VS Code's diff viewer — without ever touching the project's real `.git`.

## Status

Early development. See `IMPLEMENTATION_PLAN.md` for the full build plan.

## Requirements

- Node.js >= 18
- Git installed and on PATH

## Install (development)

```bash
git clone <repo>
cd diffender
npm install
npm link
```

## Usage

```bash
diffender --help
```

## Test

```bash
npm test
```
