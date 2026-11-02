# In-Clinic

Clinic note builder. You tap through the visit in the room, and the note is written by the time you walk out.
Each section (Chief Complaint, HPI, Physical Exam, Assessment/Plan, After Visit Summary, Signature) has its own **Copy** button, so you paste it into the
EMR's matching section. The E/M level is calculated live as you go.

Two apps, one behavior:
- **Web app / PWA** (iPad, any browser): this repo's root, served by GitHub Pages at <https://robbie-med.github.io/in-clinic/>.
- **Android:** [`apk/in-clinic.apk`](apk/in-clinic.apk), with source in [`android/`](android/).

Everything stays on the device that's running it. There's no server, account or sync. No names or MRNs are entered, and the app never asks for them.

## Install on iPad
1. Open <https://robbie-med.github.io/in-clinic/> in **Safari**.
2. Tap Share → **Add to Home Screen**.
3. Open it from the home screen once while online. After that it works offline (service worker).

Layouts:
- **Desktop / iPad landscape (≥ 900 px wide):** the live note sits in a sticky column beside the editor, with a billing summary and a Copy button per section.
- **iPad portrait / phone:** the note is at the bottom, and a Copy bar (CC · HPI · Exam · A/P · AVS · Sign) is fixed to the bottom of the screen. It hides while you type, so it doesn't sit on the keyboard.
  A copied section shows ✓. If it changed after you copied it, its button turns amber.
- **Phone (< 600 px):** header actions move into ⋯, and each exam system shows only nL until you tap **findings**.
- Tabs under the header (Visit · HPI · Exam · A/P · F/u · AVS · Billing · Note) jump to each section.
- Desktop: "hold" is a right-click. Enter in a dialog's text field saves it (Ctrl/⌘+Enter in a multi-line box), and Esc closes it.

## The note
Sections, each copied on its own (titles aren't part of the copied text):
```
Chief Complaint             fatigue
History of Present Illness  41F known to me presents for follow-up of fatigue.
                            <HPI lines>
Physical Exam               General: No acute distress, pleasant, conversant, well-groomed
                            MSK: Normal ambulation, no clubbing or cyanosis, myofascial trigger points
Assessment/Plan             #Fatigue
                            Likely iron deficiency anemia given menorrhagia and microcytosis.
                            Hgb 10.8, MCV 76, ferritin 9, no melena or hematochezia.

                            DDx:
                            >Iron deficiency anemia; most likely given menorrhagia and ferritin 9, treating empirically
                            >Hypothyroidism; considered but unlikely given no cold intolerance or weight gain, TSH to exclude

                            - START ferrous sulfate 325 mg PO every other day with vitamin C source
                            - TSH today

                            #Deferred to future visit
                            - Lipid screening

                            F/u w Dr. Richard in 2 wk to review labs   (only if follow-up is filled in)
After Visit Summary         <the problems' patient handouts, then any added by hand>   (only if there are any)
Signature                   <your signature block> + teaching-physician attestation
```
- "New to me" prints the line *This was my first time seeing this patient, but records were available for review and the patient is well-known to our clinic.* under the one-liner.
- The A/P follows the build spec's format (`~/Projects/dot/Cerner Dot Phrase Build Spec.md`). Both test suites check it against the spec's clinic example character for character:
  `#Problem`, then the supporting lines, `DDx:` with one `>item; reasoning` line per item, and `- ` plan lines, with a blank line between those blocks.
- DDx: hold or right-click a picked item for **; most likely given \*\*\*** or **; considered but unlikely given \*\*\*, will \*\*\***. Group labels (">Hormonal") only sort the chips on screen and don't print.
- The status pills (New/Known, Acute/Subacute/Chronic, trend) aren't printed; they drive the billing level. **Hide status** in a problem's ⋯ leaves it out of billing.
- **Deferred to future visit** is a problem in the picker. Its plan lines print, but billing never counts them.
- Paste last note reads this format and the older numbered one.
- The attestation follows the billed code: 99202/99203/99212/99213 get the primary-care-exception text, and 99204/99205/99214/99215 get the "physically present" text.

## Billing
The **Billing** section (and the code badge at the top) recalculates on every tap, using the AMA 2021+ office E/M MDM table (2 of 3 elements).
It's automatic from what the note says. Every part has a by-hand override, and **auto** puts it back.
- **What counts:** lines you type, tap in or edit count right away. Lines a dotphrase put in are a menu until you tap **Done** on the problem.
  Delete what you didn't do, then Done; the rest counts as written, `***` blanks included. The Billing section lists problems not yet Done.
  An unpicked `_a / b` list never counts. Conditional lines ("Admit if …", "Labs only if …") never count as orders or escalation.
- **Problems:** adding a problem sets its status pills from its dotphrase's kind and the visit:
  - chronic → Known/Chronic (New at an establish-care or new-to-clinic visit)
  - acute → New/Acute
  - a workup (`#wu…` blocks, symptoms) → an undiagnosed new problem, or stable at a follow-up
  - systemic (CAP, PID, diverticulitis…) and threat-to-life blocks count as those
  - minor ones (cerumen, lice…) count as minor
  - A chronic problem that isn't at goal counts as chronic with progression (AMA: not at goal isn't stable): "uncontrolled", "flare", "worsening", "side effects" in its lines, or a START / INCREASE / SWITCH plan line. Tapping **Stable** overrides that.
  - Each problem's **MDM** menu overrides the result, e.g. "threat to life".
- **Data:**
  - tests ordered: test names in plan lines, each once ("reviewed", "consider", "if" lines skipped)
  - results reviewed: tests named with a result in the HPI or notes ("Hgb 10.8" is the CBC; "Reviewed CGM data"), not ones ordered today
  - external notes: "outside records", "discharge summary", "ED note"…; a hospital or ED follow-up visit counts its discharge records
  - independent historian: age under 12, or "history obtained from wife", "per mom"
  - independent interpretation: "personally reviewed the images", "independently interpreted EKG"
  - discussion: "discussed with cardiology / Dr. …" (not "with attending")
  - The HPI has one-tap chips for these: Reviewed outside records, Reviewed CGM data, History obtained from parent, Discussed with specialist, …
- **Risk:** a plan line starting with a med verb (CONT/START/…) or mentioning "prescri"/"Rx" counts as prescription drug management (moderate); OTC lines are low.
  Admit/ED/hospice is high, only when spelled out (no `***`, no "if"). "Cannot afford", "no transportation" and similar make it moderate (SDOH). Any other plan is low.
- New vs established: only "new to clinic" bills as a new patient (9920x).
- **Bill as** overrides the code. If the teaching physician wasn't physically present, bill 99213/99203 or lower (primary care exception).
- Time-based billing isn't offered: with a resident, only the teaching physician's time counts.
- The Android app has the same table but only reads its pills, counters and plan verbs.

It's a suggestion. You pick the code.

## Use
- **Tonight:** use **Import** with a pasted schedule. Only time, age, sex and visit type are kept; names, MRNs and DOBs are dropped.
  For a known patient, open the visit and use **Paste last note** (in ⋯ on a phone) (the EMR note as is). Its numbered problems come back as Known with the trend cleared, and the plan, notes and DDx are kept.
- **In the room:**
  - Age, F/M, known/new, visit type and chief complaint build the one-liner. Tap the one-liner to override it.
  - HPI lines: type or dictate, then press Enter.
  - **Exam** (the clinic template's systems and normals): for each system tap nL and/or findings ("+ other" for your own). The web app has no vitals fields, because vitals are already in the EMR.
    nL plus a finding appends it to the normal text. **All untouched → nL** fills the rest (not Abd or URO/GYNE). Only examined systems print.
  - **+ Problem:** type a few letters, then Enter. Then tap the status, DDx chips (hold or right-click one to annotate) and plan chips, or use CONT/START/… to type a med.
  - Follow-up: who with (remembered), an interval and a reason.
  - Copy each section into its EMR section. A section copied and unchanged since shows **Copied ✓**; if it changed, **Copy again**.
- Blanks show as one bold red `*` (stored and copied as `***`, or `_` for Cerner), so selecting one is one character. A chip with a blank drops into the field with the blank selected, so you type over it.
- Plan lines you type become chips for that problem next time. Hold (or right-click) a remembered chip to forget it. Each line has × to delete it; tap the line to edit or move it.
- **Blanks:** Cerner `_` or Epic `***`, the toggle on the panel (and in a visit's ⋯). Cerner is the default; the choice is remembered on this device.
  It changes only the copied text: `***` blanks print as `_` for Cerner.
- ⋯ → **Signature…** once per device (printed above the attestation). ⋯ → **Clear panel** at the end of clinic. Visits are removed after 3 days anyway.

## Dotphrases
Adding a problem fills its Notes and Plan from your dotphrase library (`~/Projects/dot`). The block's text lines go into Notes and its `- ` lines go into Plan.
- Library problems use their mapped block (HTN → `#htn`, T2DM → `#dm2`, Fatigue → `#wufatigue`, Joint pain → `#polyarth`, …).
  The ~250 clinic blocks without a library problem are in the **+ Problem** search by name or `#abbr` (e.g. `#pcos`, `#prep`, `#fibro`).
- An `_a / b / c` list in a line shows as a dropdown right in the line; picking writes the choice into the line and the note. Unpicked dropdowns and blanks are bold red, and lines with either have an amber edge. Tap one to edit it: the next `*` is selected so you can type over it.
  Delete what you don't need with ×, then **Done**: billing counts the rest (see Billing).
- `If DMPA:` branch headers stay in the plan above their lines. × on a header deletes that branch and its lines. A header with no lines left doesn't print, and billing ignores headers.
- Typing a library problem's `#abbr` (e.g. `#uti`) finds that problem first.
- A problem added another way (e.g. Paste last note) has **Insert #abbr dotphrase** in its ⋯ menu.
- Only the clinic `#` problem blocks are copied, into `dotphrases.json`; the rest of the library stays in `~/Projects/dot`.
  After editing the library: `node tools/import-dot.mjs [path/to/library]` then `node tools/version-sw.mjs`. The library-to-block mapping is `LIB` in that script.
- This repo is public, so clinic phone numbers never go in it. The library's private `build/clinic_phones.json` lists them; the import writes each as `{{label}}` (e.g. `{{Central Referral Center}}`)
  and refuses to write `dotphrases.json` if any other local number, or IHI / In His Image / Sikora, would be published. Public numbers (crisis lines, community clinics) are `PUBLIC` in the script.
  In the app, ⋯ → **Clinic phone numbers…** fills the labels on this device only; an unset one prints as a blank.
- Depression, anxiety, panic, PTSD, bipolar, grief and eating disorder problems have a **Counseling** button: the library's Tulsa counseling lists (`.edtulsacounsel`, `.edtulsafaith`),
  physician-only, for picking a referral. They aren't part of the note or the AVS.
- Web app only. The Android app doesn't use dotphrases.

## After Visit Summary
The library's clinic `$pi` patient instructions (~200) are copied into `dotphrases.json` as handouts.
- Adding a problem adds its handout to the **After Visit Summary** section: `#htn` → `$pihtn` by name, others through `PAIR` in `tools/import-dot.mjs` (`#dm2` → `$pidm`, `#pharyn` → `$pithroat`, …).
  Removing the problem takes its handout out. A problem's ⋯ has **Leave $pi… out of AVS** / **Add $pi… to AVS**.
- **+ Handout** adds any other one (search by title or `$pi` name, e.g. preop, `$pibp`). × takes a handout out.
- Tap a handout to fill it in for this visit: its blanks are selected in turn (**Next \***), and its `_a / b` lists are dropdowns. Handouts with blanks have an amber edge.
  The edited copy stays with this visit; **Reset to library text** undoes it.
- The AVS has its own Copy button and isn't included in Copy all or Share, which are for the note.

## Develop
- `library.json` is the one source of the problem library (~40 primary-care problems). After editing it:
  `node tools/gen-library.mjs` (writes the Android copy) and `node tools/version-sw.mjs` (so installed PWAs update).
- Tests: `npm test` covers the web logic, the library sync and the SW version. Android: `cd android && ./gradlew testDebugUnitTest assembleDebug`.
  Both suites pin the same sample note.
- Local preview: `python3 -m http.server 3933 --bind 127.0.0.1` (port 3933 is registered in `~/Projects/PORTS.md`).
- APK: `cp android/app/build/outputs/apk/debug/app-debug.apk apk/in-clinic.apk`. It's debug-signed; install it with `adb install -r`.

Clinical chips are starting points to tap from, not recommendations. Review them against local practice.
