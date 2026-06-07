import { t } from "../i18n";
import type { ErrorKind } from "../types";

export function describeKind(kind: ErrorKind): string {
  switch (kind) {
    case "auth": return t().errAuth;
    case "network": return t().errNetwork;
    case "parse": return t().errParse;
    case "internal": return t().errInternal;
  }
}