package com.folevi.android

import java.io.File

/** The repository's shared fixtures (packages/local-store/fixtures), which every host's file layer runs. */
object Fixtures {
    val repo: File by lazy {
        var d: File? = File("").absoluteFile
        while (d != null && !File(d, "packages/local-store/fixtures").isDirectory) d = d.parentFile
        requireNotNull(d) { "Run the tests from inside the Folevi repository." }
    }

    fun text(path: String): String = File(repo, path).readText()
}
