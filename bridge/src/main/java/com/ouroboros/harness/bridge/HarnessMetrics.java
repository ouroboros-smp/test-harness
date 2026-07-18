package com.ouroboros.harness.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicLong;

final class HarnessMetrics {
    private static final int CAPACITY = 12_000;
    private final double[] milliseconds = new double[CAPACITY];
    private final AtomicLong ticks = new AtomicLong();
    private volatile long startedNanos;

    void startTick() {
        startedNanos = System.nanoTime();
    }

    void endTick() {
        long tick = ticks.getAndIncrement();
        milliseconds[(int) (tick % CAPACITY)] = (System.nanoTime() - startedNanos) / 1_000_000.0;
        synchronized (this) {
            notifyAll();
        }
    }

    long ticks() {
        return ticks.get();
    }

    boolean await(long targetTick, long timeoutMillis) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMillis;
        synchronized (this) {
            while (ticks.get() < targetTick) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) return false;
                wait(Math.min(remaining, 250));
            }
            return true;
        }
    }

    JsonObject snapshot(int onlinePlayers) {
        long count = Math.min(ticks.get(), CAPACITY);
        double[] sample = new double[(int) count];
        for (int i = 0; i < count; i++) sample[i] = milliseconds[i];
        Arrays.sort(sample);
        JsonObject result = new JsonObject();
        result.addProperty("ticks", ticks.get());
        result.addProperty("onlinePlayers", onlinePlayers);
        JsonObject mspt = new JsonObject();
        mspt.addProperty("current", count == 0 ? 0 : milliseconds[(int) ((ticks.get() - 1) % CAPACITY)]);
        mspt.addProperty("p50", percentile(sample, 0.50));
        mspt.addProperty("p95", percentile(sample, 0.95));
        mspt.addProperty("p99", percentile(sample, 0.99));
        mspt.addProperty("max", count == 0 ? 0 : sample[sample.length - 1]);
        result.add("mspt", mspt);
        JsonArray recent = new JsonArray();
        int recentCount = (int) Math.min(count, 100);
        for (int i = recentCount; i > 0; i--) {
            recent.add(milliseconds[(int) ((ticks.get() - i) % CAPACITY)]);
        }
        result.add("recentMspt", recent);
        return result;
    }

    private static double percentile(double[] values, double quantile) {
        if (values.length == 0) return 0;
        int index = Math.max(0, Math.min(values.length - 1, (int) Math.ceil(values.length * quantile) - 1));
        return values[index];
    }
}
