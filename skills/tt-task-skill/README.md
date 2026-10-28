# tt-task-skill

An agent skill for TimeThunder Audit Manager. It lets an agent read TimeThunder through its API and fill a job's closing facts that it is given, for staff to review.

## Install

Needs Node 18 or later. The same line works in Terminal on macOS and Linux, and in PowerShell or Command Prompt on Windows. Replace the address with your TimeThunder address.

```sh
node -e "fetch(globalThis.TT='https://your-timethunder.example/skills/tt-task-skill/install.js').then(r=>r.text()).then(eval)"
```

From a checkout of this repository:

```sh
node skills/tt-task-skill/install.js
```

The installer asks three things:

1. **Scope.** `user` puts the skill in `~/.claude/skills` and `~/.agents/skills`. `project` puts it in `.claude/skills` and `.agents/skills` of the folder you run it from.
2. **TimeThunder address.**
3. **API token.** A staff member issues one on the TimeThunder settings page. Typing is hidden. The installer checks the token before it stores anything.

To skip the questions, pass flags and set `TT_API_TOKEN`. With the one-line form, put `--` before the flags.

```sh
node skills/tt-task-skill/install.js --scope user --url https://example.com
```

Run it again to update the skill or to replace the token.

## Where things are stored

| What | Where |
|---|---|
| The skill | `.claude/skills/tt-task-skill` and `.agents/skills/tt-task-skill`, under your home folder or the project |
| Address and token | `%APPDATA%\tt-task-skill\config.json` on Windows, `~/.config/tt-task-skill/config.json` elsewhere |

The token is stored as plain text in a file only your user can read. It is never placed in a project folder. To remove it, delete that file and ask staff to revoke the token.

`TT_API_URL` and `TT_API_TOKEN` override the stored values when set.

## How the installer reaches other machines

The one-line install fetches `install.js` and the skill files from `/skills/tt-task-skill/` on your TimeThunder address, when your TimeThunder deployment serves them. Those files are public and hold no secret. Without that, clone this repository and run `node skills/tt-task-skill/install.js`.
