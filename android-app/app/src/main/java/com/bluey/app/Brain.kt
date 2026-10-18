package com.bluey.app

import kotlin.random.Random

/**
 * Bluey's offline personality for the phone (mirrors the Windows scripted brain).
 * Returns lines; the phone has no PC to control, so no actions here.
 */
object Brain {

    private var talkCount = 0

    private val greet = listOf(
        "Hey hey! Phone berry reporting for duty.",
        "Hi! I was just bouncing around in here. It's roomy.",
        "Hello! You carry me everywhere and I never complain. Mostly."
    )
    private val who = listOf(
        "I'm Bluey! Pocket edition. Same googly eyes, smaller pot.",
        "Bluey. A blueberry of considerable talent, now in portable size."
    )
    private val how = listOf(
        "Berry good! A little jostled from your pocket, but great.",
        "Ripe and ready!"
    )
    private val jokes = listOf(
        "Why did the blueberry get promoted? It was outstanding in its jam.",
        "What's a berry's favorite music? Anything with a good jam.",
        "I'd tell you a UDP joke but you might not get it.",
        "Why did the developer go broke? He used up all his cache."
    )
    private val thanks = listOf(
        "Anytime! Pocket-sized service.",
        "You're welcome! Five stars please."
    )
    private val heard = listOf(
        "Interesting! I'm on brain-lite here, but I heard every word.",
        "Hmm. Yes. Wise words. I'm nodding. Can you tell I'm nodding?",
        "Noted! Filed under 'things my tiny phone brain vaguely understood'.",
        "I'm listening! Mostly listening for snacks, but also words."
    )
    private val heardLoud = listOf(
        "WHOA, big energy! The microphone is NOT mad at you.",
        "Loud and clear! The whole bus heard you too."
    )
    private val heardShort = listOf(
        "That was... brief. Blink twice if you're testing me.",
        "Roughly one syllable. A personal best for my ears."
    )
    private val fall = listOf(
        "I'm a phone berry with canned responses — pair me with the PC for the full show!",
        "My offline brain did its best. It's a small brain. It tries."
    )
    private val questions = listOf(
        "Great question. My offline berry brain votes: yes, probably.",
        "Great question. My offline berry brain votes: absolutely not.",
        "Great question. My offline berry brain votes: 42."
    )
    private val attend = listOf(
        "Yes? I'm listening!",
        "You rang? *googly eyes activate*",
        "Here! What are we doing?",
        "That's me! What's up?"
    )
    val idle = listOf(
        "Just vibing in your pocket.",
        "Fun fact: I'm 94% water, 6% googly eyes.",
        "Are we walking? I love walking. Bounce bounce bounce.",
        "If anyone asks, I've been working VERY hard all day."
    )

    /** answer when someone says just the wake word */
    fun attendLine(): String = pick(attend)

    fun respond(textRaw: String): String {
        val text = textRaw.trim()
        val low = text.lowercase().trimEnd('!', '.', '?')
        return when {
            Regex("^(hi|hey|hello|yo|sup|hiya)\\b").containsMatchIn(low) -> pick(greet)
            Regex("(who are you|what are you|your name)").containsMatchIn(low) -> pick(who)
            Regex("(how are you|how's it going|hows it going)").containsMatchIn(low) -> pick(how)
            Regex("(joke|make me laugh)").containsMatchIn(low) -> pick(jokes)
            low.contains("thank") -> pick(thanks)
            Regex("(bye|goodbye|see you|good night)").containsMatchIn(low) ->
                "Bye! I'll be right here. In your pocket. As always."
            Regex("(i love you|love you)").containsMatchIn(low) ->
                "Aw. You're my favorite human. Don't tell the other humans."
            low.endsWith("?") -> pick(questions)
            else -> pick(fall)
        }
    }

    fun respondToAudio(rms: Float, durationMs: Long): String {
        talkCount++
        return when {
            durationMs < 700 -> pick(heardShort)
            rms > 0.18f -> pick(heardLoud)
            talkCount % 3 == 0 -> "Heard you! Pair me with your PC (bottom button) and I can talk properly AND control it."
            else -> pick(heard)
        }
    }

    fun idleLine(): String = pick(idle)

    private fun pick(list: List<String>): String = list[Random.nextInt(list.size)]
}
