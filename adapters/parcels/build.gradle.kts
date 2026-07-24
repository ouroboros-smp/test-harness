plugins {
    id("net.fabricmc.fabric-loom") version "1.17.14"
    `java-library`
}

base {
    archivesName = "ouro-harness-parcels-adapter"
}

version = rootProject.version
group = rootProject.group

repositories {
    mavenCentral()
    maven("https://maven.nucleoid.xyz/") {
        name = "nucleoid"
    }
}

dependencies {
    minecraft("com.mojang:minecraft:${property("minecraft_version")}")
    implementation("net.fabricmc:fabric-loader:${property("loader_version")}")
    implementation("net.fabricmc.fabric-api:fabric-api:${property("fabric_api_version")}")
    compileOnly(project(":bridge"))
    compileOnly("eu.pb4:common-protection-api:2.0.0")
    compileOnly("org.xerial:sqlite-jdbc:3.49.1.0")

    testImplementation(platform("org.junit:junit-bom:5.13.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
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

tasks.test {
    useJUnitPlatform()
}
