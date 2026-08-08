---
name: Agent Skills
description: Explain, inspect, create, and maintain 小白龙 Agent Skills packages built around SKILL.md instructions.
tags:
  - skills
  - agent
  - workflow
aliases:
  - Agent Skills
  - SKILL.md
  - skills
triggers:
  - create a skill
  - list skills
  - agent skills
---

# Agent Skills

Use this skill when the user asks about 小白龙 skills, wants to list installed skills, or wants to create a reusable workflow package.

## 小白龙 Skill Format

A 小白龙 Agent Skill is a folder under the configured skills root. The required file is `SKILL.md`.

Minimum frontmatter:

```yaml
---
name: My Skill
description: A precise sentence describing when this skill should activate.
---
```

Optional metadata:

```yaml
tags:
  - docs
aliases:
  - alternate name
triggers:
  - phrase that should strongly activate this skill
```

Optional folders:

- `scripts/` for helper scripts.
- `references/` for detailed documentation.
- `assets/` for templates and reusable files.

## Authoring Guidance

- Keep `description` specific. 小白龙 uses it during skill selection.
- Put the workflow rules in `SKILL.md`.
- Put long examples, templates, or API references in separate files and mention their paths.
- Treat third-party skills as untrusted. Read their instructions and scripts before using them.
- Do not execute bundled scripts unless the user's goal calls for it and normal tool safety rules allow it.
