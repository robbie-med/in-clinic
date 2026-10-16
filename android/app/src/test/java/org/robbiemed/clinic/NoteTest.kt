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
        1. Fatigue
        New
        Chronic
        Worsening
        Incidental pituitary finding on prior imaging; labs not yet done
        Prior cortisol confounded by IV steroid the day before
        Denies recent steroid use
        DDx:
        >Non-hormonal: OSA, depression/anxiety (PHQ-9 negative), medication effect (fatigue, mood change), iron deficiency anemia
        >Hormonal: hyperprolactinemia, central adrenal insufficiency, panhypopituitarism, perimenopause/estrogen insufficiency

        - 8 AM serum cortisol with simultaneous ACTH, DHEA-S
        - TSH, free T4, IGF-1, prolactin, estradiol, LH, FSH
        - CBC, CMP, A1C, ferritin, iron panel
        - Sleep study ordered

        2. Left hand tingling
        New
        Acute
        Stable
        Seen by neurology; workup ongoing
        Neurology recommends continuing current meds

        - Continue current meds; defer changes for now

        3. HTN
        Known
        Chronic
        Stable

        - CONT amlodipine 5 mg PO daily

        F/u in 2 wk to review labs and confirm sleep study scheduled
    """.trimIndent()

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
        assertEquals("1. Cough\n***\n***\n***\n\nF/u ***", t["ap"])
    }

    @Test fun statusLinesPrintAndHealthMaintenanceHasNone() {
        val hm = Library.problem(Library.get("hm")!!).copy(plan = listOf("Tdap"))
        assertEquals(listOf("4. Health maintenance", "- Tdap"), Note.problem(hm, 4))
        val htn = Problem(name = "HTN", novelty = "Known", course = "Chronic", trend = "Stable", notes = listOf("At goal"), plan = listOf("CONT x"))
        assertEquals(listOf("1. HTN", "Known", "Chronic", "Stable", "At goal", "", "- CONT x"), Note.problem(htn))
    }

    @Test fun unlabelledDdxIsOneLine() {
        val p = Problem(name = "Cough", ddx = listOf(Ddx("", listOf("viral URI", "GERD"))))
        assertTrue("DDx: viral URI, GERD" in Note.problem(p))
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
        assertEquals("F/u ***", Note.followUp(Visit()))
    }

    @Test fun parseRoundTrips() {
        val parsed = Note.parse("History of Present Illness\n$expectedHpi\n\nAssessment/Plan\n$expectedAp")
        assertEquals("52", parsed.age); assertEquals("F", parsed.sex)
        assertEquals(sample.problems.map { it.name }, parsed.problems.map { it.name })
        for ((a, b) in sample.problems.zip(parsed.problems)) {
            assertEquals(a.novelty, b.novelty); assertEquals(a.course, b.course); assertEquals(a.trend, b.trend)
            assertEquals(a.notes, b.notes); assertEquals(a.ddx, b.ddx); assertEquals(a.plan, b.plan)
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

    @Test fun stillReadsTheOldHashFormat() {
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
