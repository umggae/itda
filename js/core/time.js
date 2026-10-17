// 시각 변환 도구. 시각은 계산할 때 "자정부터 지난 분"(숫자)으로 다룬다.
// 예: "09:30" → 570

// "HH:MM" 문자열을 분(숫자)으로 바꾼다. 형식이 틀리면 null.
export function parseTime(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// 분(숫자)을 "HH:MM" 문자열로 바꾼다. 24시를 넘으면 "25:10"처럼 그대로 보여 준다.
export function formatTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
}

// 분(숫자)을 "1시간 20분" 같은 읽기 쉬운 말로 바꾼다.
export function formatDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return minutes + '분';
  if (minutes === 0) return hours + '시간';
  return hours + '시간 ' + minutes + '분';
}
