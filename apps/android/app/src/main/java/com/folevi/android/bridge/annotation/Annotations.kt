package com.folevi.android.bridge.annotation

/** A host plugin: `name` is what the page calls it by (`FoleviShell`, `FoleviAuth`, ...). */
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.CLASS)
annotation class BridgePlugin(val name: String, val permissions: Array<Permission> = [])

/** Android permissions a plugin asks for under one alias. */
@Retention(AnnotationRetention.RUNTIME)
annotation class Permission(val alias: String, val strings: Array<String>)

/** Runs after a permission request (Plugin.requestPermissionForAlias). */
@Retention(AnnotationRetention.RUNTIME)
@Target(AnnotationTarget.FUNCTION)
annotation class PermissionCallback
