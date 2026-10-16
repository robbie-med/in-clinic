# In-Clinic

Clinic note builder. You tap through the visit in the room, and the note is written by the time you walk out.
**Copy note**, then paste it into the EMR.

Two apps, one behavior:
- **Web app / PWA** (iPad, any browser): this repo's root, served by GitHub Pages at <https://robbie-med.github.io/in-clinic/>.
- **Android:** [`apk/in-clinic.apk`](apk/in-clinic.apk), with source in [`android/`](android/).

Everything stays on the device that's running it. There's no server, account or sync. No names or MRNs are entered, and the app never asks for them.

## Install on iPad
1. Open <https://robbie-med.github.io/in-clinic/> in **Safari**.
2. Tap Share → **Add to Home Screen**.
3. Open it from the home screen once while online. After that it works offline (service worker).

Landscape puts the live note beside the editor. Portrait puts it below, with a Copy bar at the bottom.

## The note
```
41F known to me here for follow-up of fatigue.

<HPI lines>

PLAN

#Fatigue
New
Chronic
Worsening
<supporting lines>
DDx:
>Non-hormonal: OSA, depression/anxiety (PHQ-9 negative)
>Hormonal: hyperprolactinemia

- 8 AM serum cortisol with simultaneous ACTH, DHEA-S

Follow-up: 2 wk to review labs and confirm sleep study scheduled.
```
An unpicked status or follow-up prints `***` (Epic F2 jumps to it).

## Use
- **Tonight:** use **Import** with a pasted schedule. Only time, age, sex and visit type are kept; names, MRNs and DOBs are dropped.
  For a known patient, open the visit and use **Paste last note**. Its #problems come back as Known with the trend cleared, and the plan, notes and DDx are kept.
- **In the room:**
  - Age, F/M, known/new, visit type and chief complaint build the one-liner. Tap the one-liner to override it.
  - HPI lines: type or dictate, then press Enter.
  - **+ Problem:** type a few letters, then Enter. Then tap the status, DDx chips (hold one to annotate) and plan chips, or use CONT/START/… to type a med.
  - Follow-up: pick an interval and a reason, then **Copy note**.
- A chip with `***` drops into the field with the blank selected, so you type over it.
- Plan lines you type become chips for that problem next time. Hold a remembered chip to forget it.
- ⋯ → **Clear panel** at the end of clinic. Visits are removed after 3 days anyway.

## Develop
- `library.json` is the one source of the problem library (~40 primary-care problems). After editing it:
  `node tools/gen-library.mjs` (writes the Android copy) and `node tools/version-sw.mjs` (so installed PWAs update).
- Tests: `npm test` covers the web logic, the library sync and the SW version. Android: `cd android && ./gradlew testDebugUnitTest assembleDebug`.
  Both suites pin the same sample note.
- Local preview: `python3 -m http.server 3933 --bind 127.0.0.1` (port 3933 is registered in `~/Projects/PORTS.md`).
- APK: `cp android/app/build/outputs/apk/debug/app-debug.apk apk/in-clinic.apk`. It's debug-signed; install it with `adb install -r`.

Clinical chips are starting points to tap from, not recommendations. Review them against local practice.
