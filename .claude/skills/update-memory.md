# Update Memory

Update MEMORY.md after completing work on the Gameng project.

## Location

```
C:\Users\jjnie\.claude\projects\D--Gameng\memory\MEMORY.md
```

## What to Update

### After completing a slice/feature

Add to "Phases Completed" section:
```
- **<Name>**: Brief description of what was added. Key files/classes. Test count (X unit + Y E2E tests)
```

### After discovering a gotcha

Add to "Gotchas (continued)" section:
```
- **<Short title>**: Description of the problem and the solution. Include code snippet if helpful.
```

### After changing test counts

Update the test counts in the most recent phase entry.

### After adding dependencies

Note new deps in the relevant phase entry.

## Rules

- Keep MEMORY.md under 200 lines (lines after 200 are truncated in system prompt)
- Be concise — one line per phase, one paragraph per gotcha
- Use the established format (bold title, dash-separated details)
- Only record insights that would save time if encountered again
- Remove or update entries that are no longer accurate
- Don't duplicate info already in CLAUDE.md (CLAUDE.md is for conventions, MEMORY.md is for history/gotchas)
