# In-Clinic: Spec

> **Status:** v0.1 built 2026-10-16 (`org.robbiemed.clinic`, label "Clinic"). Reworked from a copy of the On-Call app
> (`~/Projects/00-IDEA-oncall-tasks`, untouched). Installs side by side with On-Call. Installed on the Pixel 10a (68061JEA306814) 2026-10-16. 18 unit tests; full flow smoke-tested on the emulator.
> v0.2 (2026-10-16): PWA for iPad at the repo root (GitHub Pages), Android moved to `android/`, shared `library.json`. Repo: robbie-med/in-clinic.
> Build: `cd android && ./gradlew testDebugUnitTest assembleDebug`, then `adb -s 68061JEA306814 install -r app/build/outputs/apk/debug/app-debug.apk`. Web: `npm test`.
> Emulator testing: `emulator -avd Medium_Phone_API_36.1 -ports 3929,3930` (oncall's registered ports), `adb connect 127.0.0.1:3930`.

## Goal
The note is written by the time you walk out of the room. You tap through the visit, then use Copy note (or Share) and paste it into the EMR.

## Output format (the user's own)
```
41F known to me here for follow-up of fatigue.

<HPI lines>

PLAN

#Problem
New|Known
Acute|Subacute|Chronic
Worsening|Stable|Improving|Resolved
<supporting lines>
DDx:
>Group: a, b, c

- plan item

Follow-up: 2 wk to review labs and confirm sleep study scheduled.
```
An unpicked status or follow-up interval prints `***` (Epic F2). Health maintenance has no status lines. The format is pinned by `NoteTest.rendersTheUsersFormat`.

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
MDM summary from statuses, editable library, voice capture.
