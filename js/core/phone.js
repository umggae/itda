// 문의처 글자에서 전화번호 하나를 찾는다. 순수 함수.
// 문의처는 자유 텍스트("02-3700-3900~1", "051-852-6904 (평일 9시~18시)")라서 번호 모양만 꺼낸다.
// tel 링크에는 숫자만 쓰므로, 문의처에 다른 글자가 섞여 있어도 링크가 엉뚱한 값이 되지 않는다.

const PHONE = /0\d{1,2}-\d{3,4}-\d{4}|1[5-9]\d{2}-\d{4}/;

// → { display: '02-3700-3900', tel: '0237003900' } 또는 null
export function findPhone(text) {
  const match = PHONE.exec(String(text ?? ''));
  if (!match) return null;
  return { display: match[0], tel: match[0].replace(/\D/g, '') };
}
