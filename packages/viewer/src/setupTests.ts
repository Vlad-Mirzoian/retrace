import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-registers cleanup when vitest runs with
// `globals: true`; we import test helpers explicitly, so unmount by hand.
// Without this, each test's DOM leaks into the next one.
afterEach(cleanup);
