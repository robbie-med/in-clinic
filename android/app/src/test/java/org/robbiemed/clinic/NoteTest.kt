package org.robbiemed.clinic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NoteTest {
    /** A fictional patient in the user's note format, rebuilt from taps. */
    private val sample = Visit(
        age = "52", sex = "F", relation = "known to me", type = "follow-up", cc = "fatigue",
        hpi = listOf(
            "Complains of fatigue, poor sleep and low mood for several months",
            "Recently moved; new commute",
            "Denies significant stress; does not explain all symptoms",
            "LMP 2 wk ago",
        ),
        problems = listOf(
            Problem(name = "Fatigue", lib = "fatigue", novelty = "New", course = "Chronic", trend = "Worsening",
                notes = listOf(
                    "Incidental pituitary finding on prior imaging; labs not yet done",
                    "Prior cortisol confounded by IV steroid the day before",
                    "Denies recent steroid use",
                ),
                ddx = listOf(
                    Ddx("Non-hormonal", listOf("OSA", "depression/anxiety (PHQ-9 negative)",
                        "medication effect (fatigue, mood change)", "iron deficiency anemia")),
                    Ddx("Hormonal", listOf("hyperprolactinemia", "central adrenal insufficiency", "panhypopituitarism", "perimenopause/estrogen insufficiency")),
                ),
                plan = listOf(
                    "8 AM serum cortisol with simultaneous ACTH, DHEA-S",
                    "TSH, free T4, IGF-1, prolactin, estradiol, LH, FSH",
                    "CBC, CMP, A1C, ferritin, iron panel",
                    "Sleep study ordered",
                )),
            Problem(name = "Left hand tingling", novelty = "New", course = "Acute", trend = "Stable",
                notes = listOf("Seen by neurology; workup ongoing", "Neurology recommends continuing current meds"),
                plan = listOf("Continue current meds; defer changes for now")),
            Problem(name = "HTN", lib = "htn", novelty = "Known", course = "Chronic", trend = "Stable",
                plan = listOf("CONT amlodipine 5 mg PO daily")),
        ),
        fuWhen = "2 wk", fuWhy = listOf("review labs", "confirm sleep study scheduled"),
    )

    private val expectedHpi = """
        52F known to me presents for follow-up of fatigue.
        Complains of fatigue, poor sleep and low mood for several months
        Recently moved; new commute
        Denies significant stress; does not explain all symptoms
        LMP 2 wk ago
    """.trimIndent()

    private val expectedAp = """
        #Fatigue
        Incidental pituitary finding on prior imaging; labs not yet done
        Prior cortisol confounded by IV steroid the day before
        Denies recent steroid use

        DDx:
        >OSA
        >depression/anxiety (PHQ-9 negative)
        >medication effect (fatigue, mood change)
        >iron deficiency anemia
        >hyperprolactinemia
        >central adrenal insufficiency
        >panhypopituitarism
        >perimenopause/estrogen insufficiency

        - 8 AM serum cortisol with simultaneous ACTH, DHEA-S
        - TSH, free T4, IGF-1, prolactin, estradiol, LH, FSH
        - CBC, CMP, A1C, ferritin, iron panel
        - Sleep study ordered

        #Left hand tingling
        Seen by neurology; workup ongoing
        Neurology recommends continuing current meds

        - Continue current meds; defer changes for now

        #HTN
        - CONT amlodipine 5 mg PO daily

        F/u in 2 wk to review labs and confirm sleep study scheduled
    """.trimIndent()

    /** The clinic example from the build spec, character for character (same as tools/test.mjs). */
    private val golden = """
        #Fatigue
        Likely iron deficiency anemia given menorrhagia and microcytosis.
        Hgb 10.8, MCV 76, ferritin 9, no melena or hematochezia.

        DDx:
        >Iron deficiency anemia; most likely given menorrhagia and ferritin 9, treating empirically
        >Hypothyroidism; considered but unlikely given no cold intolerance or weight gain, TSH to exclude

        - START ferrous sulfate 325 mg PO every other day with vitamin C source
        - Increase dietary iron: red meat 2-3x/wk, lentils, spinach; avoid tea/coffee within 1 hr of dose
        - TSH today
        - Repeat CBC, ferritin in 8 wk

        #Primary hypertension
        Above goal on current regimen, home average 142/90.
        No hypokalemia, no resistant pattern.

        - CONT lisinopril 10 mg PO daily
        - INCR. lisinopril to 20 mg PO daily if home average >130/80 at f/u
        - DASH diet, sodium <2 g/day, 150 min/wk moderate aerobic activity
        - Home BP log BID x 2 wk, f/u 4 wk

        #Deferred to future visit
        - Lipid screening
        - Colon cancer screening
    """.trimIndent()

    private val goldenVisit = Visit(age = "34", sex = "F", problems = listOf(
        Problem(name = "Fatigue", novelty = "New", course = "Subacute", trend = "Worsening",
            notes = listOf("Likely iron deficiency anemia given menorrhagia and microcytosis.", "Hgb 10.8, MCV 76, ferritin 9, no melena or hematochezia."),
            ddx = listOf(Ddx("Hematologic", listOf("Iron deficiency anemia; most likely given menorrhagia and ferritin 9, treating empirically")),
                Ddx("Endocrine", listOf("Hypothyroidism; considered but unlikely given no cold intolerance or weight gain, TSH to exclude"))),
            plan = listOf("START ferrous sulfate 325 mg PO every other day with vitamin C source",
                "Increase dietary iron: red meat 2-3x/wk, lentils, spinach; avoid tea/coffee within 1 hr of dose", "TSH today", "Repeat CBC, ferritin in 8 wk")),
        Problem(name = "Primary hypertension", novelty = "Known", course = "Chronic", trend = "Worsening",
            notes = listOf("Above goal on current regimen, home average 142/90.", "No hypokalemia, no resistant pattern."),
            plan = listOf("CONT lisinopril 10 mg PO daily", "INCR. lisinopril to 20 mg PO daily if home average >130/80 at f/u",
                "DASH diet, sodium <2 g/day, 150 min/wk moderate aerobic activity", "Home BP log BID x 2 wk, f/u 4 wk")),
        Problem(name = "Deferred to future visit", noStatus = true, plan = listOf("Lipid screening", "Colon cancer screening")),
    ))

    private fun text(v: Visit, sig: String = "") = Note.sections(v, sig).associate { it.key to it.text }

    @Test fun rendersTheClinicTemplateOneSectionAtATime() {
        val t = text(sample)
        assertEquals(listOf("cc", "hpi", "ap", "sign"), t.keys.toList())
        assertEquals("fatigue", t["cc"]); assertEquals(expectedHpi, t["hpi"]); assertEquals(expectedAp, t["ap"])
        assertEquals(Billing.ATTEST_PRESENT, t["sign"])
    }

    @Test fun signatureGoesAboveTheAttestation() =
        assertEquals("A. Doc, MD\nPGY-2\n\n" + Billing.ATTEST_PRESENT, text(sample, "A. Doc, MD\nPGY-2")["sign"])

    @Test fun emptyVisit() {
        val t = text(Visit(problems = listOf(Problem(name = "Cough"))))
        assertEquals(listOf("hpi", "ap", "sign"), t.keys.toList())
        assertEquals("*** known to me presents for follow-up.", t["hpi"])
        assertEquals("#Cough", t["ap"])
    }

    @Test fun statusIsNotPrintedAndBlocksAreSeparatedByABlankLine() {
        val hm = Library.problem(Library.get("hm")!!).copy(plan = listOf("Tdap"))
        assertEquals(listOf("#Health maintenance", "- Tdap"), Note.problem(hm))
        val htn = Problem(name = "HTN", novelty = "Known", course = "Chronic", trend = "Stable", notes = listOf("At goal"), plan = listOf("CONT x"))
        assertEquals(listOf("#HTN", "At goal", "", "- CONT x"), Note.problem(htn))
        val cough = Problem(name = "#Cough", ddx = listOf(Ddx("Infectious", listOf("viral URI; most likely")), Ddx("", listOf("GERD"))))
        assertEquals(listOf("#Cough", "DDx:", ">viral URI; most likely", ">GERD"), Note.problem(cough))
    }

    @Test fun apMatchesTheClinicExampleExactly() = assertEquals(golden, text(goldenVisit)["ap"])

    @Test fun theClinicExampleParsesBackToTheSameAp() {
        val r = Note.parse(golden)
        assertEquals(listOf("Fatigue", "Primary hypertension", "Deferred to future visit"), r.problems.map { it.name })
        assertEquals(listOf(Ddx("", goldenVisit.problems[0].ddx.flatMap { it.items })), r.problems[0].ddx)
        assertEquals(golden, text(Visit(problems = r.problems))["ap"])
    }

    @Test fun deferredPlanIsNotBilledAndTheExampleBills99214() {
        val v = Visit(problems = listOf(Problem(name = "Deferred to future visit", noStatus = true, plan = listOf("Mammogram", "Lipid panel", "START statin"))))
        assertEquals(emptyList<String>(), Billing.testsOrdered(v))
        assertEquals(1, Billing.bill(v).risk.lvl)
        assertEquals("99214", Billing.bill(goldenVisit).code)
    }

    @Test fun oneLinerVariants() {
        assertEquals("63M new to clinic presents to establish care.", Note.oneLiner(Visit(age = "63", sex = "M", relation = "new to clinic", type = "establish")))
        assertEquals("28F known to me presents for cough x5 days.", Note.oneLiner(Visit(age = "28", sex = "F", type = "acute", cc = "cough x5 days")))
        assertEquals("Typed by hand.", Note.oneLiner(Visit(oneLiner = "Typed by hand.")))
    }

    @Test fun newToMePrintsTheRecordsLine() {
        val t = text(Visit(age = "30", sex = "F", relation = "new to me", type = "establish", hpi = listOf("Moved here 7 yr ago")))
        assertEquals("30F presents to establish care.\n${Note.RECORDS}\nMoved here 7 yr ago", t["hpi"])
    }

    @Test fun followUpLine() {
        assertEquals("F/u w Dr. Richard in 2 mo to prenatal care", Note.followUp(Visit(fuWith = "Dr. Richard", fuWhen = "2 mo", fuWhy = listOf("prenatal care"))))
        assertEquals("F/u w Dr. Owen after specialist visit and ED precautions reviewed",
            Note.followUp(Visit(fuWith = "Dr. Owen", fuWhy = listOf("after specialist visit", "ED precautions reviewed"))))
        assertEquals("F/u PRN", Note.followUp(Visit(fuWhen = "PRN")))
        assertEquals("", Note.followUp(Visit()))   // no follow-up line
    }

    @Test fun parseRoundTrips() {
        val parsed = Note.parse("History of Present Illness\n$expectedHpi\n\nAssessment/Plan\n$expectedAp")
        assertEquals("52", parsed.age); assertEquals("F", parsed.sex)
        assertEquals(sample.problems.map { it.name }, parsed.problems.map { it.name })
        for ((a, b) in sample.problems.zip(parsed.problems)) {
            assertEquals(a.notes, b.notes); assertEquals(a.plan, b.plan)
            assertEquals(a.ddx.flatMap { it.items }, b.ddx.flatMap { it.items })
        }
    }

    /** Synthetic note in the shape the EMR pastes back (leading spaces, stray blanks, signature + attestation after). */
    private val pasted = """
        Chief Complaint

        DM

        History of Present Illness

        70F known to me presents for leg swelling

         Swelling x 2 wk

        Assessment/Plan

        1. Leg swelling
        Likely venous insufficiency
         No calf tenderness
         - Compression stockings
         - BMP

        2. Type 2 diabetes mellitus without complication
        TIR improving
         - CONT metformin 500 mg BID
         - f/u in 2-3 weeks

        F/u w Dr. Smith in 3 mo

        Jane Doe, MD
         PGY-2, Program
         555-0100

        By the addition of their electronic signature, the teaching physician certifies that ...
    """.trimIndent()

    @Test fun parsesAnEmrPasteAndStopsAtTheSignature() {
        val r = Note.parse(pasted)
        assertEquals("70", r.age); assertEquals("F", r.sex)
        assertEquals(listOf("Leg swelling", "Type 2 diabetes mellitus without complication"), r.problems.map { it.name })
        assertEquals(listOf("Likely venous insufficiency", "No calf tenderness"), r.problems[0].notes)
        assertEquals(listOf("CONT metformin 500 mg BID", "f/u in 2-3 weeks"), r.problems[1].plan)
    }

    @Test fun stillReadsOlderNotes() {
        val r0 = Note.parse("Assessment/Plan\n1. Fatigue\nNew\nChronic\nDDx:\n>Hormonal: hyperprolactinemia, central adrenal insufficiency\n\n- TSH")
        assertEquals("Chronic", r0.problems[0].course)
        assertEquals(listOf(Ddx("Hormonal", listOf("hyperprolactinemia", "central adrenal insufficiency"))), r0.problems[0].ddx)
        assertEquals(listOf("TSH"), r0.problems[0].plan)
        val r = Note.parse("52F known to me.\n\nPLAN\n\n#HTN\nKnown\nChronic\nStable\n\n- CONT amlodipine\n\nFollow-up: 2 wk.")
        assertEquals("HTN", r.problems[0].name); assertEquals("Stable", r.problems[0].trend); assertEquals(listOf("CONT amlodipine"), r.problems[0].plan)
    }

    @Test fun carryForwardMakesProblemsKnownAndClearsTrend() {
        val ps = Note.carryForward(Note.parse("Assessment/Plan\n$expectedAp").problems)
        assertTrue(ps.all { it.novelty == "Known" && it.trend.isEmpty() })
        assertEquals("htn", ps[2].lib); assertEquals("fatigue", ps[0].lib)
        assertEquals(listOf("CONT amlodipine 5 mg PO daily"), ps[2].plan)
    }

    private fun sys(name: String) = Exam.systems.first { it.name == name }

    @Test fun examIsItsOwnSection() {
        var v = Visit(age = "60", sex = "M", hpi = listOf("Cough x2 wk"), vitals = mapOf("BP" to "128/82", "SpO2" to "97%"))
        v = Exam.toggle(Exam.toggle(v, sys("Respiratory"), "crackles"), sys("Respiratory"), "diminished bases")
        v = Exam.toggle(v, sys("General"), Exam.NL)
        assertEquals("Vitals: BP 128/82, SpO2 97%\nGeneral: No acute distress, pleasant, conversant, well-groomed\nRespiratory: crackles and diminished bases", text(v)["exam"])
    }

    @Test fun examNormalPlusAFindingAppendsIt() {
        val msk = sys("MSK")
        var v = Exam.toggle(Exam.toggle(Visit(), msk, Exam.NL), msk, "myofascial trigger points")
        assertEquals(listOf("MSK: Normal ambulation, no clubbing or cyanosis, myofascial trigger points"), Exam.lines(v))
        v = Exam.toggle(v, msk, Exam.NL); assertEquals(listOf("MSK: myofascial trigger points"), Exam.lines(v))
        v = Exam.toggle(v, msk, "myofascial trigger points"); assertTrue("MSK" !in v.exam)
    }

    @Test fun allNormalSkipsOptionalSystems() = assertEquals(
        listOf("General", "Eyes", "ENT", "Neck", "Respiratory", "CV", "MSK", "Neuro", "Skin", "Psych"),
        Exam.lines(Exam.allNormal(Visit())).map { it.substringBefore(':') })

    @Test fun splitKeepsParentheses() =
        assertEquals(listOf("OSA", "medication effect (fatigue, mood change)", "IDA"), Note.split("OSA, medication effect (fatigue, mood change), IDA"))
}
