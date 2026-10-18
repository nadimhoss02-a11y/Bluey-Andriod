package com.bluey.app

/**
 * Wake word matching for "Hey Bluey" on Android.
 * Mirrors the Windows brain's stripWakeWord():
 *  - keyword = the last word of the configured phrase ("hey bluey" -> "bluey")
 *  - accepts "hey/hi/ok/okay/yo/hello/so" + keyword, or the bare keyword
 *  - everything else (no keyword) does not match
 */
object Wake {

    data class Match(val matched: Boolean, val rest: String, val bare: Boolean)

    fun strip(textRaw: String, phrase: String = "hey bluey"): Match {
        val t = textRaw.trim()
            .lowercase()
            .trimStart('"', '\'', '\u201c', '\u201d')
            .trimEnd('!', '.', '?', ',', '"', '\'', '\u201c', '\u201d')
            .trim()
        if (t.isEmpty()) return Match(false, "", false)

        val kw = phrase.lowercase().trim().split(Regex("\\s+")).lastOrNull().orEmpty()
        if (kw.isEmpty()) return Match(false, "", false)

        val attention = "(?:hey|hi|ok|okay|yo|hello|so)"
        val regex = Regex("^(?:$attention)?[\\s,:]*${Regex.escape(kw)}\\b[,!]*\\s*(.*)$")
        val m = regex.find(t) ?: return Match(false, "", false)
        val rest = m.groupValues[1].trim()
        return Match(true, rest, rest.isEmpty())
    }
}
