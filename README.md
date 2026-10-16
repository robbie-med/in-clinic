# In-Clinic

Clinic note builder. You tap through the visit in the room, and the note is written by the time you walk out.
Each section (Chief Complaint, HPI, Physical Exam, Assessment/Plan, Signature) has its own **Copy** button, so you paste it into the
EMR's matching section. The E/M level is calculated live as you go.

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
Sections, each copied on its own (titles aren't part of the copied text):
```
Chief Complaint             fatigue
History of Present Illness  41F known to me presents for follow-up of fatigue.
                            <HPI lines>
Physical Exam               General: No acute distress, pleasant, conversant, well-groomed
                            MSK: Normal ambulation, no clubbing or cyanosis, myofascial trigger points
Assessment/Plan             1. Fatigue
                            New
                            Chronic
                            Worsening
                            <supporting lines>
                            DDx:
                            >Hormonal: hyperprolactinemia

                            - 8 AM serum cortisol with simultaneous ACTH, DHEA-S

                            F/u w Dr. Richard in 2 wk to review labs
Signature                   <your signature block> + teaching-physician attestation
```
- "New to me" prints the line *This was my first time seeing this patient, but records were available for review and the patient is well-known to our clinic.* under the one-liner.
- Status lines (New/Known, Acute/Subacute/Chronic, trend) print one per line under the problem; an unpicked one prints `***`. They also drive the billing level.
- The attestation follows the billed code: 99202/99203/99212/99213 get the primary-care-exception text, and 99204/99205/99214/99215 get the "physically present" text.

## Billing
The **Billing** section (and the code badge at the top) recalculates on every tap, using the AMA 2021+ office E/M MDM table (2 of 3 elements):
- **Problems** come from the status pills: Chronic + Stable/Improving = stable chronic, Chronic + Worsening = exacerbation, Acute = acute uncomplicated, Resolved = minor, and health maintenance isn't counted.
  Each problem has an **MDM** menu to override this (e.g. undiagnosed new problem with uncertain prognosis, acute with systemic symptoms, threat to life).
- **Data:** tests named in plan lines are counted as ordered (each unique test once, and "reviewed …" or "consider …" lines are skipped). Add results reviewed,
  external notes, independent historian, independent interpretation and discussion with an outside physician by hand.
- **Risk:** a plan line starting with a med verb (CONT/START/…) or mentioning "prescri"/"Rx" counts as prescription drug management (moderate). Admit/ED/hospice is high.
  Any other plan is low. You can override it, and the SDOH toggle makes it moderate.
- New vs established: only "new to clinic" bills as a new patient (9920x).
- **Bill as** overrides the code. If the teaching physician wasn't physically present, bill 99213/99203 or lower (primary care exception).
- Time-based billing isn't offered: with a resident, only the teaching physician's time counts.

It's a suggestion, conservative when unsure. You pick the code.

## Use
- **Tonight:** use **Import** with a pasted schedule. Only time, age, sex and visit type are kept; names, MRNs and DOBs are dropped.
  For a known patient, open the visit and use **Paste last note** (the EMR note as is). Its numbered problems come back as Known with the trend cleared, and the plan, notes and DDx are kept.
- **In the room:**
  - Age, F/M, known/new, visit type and chief complaint build the one-liner. Tap the one-liner to override it.
  - HPI lines: type or dictate, then press Enter.
  - **Exam** (the clinic template's systems and normals): type the vitals if wanted, then for each system tap nL and/or findings ("+ other" for your own).
    nL plus a finding appends it to the normal text. **All untouched → nL** fills the rest (not Abd or URO/GYNE). Only examined systems print.
  - **+ Problem:** type a few letters, then Enter. Then tap the status, DDx chips (hold one to annotate) and plan chips, or use CONT/START/… to type a med.
  - Follow-up: who with (remembered), an interval and a reason.
  - Copy each section into its EMR section. A section copied and unchanged since shows **Copied ✓**; if it changed, **Copy again**.
- A chip with `***` drops into the field with the blank selected, so you type over it.
- Plan lines you type become chips for that problem next time. Hold a remembered chip to forget it.
- ⋯ → **Signature…** once per device (printed above the attestation). ⋯ → **Clear panel** at the end of clinic. Visits are removed after 3 days anyway.

## Develop
- `library.json` is the one source of the problem library (~40 primary-care problems). After editing it:
  `node tools/gen-library.mjs` (writes the Android copy) and `node tools/version-sw.mjs` (so installed PWAs update).
- Tests: `npm test` covers the web logic, the library sync and the SW version. Android: `cd android && ./gradlew testDebugUnitTest assembleDebug`.
  Both suites pin the same sample note.
- Local preview: `python3 -m http.server 3933 --bind 127.0.0.1` (port 3933 is registered in `~/Projects/PORTS.md`).
- APK: `cp android/app/build/outputs/apk/debug/app-debug.apk apk/in-clinic.apk`. It's debug-signed; install it with `adb install -r`.

Clinical chips are starting points to tap from, not recommendations. Review them against local practice.
