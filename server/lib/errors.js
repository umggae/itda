// 서버 함수에서 "화면에 이유를 안내할 수 있는" 오류. code는 화면이 안내문을 고르는 데 쓴다.
//   BAD_REQUEST    잘못된 요청(검색어·좌표·날짜 등)
//   DATE_RANGE     대중교통 조회 가능한 날짜 범위를 벗어남
//   NOT_CONFIGURED 서버에 인증키가 없거나 키가 거부됨 (관리자가 할 일)
//   RATE_LIMIT     외부 API 호출 한도 초과 (잠시 뒤 다시)
//   UPSTREAM       외부 API가 응답하지 않거나 이상한 응답
export class ApiError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export const badRequest = (message) => new ApiError('BAD_REQUEST', 400, message);
export const upstream = (message = '외부 서비스가 응답하지 않습니다.') => new ApiError('UPSTREAM', 502, message);
export const rateLimit = () => new ApiError('RATE_LIMIT', 429, '외부 서비스의 호출 한도를 넘었습니다.');
export const notConfigured = () => new ApiError('NOT_CONFIGURED', 503, '서버 설정(인증키)에 문제가 있습니다.');
