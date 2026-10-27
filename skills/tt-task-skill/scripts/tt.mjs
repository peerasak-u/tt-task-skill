#!/usr/bin/env node
// TimeThunder API client for agents. No dependencies; runs on Node 18+ or Bun.

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const USAGE = `usage:
  tt.mjs get <path>                          GET /api<path>, prints the JSON
  tt.mjs command <name> <json | @file>       POST /api/commands/<name>
  tt.mjs closing-queue [operateYear]         started jobs whose closing facts are incomplete
  tt.mjs closing-plan <jobId>                what is empty, and where the WP folder is
  tt.mjs fill-closing <jobId> <json | @file> [--dry-run]

The address, the token and the Dropbox folder come from the file install.js writes.
TT_API_URL, TT_API_TOKEN and TT_DROPBOX_DIR override it when set.`;

class Refusal extends Error {}

const FIELDS = {
	reportDate: { api: "reportDate", label: "วันที่หน้ารายงาน" },
	reportForm: { api: "reportForm", label: "รูปแบบหน้ารายงาน" },
	actualRevenueBaht: { api: "actualRevenueSatang", label: "รายได้จริง" },
	statedFeeBaht: { api: "statedFeeSatang", label: "ค่าสอบจากงบการเงิน" },
};
const REPORT_FORMS = ["unmodified", "qualified", "adverse", "disclaimer", "taWithoutException", "taWithException"];
const NOTE_LIMIT = 2000;

// The same path install.js writes.
const CONFIG_FILE =
	process.platform === "win32" && process.env.APPDATA
		? join(process.env.APPDATA, "tt-task-skill", "config.json")
		: join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "tt-task-skill", "config.json");

let stored;
function setting(envName, key) {
	const fromEnv = process.env[envName]?.trim();
	if (fromEnv) return fromEnv;
	if (stored === undefined) {
		try {
			stored = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
		} catch {
			stored = {};
		}
	}
	return stored[key] || null;
}

function required(envName, key) {
	const value = setting(envName, key);
	if (!value) throw new Refusal(`no ${key} in ${CONFIG_FILE} and ${envName} is not set; run install.js from this skill's folder`);
	return value;
}

async function request(method, path, body, idempotencyKey) {
	const url = `${required("TT_API_URL", "apiUrl").replace(/\/+$/, "")}/api${path}`;
	const response = await fetch(url, {
		method,
		headers: {
			authorization: `Bearer ${required("TT_API_TOKEN", "apiToken")}`,
			...(body === undefined ? {} : { "content-type": "application/json" }),
			...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Refusal(`${method} ${path} answered ${response.status} with a body that is not JSON: ${text.slice(0, 200)}`);
	}
	if (!response.ok) throw new Refusal(`${method} ${path} answered ${response.status}: ${json.message ?? text}`);
	return json;
}

const get = (path) => request("GET", path);

// One key per call, so a retry of the same call after a dropped connection cannot write twice.
async function command(name, input) {
	const key = randomUUID();
	try {
		return (await request("POST", `/commands/${name}`, input, key)).result;
	} catch (error) {
		if (error instanceof Refusal) throw error;
		return (await request("POST", `/commands/${name}`, input, key)).result;
	}
}

function readJsonArg(arg, what) {
	if (arg === undefined) throw new Refusal(`missing ${what}\n\n${USAGE}`);
	const text = arg.startsWith("@") ? readFileSync(arg.slice(1), "utf8") : arg;
	try {
		return JSON.parse(text);
	} catch {
		throw new Refusal(`${what} is not valid JSON`);
	}
}

function jobId(arg) {
	if (!/^\d+$/.test(arg ?? "")) throw new Refusal(`jobId must be the job's id (a positive integer), got ${arg}\n\n${USAGE}`);
	return Number(arg);
}

/** Baht as written in the financial statements, to satang, without going through a float. */
function bahtToSatang(field, value) {
	const text = String(value).replace(/,/g, "").trim();
	const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
	if (!match) throw new Refusal(`${field} must be baht with at most two decimals and no sign, got ${JSON.stringify(value)}`);
	return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function isoDate(field, value) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
	if (!match) throw new Refusal(`${field} must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
	if (Number(match[1]) > 2400) throw new Refusal(`${field} ${value} is a Buddhist-era year; subtract 543 and send the Christian-era date`);
	return value;
}

function toApiValue(field, value) {
	if (field === "reportDate") return isoDate(field, value);
	if (field === "reportForm") {
		if (!REPORT_FORMS.includes(value)) throw new Refusal(`reportForm must be one of ${REPORT_FORMS.join(", ")}, got ${JSON.stringify(value)}`);
		return value;
	}
	return bahtToSatang(field, value);
}

const baht = (satang) => (satang / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
const shown = (field, apiValue) => (field.endsWith("Baht") ? `${baht(apiValue)} บาท` : String(apiValue));

function localWpFolder(wpFolderPath) {
	const root = setting("TT_DROPBOX_DIR", "dropboxDir");
	if (!root || !wpFolderPath) return null;
	const path = join(root, wpFolderPath);
	return existsSync(path) ? { path, files: readdirSync(path).sort() } : { path, files: null };
}

function closingState(job) {
	const empty = Object.keys(FIELDS).filter((field) => job.closing[FIELDS[field].api] === null);
	const blocked = job.cancelledAt ? "the job is cancelled" : job.deliveredAt ? "the job is already delivered" : null;
	return { empty, blocked };
}

async function closingQueue(operateYear) {
	const year = operateYear ? `&operateYear=${encodeURIComponent(operateYear)}` : "";
	const { jobs } = await get(`/jobs?progress=started,readyToReview${year}`);
	return jobs
		.filter((job) => !job.isClosingComplete)
		.map((job) => ({
			jobId: job.id,
			jobNumber: job.jobNumber,
			business: job.business.name,
			fiscalYearEnd: job.fiscalYearEnd,
			reportPdfFound: job.reportPdfFound,
			fileCheck: job.readiness.fileCheck,
		}));
}

async function closingPlan(id) {
	const job = await get(`/jobs/${id}`);
	const { empty, blocked } = closingState(job);
	return {
		jobId: job.id,
		jobNumber: job.jobNumber,
		business: job.business.name,
		fiscalYearEnd: job.fiscalYearEnd,
		blocked,
		closing: job.closing,
		emptyFields: empty,
		wpFolderPath: job.files.wpFolderPath,
		localWpFolder: localWpFolder(job.files.wpFolderPath),
		indexedFiles: job.files.items.map((item) => ({ label: item.label, isReport: item.isReport, files: item.matches.map((m) => m.name) })),
		fileIndexSyncedAt: job.files.syncedAt,
	};
}

function noteText(written, skipped, unsure) {
	const lines = ["[เอเจนต์] กรอกข้อมูลปิดงานจากโฟลเดอร์ WP รอพนักงานตรวจ"];
	for (const w of written) lines.push(`- ${w.label}: ${w.shown} (ที่มา: ${w.evidence})`);
	for (const s of skipped) lines.push(`- ${s.label}: มีค่าอยู่แล้ว ไม่ได้แก้ (เอเจนต์อ่านได้ ${s.shown} จาก ${s.evidence})`);
	for (const u of unsure) lines.push(`- ${u.label}: ยังไม่ได้กรอก ${u.reason}`);
	const text = lines.join("\n");
	return text.length <= NOTE_LIMIT ? text : `${text.slice(0, NOTE_LIMIT - 1)}…`;
}

async function fillClosing(id, proposal, dryRun) {
	const { values = {}, evidence = {}, unsure = {} } = proposal;
	const unknown = [...Object.keys(values), ...Object.keys(evidence), ...Object.keys(unsure)].filter((field) => !(field in FIELDS));
	if (unknown.length > 0) throw new Refusal(`unknown field ${unknown.join(", ")}; the fields are ${Object.keys(FIELDS).join(", ")}`);
	if (Object.keys(values).length === 0 && Object.keys(unsure).length === 0) throw new Refusal("nothing to do: `values` and `unsure` are both empty");

	const parsed = Object.entries(values).map(([field, value]) => {
		if (field in unsure) throw new Refusal(`${field} is in both values and unsure`);
		const source = String(evidence[field] ?? "").trim();
		if (!source) throw new Refusal(`${field} has no evidence; name the file and page the value was read from`);
		const apiValue = toApiValue(field, value);
		return { field, ...FIELDS[field], apiValue, shown: shown(field, apiValue), evidence: source };
	});

	const job = await get(`/jobs/${id}`);
	const { empty, blocked } = closingState(job);
	if (blocked) throw new Refusal(`job ${id} takes no closing facts: ${blocked}`);

	const written = parsed.filter((p) => empty.includes(p.field));
	const skipped = parsed.filter((p) => !empty.includes(p.field) && job.closing[p.api] !== p.apiValue);
	const unsureRows = Object.entries(unsure).map(([field, reason]) => ({ field, label: FIELDS[field].label, reason: String(reason) }));
	const note = written.length + skipped.length + unsureRows.length > 0 ? noteText(written, skipped, unsureRows) : null;
	const summary = {
		jobId: job.id,
		jobNumber: job.jobNumber,
		dryRun,
		written: Object.fromEntries(written.map((w) => [w.field, w.shown])),
		skippedBecauseAlreadySet: Object.fromEntries(skipped.map((s) => [s.field, { current: job.closing[s.api], proposed: s.apiValue }])),
		unsure: Object.fromEntries(unsureRows.map((u) => [u.field, u.reason])),
		note,
	};
	if (dryRun) return summary;

	if (written.length > 0) {
		const result = await command("setClosing", { jobId: job.id, ...Object.fromEntries(written.map((w) => [w.api, w.apiValue])) });
		summary.stillMissing = result.missing;
	}
	if (note) summary.noteId = (await command("addNote", { jobId: job.id, text: note })).id ?? null;
	return summary;
}

async function main([verb, ...args]) {
	switch (verb) {
		case "get":
			if (!args[0]?.startsWith("/")) throw new Refusal(`path must start with /\n\n${USAGE}`);
			return get(args[0]);
		case "command":
			if (!args[0]) throw new Refusal(`missing command name\n\n${USAGE}`);
			return command(args[0], readJsonArg(args[1], "command input"));
		case "closing-queue":
			return closingQueue(args[0]);
		case "closing-plan":
			return closingPlan(jobId(args[0]));
		case "fill-closing":
			return fillClosing(jobId(args[0]), readJsonArg(args.find((a, i) => i > 0 && a !== "--dry-run"), "proposal"), args.includes("--dry-run"));
		default:
			throw new Refusal(USAGE);
	}
}

try {
	console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
} catch (error) {
	if (!(error instanceof Refusal)) throw error;
	console.error(error.message);
	process.exit(1);
}
