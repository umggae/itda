// 데이터 공급자가 던지는 오류. code로 화면이 "이유와 할 일"을 고른다. (server/lib/errors.js 의 code와 같은 이름)
export class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderError';
    this.code = code; // BAD_REQUEST | DATE_RANGE | NOT_CONFIGURED | RATE_LIMIT | UPSTREAM | NETWORK | INTERNAL
  }
}
