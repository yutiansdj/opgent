pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    plugins {
        // 版本与本机 Gradle 缓存（AGP 8.9.1 / Kotlin 2.0.21）保持一致，避免联网下载
        id("com.android.application") version "8.9.1"
        id("org.jetbrains.kotlin.android") version "2.0.21"
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "RemoteAgent"
include(":app")
