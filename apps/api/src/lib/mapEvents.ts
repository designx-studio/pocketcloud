// Feature 1: Live Infrastructure Map
// Process-local event emitter for SSE push notifications
// If multiple API replicas are needed later, swap for Redis pub/sub

import { EventEmitter } from "node:events";

export const mapEvents = new EventEmitter();
mapEvents.setMaxListeners(100); // one listener per connected dashboard