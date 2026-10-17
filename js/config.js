// 화면이 쓸 데이터 공급자를 고르는 유일한 곳.
//   기본: 서버 함수(/api/*)를 부르는 serverProvider
//   주소 끝에 ?mock=1 을 붙이면: 개발용 가짜 데이터 (서버·인증키 없이 화면만 시험할 때)
// 화면(app.js)과 계산 로직(core/)은 이 파일의 선택에 상관없이 그대로다.
import { mockProvider } from './data/mockProvider.js';
import { serverProvider } from './data/serverProvider.js';

const useMock = new URLSearchParams(location.search).has('mock');

export const provider = useMock ? mockProvider : serverProvider;
