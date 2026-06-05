import type { ErrorKind } from "../types";

export function describeKind(kind: ErrorKind): string {
  switch (kind) {
    case "auth": return "API key 无效或已过期，请重新填写";
    case "network": return "网络不通，请检查连接";
    case "parse": return "服务返回了无法识别的数据";
    case "internal": return "本地错误，请尝试重置数据";
  }
}
