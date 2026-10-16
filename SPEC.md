# In-Clinic: Spec

> **Status:** v0.1 built 2026-10-16 (`org.robbiemed.clinic`, label "Clinic"). Reworked from a copy of the On-Call app
> (`~/Projects/00-IDEA-oncall-tasks`, untouched). Installs side by side with On-Call. Installed on the Pixel 10a (68061JEA306814) 2026-10-16. 18 unit tests; full flow smoke-tested on the emulator.
> v0.2 (2026-10-16): PWA for iPad at the repo root (GitHub Pages), Android moved to `android/`, shared `library.json`. Repo: robbie-med/in-clinic.
> Build: `cd android && ./gradlew testDebugUnitTest assembleDebug`, then `adb -s 68061JEA306814 install -r app/build/outputs/apk/debug/app-debug.apk`. Web: `npm test`.
> v0.4 (2026-10-16): the clinic's note template, copied one section at a time; live E/M billing level (`billing.js` / `Billing.kt`) that also picks the teaching-physician attestation.
> Emulator testing: `emulator -avd Medium_Phone_API_36.1 -ports 3929,3930` (oncall's registered ports), `adb connect 127.0.0.1:3930`.

## Goal
The note is written by the time you walk out of the room. You tap through the visit, then use Copy note (or Share) and paste it into the EMR.

## Output format (the clinic's template)
Sections, each copied on its own into the EMR (titles not included): Chief Complaint, History of Present Illness (one-liner, the
"first time seeing this patient" records line for *new to me*, HPI lines), Physical Exam (vitals if typed, then examined systems),
Assessment/Plan (`1. Problem`, status lines New|Known / Acute|Subacute|Chronic / trend with `***` if unpicked, supporting lines, DDx, blank, `- plan`; then `F/u w <who> in <when> to <why>`), Signature (signature setting + attestation).
Status lines also feed billing. Pinned by `NoteTest` and `tools/test.mjs`.

## Billing
AMA 2021+ office E/M by MDM (2nd-highest of problems, data, risk). Problems from status pills, with a per-problem override. Data from
tests named in plan lines plus manual counters and toggles. Risk from plan lines (med verbs or "prescri" = Rx management), with an override and an SDOH toggle.
The code can be set by hand. Attestation: primary care exception text for 99202/99203/99211-99213, physically-present text above that.
Same rules in `js/billing.js` and `Billing.kt`, each with its own test suite.

## Screens
- **Panel:** visits sorted by slot. `Import` takes a pasted or shared schedule and keeps only time, age, sex and visit type (names, MRNs and DOBs are dropped).
  `⋯` → Clear panel (end of clinic). Visits auto-drop after 3 days.
- **Visit:** time, age, F/M, relation, visit type and chief complaint build the one-liner (tap it to override). The HPI is a line list.
  `+ Problem` searches the library (`Library.kt`, ~40 primary-care problems) or adds a free problem. Each problem has status pills,
  Notes, DDx (grouped chips; hold one to annotate, e.g. "(PHQ-9 negative)") and Plan (chips, plus med verbs CONT/START/INCREASE/DECREASE/STOP/REFILL).
  **Exam** (ported from On-Call: same systems, normals and findings, plus HEENT, Psych and Wt): vitals fields, then nL or abnL per
  system, "+ other" for a typed finding, "All untouched → nL". It prints between the HPI and PLAN as `Vitals:` and `Exam:` lines (examined systems only).
  A chip containing `***` drops into the field with the blank selected. Follow-up has interval and purpose chips.
- **Paste last note:** parses a prior note in this format. Its problems come back as Known with the trend cleared; plan, notes and DDx are kept.

## Learning
Typed plan lines and follow-up purposes are remembered per problem and come back as chips (hold one to forget it). Free-typed problem
names are offered in the picker. HPI and notes are **not** learned, since they're patient-specific.

## Privacy
Credential-encrypted SharedPreferences, `allowBackup=false`, and copies are marked clipboard-sensitive. The app stores no names, but notes can contain dates.

## Later
Editable library, voice capture, G2211 add-on hint.
