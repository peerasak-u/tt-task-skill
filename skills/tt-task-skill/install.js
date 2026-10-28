// Installs tt-task-skill for Claude Code and other agents, and stores the API token on this machine.
// Runs two ways: `node install.js` beside the skill's files, or fetched and evaluated by the one-liner
// in README.md, where `globalThis.TT` is the address it was fetched from. Node 18+, no dependencies.
(async () => {
	// Evaluated text has no `import()`, and a module file has no `require`, so take whichever this run offers.
	const load = (name) => (process.getBuiltinModule ? process.getBuiltinModule(name) : typeof require === "function" ? require(name) : import(name));
	const fs = await load("node:fs");
	const os = await load("node:os");
	const path = await load("node:path");
	const readline = await load("node:readline");

	const SKILL = "tt-task-skill";
	const FILES = ["SKILL.md", "references/api.md", "scripts/tt.mjs", "install.js"];
	const USAGE = `usage: node install.js [--scope user|project] [--url <address>]

Asks for whatever is not given. The token is asked for, or read from TT_API_TOKEN when that is set.`;

	class Refusal extends Error {}

	const fetchedFrom = typeof globalThis.TT === "string" ? globalThis.TT : null;
	const args = process.argv.slice(fetchedFrom ? 1 : 2);
	const flag = (name) => {
		const at = args.indexOf(name);
		if (at === -1) return undefined;
		const value = args[at + 1];
		if (value === undefined || value.startsWith("--")) throw new Refusal(`${name} needs a value\n\n${USAGE}`);
		return value;
	};

	// One place on every system that only this user reads. `tt.mjs` reads the same path.
	const configDir = process.platform === "win32" && process.env.APPDATA
		? path.join(process.env.APPDATA, SKILL)
		: path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), SKILL);
	const configFile = path.join(configDir, "config.json");
	const readConfig = () => {
		try {
			return JSON.parse(fs.readFileSync(configFile, "utf8"));
		} catch {
			return {};
		}
	};

	let pipedLines;
	async function nextPipedLine() {
		pipedLines ??= readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
		const { value, done } = await pipedLines.next();
		if (done) throw new Refusal("ran out of input; run this in a terminal, or pass the flags in the usage");
		return value;
	}

	function askHidden(question) {
		return new Promise((resolve, reject) => {
			const { stdin, stdout } = process;
			let typed = "";
			stdout.write(question);
			stdin.setRawMode(true);
			stdin.resume();
			stdin.setEncoding("utf8");
			const finish = (settle, value) => {
				stdin.setRawMode(false);
				stdin.pause();
				stdin.off("data", onData);
				stdout.write("\n");
				settle(value);
			};
			const onData = (chunk) => {
				for (const char of chunk) {
					if (char === "\r" || char === "\n") return finish(resolve, typed);
					if (char === "\u0003") return finish(reject, new Refusal("cancelled"));
					if (char === "\u007f" || char === "\b") typed = typed.slice(0, -1);
					else if (char >= " ") typed += char;
				}
			};
			stdin.on("data", onData);
		});
	}

	async function ask(question, { hidden = false, fallback = "" } = {}) {
		const prompt = `${question}${fallback ? ` [${fallback}]` : ""}: `;
		let answer;
		if (!process.stdin.isTTY) {
			process.stdout.write(prompt);
			answer = await nextPipedLine();
			process.stdout.write("\n");
		} else if (hidden) {
			answer = await askHidden(prompt);
		} else {
			const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
			answer = await new Promise((resolve) => rl.question(prompt, resolve));
			rl.close();
		}
		return answer.trim() || fallback;
	}

	async function readSkillFiles() {
		if (!fetchedFrom) {
			const here = path.dirname(path.resolve(process.argv[1]));
			return FILES.map((name) => ({ name, text: fs.readFileSync(path.join(here, name), "utf8") }));
		}
		return Promise.all(
			FILES.map(async (name) => {
				const response = await fetch(new URL(name, fetchedFrom));
				const text = await response.text();
				// A site that answers every unknown path with its home page would otherwise install that page.
				if (!response.ok || /^\s*<!doctype html/i.test(text)) throw new Refusal(`could not download ${name} from ${new URL(name, fetchedFrom)}`);
				return { name, text };
			}),
		);
	}

	async function checkToken(apiUrl, token) {
		const call = async (route, headers) => {
			try {
				return await fetch(`${apiUrl}/api${route}`, { headers });
			} catch (error) {
				throw new Refusal(`could not reach ${apiUrl}: ${error.cause?.message ?? error.message}`);
			}
		};
		const health = await call("/health");
		if (!health.ok || (await health.json().catch(() => null))?.ok !== true) throw new Refusal(`${apiUrl} does not answer as TimeThunder (GET /api/health gave ${health.status})`);
		const probe = await call("/settings/operate-year", { authorization: `Bearer ${token}` });
		if (probe.status === 401) throw new Refusal("TimeThunder refused the token: it is wrong or revoked");
		if (!probe.ok) throw new Refusal(`TimeThunder answered ${probe.status} to the token check`);
	}

	async function main() {
		if (args.includes("--help") || args.includes("-h")) return console.log(USAGE);
		const stored = readConfig();
		console.log(`Installing ${SKILL}\n`);

		let scope = flag("--scope");
		if (scope === undefined) {
			console.log("Where should the skill go?\n  1  user: every project on this machine\n  2  project: only the folder you are in now");
			const choice = await ask("Choose 1 or 2", { fallback: "1" });
			scope = { 1: "user", 2: "project" }[choice] ?? choice;
		}
		if (scope !== "user" && scope !== "project") throw new Refusal(`scope must be user or project, got ${scope}`);
		const base = scope === "user" ? os.homedir() : process.cwd();

		const servedFrom = fetchedFrom ? new URL(fetchedFrom).origin : "";
		const apiUrl = (flag("--url") ?? (await ask("TimeThunder address", { fallback: stored.apiUrl || servedFrom }))).replace(/\/+$/, "").replace(/\/api$/, "");
		if (!URL.canParse(apiUrl)) throw new Refusal(`the address must look like https://example.com, got ${apiUrl || "nothing"}`);

		const keep = stored.apiToken && stored.apiUrl === apiUrl ? stored.apiToken : "";
		const typed = process.env.TT_API_TOKEN?.trim() || (await ask(`API token${keep ? " (leave empty to keep the stored one)" : ""}`, { hidden: true }));
		const apiToken = typed || keep;
		if (!apiToken) throw new Refusal("no token given; a staff member issues one on the TimeThunder settings page");
		await checkToken(apiUrl, apiToken);
		console.log("The token works.");

		const files = await readSkillFiles();
		const installed = [".claude", ".agents"].map((agentDir) => {
			const dir = path.join(base, agentDir, "skills", SKILL);
			for (const { name, text } of files) {
				const target = path.join(dir, name);
				fs.mkdirSync(path.dirname(target), { recursive: true });
				fs.writeFileSync(target, text);
			}
			return dir;
		});

		// The token stays out of the project folder at either scope, so it cannot be committed.
		fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
		fs.writeFileSync(configFile, `${JSON.stringify({ apiUrl, apiToken }, null, "\t")}\n`, { mode: 0o600 });
		fs.chmodSync(configFile, 0o600);

		console.log(`\nSkill installed in:\n${installed.map((dir) => `  ${dir}`).join("\n")}`);
		console.log(`Address and token stored in:\n  ${configFile}`);
		console.log(`\nStart a new agent session and ask it to fill a job's closing facts.`);
	}

	try {
		await main();
	} catch (error) {
		if (!(error instanceof Refusal)) throw error;
		console.error(`\n${error.message}`);
		process.exitCode = 1;
	} finally {
		process.stdin.pause();
	}
})();
