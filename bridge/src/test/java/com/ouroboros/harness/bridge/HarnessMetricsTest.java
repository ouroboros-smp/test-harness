package com.ouroboros.harness.bridge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class HarnessMetricsTest {
    @Test
    void reportsTicksAndOrderedPercentiles() {
        HarnessMetrics metrics = new HarnessMetrics();
        metrics.startTick();
        metrics.endTick();
        metrics.startTick();
        metrics.endTick();

        var snapshot = metrics.snapshot(2);
        assertEquals(2, snapshot.get("ticks").getAsLong());
        assertEquals(2, snapshot.get("onlinePlayers").getAsInt());
        var mspt = snapshot.getAsJsonObject("mspt");
        assertTrue(mspt.get("p50").getAsDouble() <= mspt.get("p99").getAsDouble());
        assertTrue(mspt.get("p99").getAsDouble() <= mspt.get("max").getAsDouble());
    }
}
