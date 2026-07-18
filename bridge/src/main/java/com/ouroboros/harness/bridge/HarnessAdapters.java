package com.ouroboros.harness.bridge;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** Thread-safe registry for optional harness-only consumer adapters. */
public final class HarnessAdapters {
    private static final Map<String, HarnessAdapter> ADAPTERS = new ConcurrentHashMap<>();

    private HarnessAdapters() {
    }

    public static void register(HarnessAdapter adapter) {
        HarnessAdapter previous = ADAPTERS.putIfAbsent(adapter.id(), adapter);
        if (previous != null) {
            throw new IllegalStateException("Harness adapter already registered: " + adapter.id());
        }
    }

    public static Optional<HarnessAdapter> find(String id) {
        return Optional.ofNullable(ADAPTERS.get(id));
    }

    static void clear() {
        ADAPTERS.clear();
    }
}
