plugins {
    base
}

group = "com.ouroboros.harness"
version = "1.0.0"

tasks.register("integrationTest") {
    group = "verification"
    description = "Builds the harness bridge and runs the release-level harness validation suite."
    dependsOn(":bridge:build")
}
