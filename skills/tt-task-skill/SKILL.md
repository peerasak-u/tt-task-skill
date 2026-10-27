---
name: tt-task-skill
description: Work on TimeThunder Audit Manager through its API with an API token, on behalf of staff. Use when asked to fill in a job's closing facts (ข้อมูลปิดงาน) from its WP folder, to prepare jobs for delivery review, to look up jobs, customers, auditors or money in TimeThunder, or to run any TimeThunder command from an agent.
---

# TimeThunder tasks

You act as an external tool. Staff review what you write and a staff member approves delivery. Your token cannot approve delivery, and you never ask for a way around that.

## Setup

```sh
TT="node <this skill's folder>/scripts/tt.mjs"
```

`install.js` in this folder stored the address, the token and the Dropbox folder on this machine. `$TT get /settings/operate-year` proves all of it. When it fails, tell the user to run `node <this skill's folder>/install.js` in a terminal, and stop. Do not ask for the token in the conversation, do not read the stored file, and never print the token or write it to a note.

Every call goes through `scripts/tt.mjs`. It sends the token, sends an `Idempotency-Key` with each command, and prints the JSON answer. An error prints the server's message, which is in Thai, and exits 1. Routes and commands are listed in [references/api.md](references/api.md).

## Fill closing facts from the WP folder

A started job needs four closing facts before staff can approve delivery. You read them from the job's files and propose them. Staff check them on the job page.

| Field | Meaning | Format |
|---|---|---|
| `reportDate` | วันที่หน้ารายงาน, the date on the auditor's report | `YYYY-MM-DD`, Christian era |
| `reportForm` | รูปแบบหน้ารายงาน, the form of the auditor's opinion | one code from the table below |
| `actualRevenueBaht` | รายได้จริง, the business's revenue for the period in the financial statements | baht, at most two decimals |
| `statedFeeBaht` | ค่าสอบจากงบการเงิน, the audit fee stated in the financial statements | baht, at most two decimals |

| `reportForm` | Opinion |
|---|---|
| `unmodified` | ไม่มีเงื่อนไข |
| `qualified` | มีเงื่อนไข |
| `adverse` | ไม่ถูกต้อง |
| `disclaimer` | ไม่แสดงความเห็น |
| `taWithoutException` | ผู้สอบบัญชีภาษีอากร ไม่มีข้อยกเว้น |
| `taWithException` | ผู้สอบบัญชีภาษีอากร แบบมีข้อยกเว้น |

Steps, one job at a time:

1. **Pick the job.** `$TT closing-queue` lists started jobs with incomplete closing facts. Given a job number, use `$TT get '/jobs?jobNumber=<n>'` and take `jobs[0].id`. Every later step takes that `id`, not the job number.
2. **Plan.** `$TT closing-plan <jobId>` prints the empty fields, `wpFolderPath`, the files the index holds, and `localWpFolder` when a Dropbox folder was given at install. Stop when `blocked` is set or `emptyFields` is empty.
3. **Find the files.** The API lists file names and never serves file contents. Read the files from `localWpFolder.path`. When it is `null` or its `files` is `null`, tell the user the WP folder is not on this machine and stop. Do not guess values from file names.
4. **Read.** Read every file in the WP folder, then take each value from the document that states it: the report page for `reportDate` and `reportForm`, the financial statements for `actualRevenueBaht` and `statedFeeBaht`. Check that the business name and the period end match `business` and `fiscalYearEnd` from the plan. When they do not, write nothing and report it.
5. **Decide per field.** A value goes in `values` only when the document states it plainly. Anything you would have to infer, estimate, or choose between two candidates goes in `unsure` with the reason in Thai. Convert a Buddhist-era date by subtracting 543 from the year.
6. **Write.** Run with `--dry-run` first, read the summary, then run without it.

```sh
$TT fill-closing <jobId> '{
  "values":   { "reportDate": "2026-03-15", "reportForm": "unmodified", "actualRevenueBaht": "1234567.89" },
  "evidence": { "reportDate": "2 หน้ารายงาน.pdf หน้า 2", "reportForm": "2 หน้ารายงาน.pdf หน้า 1", "actualRevenueBaht": "4 งบการเงิน.pdf หน้า 3 บรรทัดรายได้รวม" },
  "unsure":   { "statedFeeBaht": "ไม่พบบรรทัดค่าสอบบัญชีในหมายเหตุประกอบงบ" }
}' --dry-run
```

`fill-closing` enforces the review rules, so use it and not a bare `setClosing`:

- It writes only fields that are empty. A field that already holds a different value is left alone and reported under `skippedBecauseAlreadySet`.
- It refuses a value without `evidence`. Evidence names the file and the page.
- It refuses a cancelled or delivered job.
- It adds one note to the job with every value, its evidence, and every `unsure` reason, so the reviewer can check without redoing the work.

7. **Report.** Tell the user the job number, what was written, what was skipped, what is still missing, and that a staff member must review and approve delivery.

Never send `signedDate`. The council lookup fills it and staff own it.

Writing `actualRevenueBaht` on a job whose price is not confirmed recalculates its rate. `closing-queue` lists started jobs only, where the price is locked. For any other job, tell the user before you write revenue.

## Other work

Read [references/api.md](references/api.md) and use `$TT get` and `$TT command`. Before a command that deletes, cancels, or changes money, rates, or settings, state what it will change and get the user's go-ahead in this conversation. A read needs no go-ahead.
