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

    private val expected = """
        52F known to me here for follow-up of fatigue.

        Complains of fatigue, poor sleep and low mood for several months
        Recently moved; new commute
        Denies significant stress; does not explain all symptoms
        LMP 2 wk ago

        PLAN

        #Fatigue
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

        #Left hand tingling
        New
        Acute
        Stable
        Seen by neurology; workup ongoing
        Neurology recommends continuing current meds

        - Continue current meds; defer changes for now

        #HTN
        Known
        Chronic
        Stable

        - CONT amlodipine 5 mg PO daily

        Follow-up: 2 wk to review labs and confirm sleep study scheduled.
    """.trimIndent()

    @Test fun rendersTheUsersFormat() = assertEquals(expected, Note.render(sample))

    @Test fun blanksBecomeEpicWildcards() {
        val n = Note.render(Visit(problems = listOf(Problem(name = "Cough"))))
        assertEquals("*** known to me here for follow-up.\n\nPLAN\n\n#Cough\n***\n***\n***\n\nFollow-up: ***.", n)
    }

    @Test fun healthMaintenanceHasNoStatusLines() {
        val p = Library.problem(Library.get("hm")!!).copy(plan = listOf("Tdap"))
        assertEquals(listOf("#Health maintenance", "", "- Tdap"), Note.problem(p))
    }

    @Test fun unlabelledDdxIsOneLine() {
        val p = Problem(name = "Cough", ddx = listOf(Ddx("", listOf("viral URI", "GERD"))))
        assertTrue("DDx: viral URI, GERD" in Note.problem(p))
    }

    @Test fun oneLinerVariants() {
        assertEquals("63M new to me here to establish care.", Note.oneLiner(Visit(age = "63", sex = "M", relation = "new to me", type = "establish")))
        assertEquals("28F known to me here with cough x5 days.", Note.oneLiner(Visit(age = "28", sex = "F", type = "acute", cc = "cough x5 days")))
        assertEquals("Typed by hand.", Note.oneLiner(Visit(oneLiner = "Typed by hand.")))
    }

    @Test fun parseRoundTrips() {
        val parsed = Note.parse(expected)
        assertEquals("52", parsed.age); assertEquals("F", parsed.sex)
        assertEquals(sample.problems.map { it.name }, parsed.problems.map { it.name })
        for ((a, b) in sample.problems.zip(parsed.problems)) {
            assertEquals(a.novelty, b.novelty); assertEquals(a.course, b.course); assertEquals(a.trend, b.trend)
            assertEquals(a.notes, b.notes); assertEquals(a.ddx, b.ddx); assertEquals(a.plan, b.plan)
        }
    }

    @Test fun parsesTheUsersPasteWithItsStraySpacing() {
        // As pasted: double blank lines, trailing spaces after "Stable "
        val raw = expected.replace("Stable\n", "Stable \n\n").replace("\n#HTN", "\n\n#HTN")
        val ps = Note.parse(raw).problems
        assertEquals(3, ps.size)
        assertEquals("Stable", ps[1].trend)
        assertEquals(listOf("Seen by neurology; workup ongoing", "Neurology recommends continuing current meds"), ps[1].notes)
        assertEquals(listOf("CONT amlodipine 5 mg PO daily"), ps[2].plan)
    }

    @Test fun carryForwardMakesProblemsKnownAndClearsTrend() {
        val ps = Note.carryForward(Note.parse(expected).problems)
        assertTrue(ps.all { it.novelty == "Known" && it.trend.isEmpty() })
        assertEquals("htn", ps[2].lib)
        assertEquals("fatigue", ps[0].lib)
        assertEquals(listOf("CONT amlodipine 5 mg PO daily"), ps[2].plan)
    }

    @Test fun splitKeepsParentheses() =
        assertEquals(listOf("OSA", "medication effect (fatigue, mood change)", "IDA"), Note.split("OSA, medication effect (fatigue, mood change), IDA"))
}
