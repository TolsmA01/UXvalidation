# CLAUDE.md — AI Assistant Guide for UXvalidation

## Project Overview

**UXvalidation** is a tool to assess UX (User Experience) quality based on established UX guidelines. This is an early-stage greenfield project.

- **Repository:** TolsmA01/UXvalidation
- **Status:** Initial setup — no source code yet
- **Last updated:** 2026-02-27

---

## Current Repository State

As of the last update, the repository contains only:

```
/
├── README.md       # One-line project description
└── CLAUDE.md       # This file
```

No tech stack, build system, test framework, or source code has been established yet. When implementing features, document any new tooling decisions in this file.

---

## Development Branch

When working as an AI assistant on this repository, always develop on the designated Claude branch:

- **Branch pattern:** `claude/<task-id>`
- **Active session branch:** `claude/claude-md-mm5gclvfqne452ec-oc0lb`

Never push directly to `master` without explicit user permission.

---

## Tech Stack (TBD)

No stack has been chosen yet. When one is established, update this section with:

- Language(s) and runtime version(s)
- Framework(s)
- Package manager and lock file convention
- Build tool
- Test framework
- Linting/formatting tools

---

## Project Conventions (to be established)

Once the project grows, document conventions here:

### Code Style
- [ ] Formatter (e.g., Prettier, Black, gofmt)
- [ ] Linter (e.g., ESLint, pylint, golangci-lint)
- [ ] Configuration file locations

### Directory Structure
- [ ] Source root (e.g., `src/`, `app/`, `lib/`)
- [ ] Test location (e.g., `__tests__/`, `tests/`, `spec/`)
- [ ] Assets and static files
- [ ] Configuration files

### Naming Conventions
- [ ] File naming (kebab-case, camelCase, snake_case)
- [ ] Component/class/function naming patterns
- [ ] Test file naming (e.g., `*.test.ts`, `*_test.go`)

---

## Common Commands (to be established)

Update this section as the project tooling is set up:

```bash
# Install dependencies
# <command here>

# Run development server
# <command here>

# Run tests
# <command here>

# Run linter
# <command here>

# Build for production
# <command here>
```

---

## Git Workflow

### Commits
- Write clear, imperative commit messages (e.g., `Add UX guideline parser`)
- Commits are GPG-signed via SSH key (configured in the repo)
- Keep commits focused on a single logical change

### Branches
- Feature work: branch from `master`, name descriptively
- AI-assistant work: always use a `claude/<task-id>` branch
- Never force-push to `master`

### Pull Requests
- Summarize what changed and why in the PR description
- Reference any related issues

---

## UX Validation Domain Context

This tool will assess UX quality against guidelines. When building features, keep in mind:

- **Guidelines source:** What UX guidelines will be used (e.g., Nielsen's heuristics, WCAG, custom ruleset)? Clarify with the user before implementing.
- **Input:** What is being evaluated? (e.g., screenshots, HTML, design files, user flows)
- **Output:** What does validation produce? (e.g., scores, issues list, recommendations)
- **Audience:** Who uses this tool? (e.g., designers, developers, QA teams)

These decisions will shape the architecture significantly — ask the user to define them before starting implementation.

---

## AI Assistant Instructions

When working in this repository as an AI assistant:

1. **Read this file first** before making any changes.
2. **Update this file** whenever you introduce new tooling, conventions, or architectural decisions.
3. **Ask before choosing a stack** — the user has not yet specified a technology preference.
4. **Prefer simple solutions** — this is a greenfield project; avoid over-engineering.
5. **Document as you build** — add commands, conventions, and structure to the sections above as they are established.
6. **Commit to the correct branch** — always use the `claude/<task-id>` branch pattern.
7. **Do not push to master** without explicit user instruction.
