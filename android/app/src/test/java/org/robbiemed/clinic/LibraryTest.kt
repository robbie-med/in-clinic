package org.robbiemed.clinic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LibraryTest {
    @Test fun keysAndNamesUnique() {
        assertEquals(Library.all.size, Library.all.map { it.key }.toSet().size)
        assertEquals(Library.all.size, Library.all.map { it.name.lowercase() }.toSet().size)
    }

    @Test fun everyEntryOffersAPlan() = Library.all.forEach { assertTrue(it.name, it.plan.isNotEmpty()) }

    @Test fun statusWordsAreValid() = Library.all.forEach {
        assertTrue(it.name, it.novelty.isEmpty() || it.novelty in Note.novelty)
        assertTrue(it.name, it.course.isEmpty() || it.course in Note.course)
    }

    @Test fun chipsAreAsciiSoTheyPasteAnywhere() = Library.all.forEach { l ->
        (l.hpi + l.notes + l.plan + l.fu + l.ddx.flatMap { it.items + it.label }).forEach { assertTrue("${l.name}: $it", it.all { c -> c.code < 128 }) }
    }

    @Test fun searchFindsAliases() {
        assertEquals("htn", Library.search("hypert").first().key)
        assertEquals("dm2", Library.search("diab").first().key)
        assertEquals("htn", Library.match("Hypertension")?.key)
    }
}
