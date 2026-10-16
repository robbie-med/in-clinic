package org.robbiemed.clinic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as the billing tests in tools/test.mjs. */
class BillingTest {
    private fun chronic(name: String, trend: String = "Stable", plan: List<String> = emptyList()) =
        Problem(name = name, novelty = "Known", course = "Chronic", trend = trend, plan = plan)
    private fun levels(b: Billing.Bill) = listOf(b.problems.lvl, b.data.lvl, b.risk.lvl)

    private val sample = Visit(problems = listOf(
        Problem(name = "Fatigue", novelty = "New", course = "Chronic", trend = "Worsening", plan = listOf(
            "8 AM serum cortisol with simultaneous ACTH, DHEA-S", "TSH, free T4, IGF-1, prolactin, estradiol, LH, FSH",
            "CBC, CMP, A1C, ferritin, iron panel", "Sleep study ordered")),
        chronic("HTN", plan = listOf("CONT amlodipine 5 mg PO daily")),
    ))

    @Test fun sampleBills99214() {
        val b = Billing.bill(sample)
        assertEquals(listOf(3, 3, 3), levels(b)); assertEquals("99214", b.code); assertEquals(false, b.pce)
        assertTrue(b.data.auto.containsAll(listOf("cortisol", "sleep study", "LH")))
    }

    @Test fun oneStableChronicWithoutRxIs99213WithThePrimaryCareException() {
        val v = Visit(problems = listOf(chronic("HTN", plan = listOf("Home BP log"))))
        val b = Billing.bill(v)
        assertEquals(listOf(2, 1, 2), levels(b)); assertEquals("99213", b.code); assertTrue(b.pce)
        assertEquals(Billing.ATTEST_PCE, Billing.attestation(v))
    }

    @Test fun twoStableChronicPlusRx() {
        val ps = listOf(chronic("HTN", plan = listOf("CONT lisinopril 10 mg")), chronic("HLD"))
        assertEquals("99214", Billing.bill(Visit(problems = ps)).code)
        assertEquals("99204", Billing.bill(Visit(problems = ps, relation = "new to clinic")).code)
        assertEquals("99214", Billing.bill(Visit(problems = ps, relation = "new to me")).code)
    }

    @Test fun mdmIsTheMiddleOfTheThree() {
        val v = Visit(problems = listOf(Problem(name = "Chest pain", cx = "threat", plan = listOf("ice"))))
        assertEquals(2, Billing.bill(v).mdm)
        assertEquals("99215", Billing.bill(v.copy(risk = "high")).code)
    }

    @Test fun problemComplexityFromStatusPills() {
        assertEquals("chronicx", Billing.autoCx(chronic("x", "Worsening")))
        assertEquals("stable", Billing.autoCx(chronic("x", "Improving")))
        assertEquals("acute", Billing.autoCx(Problem(name = "x", novelty = "New", course = "Acute")))
        assertEquals("minor", Billing.autoCx(Problem(name = "x", trend = "Resolved", course = "Chronic")))
        assertEquals("none", Billing.autoCx(Problem(name = "HM", noStatus = true)))
        assertEquals("undx", Billing.problemCx(Problem(name = "x", course = "Acute", cx = "undx")))
    }

    @Test fun twoAcuteUncomplicatedStayLow() =
        assertEquals(2, Billing.bill(Visit(problems = listOf(Problem(name = "a", course = "Acute"), Problem(name = "b", course = "Acute")))).problems.lvl)

    @Test fun dataLevels() {
        fun lvl(d: BillData) = Billing.bill(Visit(data = d)).data.lvl
        assertEquals(1, lvl(BillData(reviewed = 1)))
        assertEquals(2, lvl(BillData(reviewed = 1, external = 1)))
        assertEquals(2, lvl(BillData(historian = true)))
        assertEquals(3, lvl(BillData(reviewed = 2, historian = true)))
        assertEquals(3, lvl(BillData(discuss = true)))
        assertEquals(4, lvl(BillData(discuss = true, interp = true)))
        assertEquals(4, lvl(BillData(reviewed = 3, discuss = true)))
        assertEquals(1, lvl(BillData(ordered = 0)))
    }

    @Test fun testsOrderedComeFromPlanLinesThatReadAsOrders() {
        val v = Visit(problems = listOf(Problem(name = "x", plan = listOf("CBC, CMP", "Reviewed TSH: normal", "US abdomen", "Consider MRI", "chest x-ray"))))
        assertEquals(listOf("CBC", "CMP", "chest x-ray", "US"), Billing.testsOrdered(v))
        assertEquals(emptyList<String>(), Billing.testsOrdered(Visit(problems = listOf(Problem(name = "x", plan = listOf("Discussed results with us", "flu shot today"))))))
    }

    @Test fun riskFromThePlan() {
        fun r(plan: List<String>) = Billing.bill(Visit(problems = listOf(Problem(name = "x", plan = plan)))).risk.lvl
        assertEquals(1, r(emptyList()))
        assertEquals(2, r(listOf("Continue prenatal vitamin")))
        assertEquals(3, r(listOf("STOP ibuprofen")))
        assertEquals(3, r(listOf("No opioids prescribed today")))
        assertEquals(4, r(listOf("Direct admit to hospital")))
        assertEquals(3, Billing.bill(Visit(sdoh = true, problems = listOf(Problem(name = "x", plan = listOf("labs"))))).risk.lvl)
    }

    @Test fun codeSetByHandPicksTheAttestation() {
        val v = sample.copy(code = "99213")
        val b = Billing.bill(v)
        assertEquals(listOf("99213", "99214"), listOf(b.code, b.auto)); assertTrue(b.overridden); assertTrue(b.pce)
        assertEquals(Billing.ATTEST_PCE, Note.sections(v).last().text)
        assertEquals("99214", Billing.bill(sample.copy(code = "99203")).code)
    }
}
