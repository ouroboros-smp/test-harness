plugins {
    id("net.fabricmc.fabric-loom") version "1.17.14"
    `java-library`
}

base {
    archivesName = "ouro-harness-coffer-adapter"
}

version = rootProject.version
group = rootProject.group

repositories {
    mavenCentral()
}

val cofferJar = providers.gradleProperty("coffer_jar")
    .orElse("../coffer/fabric/build/libs/coffer-fabric-server-1.3.0.jar")
    .get()
val cofferCoreJar = providers.gradleProperty("coffer_core_jar")
    .orElse("../coffer/core/build/libs/core-1.3.0.jar")
    .get()

dependencies {
    minecraft("com.mojang:minecraft:${property("minecraft_version")}")
    implementation("net.fabricmc:fabric-loader:${property("loader_version")}")
    implementation("net.fabricmc.fabric-api:fabric-api:${property("fabric_api_version")}")
    compileOnly(project(":bridge"))
    compileOnly(files(rootProject.file(cofferJar)))
    compileOnly(files(rootProject.file(cofferCoreJar)))
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

tasks.processResources {
    inputs.property("version", project.version)
    filesMatching("fabric.mod.json") {
        expand("version" to project.version)
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release = 25
}
