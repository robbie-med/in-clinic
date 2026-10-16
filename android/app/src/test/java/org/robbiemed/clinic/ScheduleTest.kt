package org.robbiemed.clinic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ScheduleTest {
    @Test fun oneLinePerPatient() {
        val vs = Schedule.extract("""
            8:30 AM  Doe, Jane  41 y.o. F  Follow Up  MRN 1234567
            9:00 AM  Roe, Rick  63 yo M  New Patient
            1:15 PM  Poe, Ann   72 Female  Annual Wellness
        """.trimIndent())
        assertEquals(listOf("0830", "0900", "1315"), vs.map { it.slot })
        assertEquals(listOf("41", "63", "72"), vs.map { it.age })
        assertEquals(listOf("F", "M", "F"), vs.map { it.sex })
        assertEquals(listOf("follow-up", "establish", "annual"), vs.map { it.type })
    }

    @Test fun patientSpreadOverLines() {
        val vs = Schedule.extract("10:40 AM\nSmith, Bob\n55 y.o. male\nHospital Follow Up\n11:00 AM\nLee, Kim\n30 y.o. F\nSick visit")
        assertEquals(2, vs.size)
        assertEquals("1040", vs[0].slot); assertEquals("55", vs[0].age); assertEquals("M", vs[0].sex); assertEquals("hospital", vs[0].type)
        assertEquals("acute", vs[1].type)
    }

    @Test fun keepsNoNames() {
        val json = Schedule.extract("8:30 AM Doe, Jane 41 y.o. F Follow Up").single().toString()
        assertFalse(json.contains("Doe")); assertFalse(json.contains("Jane"))
    }

    @Test fun noonAndMidnight() {
        assertEquals(listOf("1200", "0015"), Schedule.extract("12:00 PM x\n12:15 AM y").map { it.slot })
    }
}
